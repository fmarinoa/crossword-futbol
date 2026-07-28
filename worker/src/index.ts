export { Room } from './room';

import { generateRoomId } from './roomId';
import type { Env } from './types';

const ROOM_ID_PATTERN = /^[a-z0-9]{4,32}$/;
const MAX_CREATE_ATTEMPTS = 5;

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ["api", "rooms", ...]

    if (parts[0] !== 'api' || parts[1] !== 'rooms') {
      return json({ error: 'not found' }, { status: 404 });
    }

    if (parts.length === 2 && request.method === 'POST') {
      return handleCreateRoom(env);
    }

    if (parts.length === 3 && request.method === 'GET') {
      return handleGetRoom(env, parts[2]);
    }

    if (parts.length === 4 && parts[3] === 'answers' && request.method === 'POST') {
      return handleSubmitAnswer(env, parts[2], request);
    }

    return json({ error: 'not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleCreateRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const roomId = generateRoomId();
    const stub = env.ROOM.getByName(roomId);
    try {
      const state = await stub.createPuzzle(roomId);
      return json(state, { status: 201 });
    } catch (err) {
      if (err instanceof Error && err.message === 'room already exists') continue; // colisión, reintenta
      return json({ error: 'no se pudo generar un puzzle válido' }, { status: 500 });
    }
  }
  return json({ error: 'no se pudo generar un room id único' }, { status: 500 });
}

async function handleGetRoom(env: Env, roomId: string): Promise<Response> {
  if (!ROOM_ID_PATTERN.test(roomId)) return json({ error: 'room not found' }, { status: 404 });
  const stub = env.ROOM.getByName(roomId);
  const state = await stub.getState(roomId);
  if (!state) return json({ error: 'room not found' }, { status: 404 });
  return json(state);
}

async function handleSubmitAnswer(env: Env, roomId: string, request: Request): Promise<Response> {
  if (!ROOM_ID_PATTERN.test(roomId)) return json({ error: 'room not found' }, { status: 404 });

  let body: { entryId?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body inválido' }, { status: 400 });
  }
  if (typeof body.entryId !== 'string' || typeof body.value !== 'string') {
    return json({ error: 'entryId y value son requeridos' }, { status: 400 });
  }

  const stub = env.ROOM.getByName(roomId);
  try {
    const result = await stub.submitAnswer(body.entryId, body.value);
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error desconocido';
    const status = message === 'room not found' || message === 'unknown entryId' ? 404 : 500;
    return json({ error: message }, { status });
  }
}
