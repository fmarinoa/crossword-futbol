import type { Difficulty, RoomState, SubmitResult } from './types';

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `error ${status}`;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // sin body o no es JSON
  }
  if (!res.ok) throw new Error(extractErrorMessage(body, res.status));
  return body as T;
}

export function createRoom(difficulty?: Difficulty | Difficulty[]): Promise<RoomState> {
  return fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(difficulty ? { difficulty } : {}),
  }).then(parseJsonOrThrow<RoomState>);
}

export async function getRoom(roomId: string): Promise<RoomState | null> {
  const res = await fetch(`/api/rooms/${roomId}`);
  if (res.status === 404) return null;
  return parseJsonOrThrow<RoomState>(res);
}

export function submitAnswer(roomId: string, entryId: string, value: string): Promise<SubmitResult> {
  return fetch(`/api/rooms/${roomId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entryId, value }),
  }).then(parseJsonOrThrow<SubmitResult>);
}
