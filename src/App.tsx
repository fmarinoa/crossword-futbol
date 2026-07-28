import { useCallback, useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';
import GridView from './components/GridView';
import ZoomOverlay from './components/ZoomOverlay';
import { createInitialState, puzzleReducer } from './state/puzzleReducer';
import { createRoom, getRoom, submitAnswer } from './state/roomClient';
import type { Rect, RoomState } from './state/types';
import './App.css';

const ROOM_HISTORY_KEY = 'crossword-futbol:recent-rooms';
const MAX_RECENT_ROOMS = 5;
const ROOM_PATH_PATTERN = /^\/room\/([a-zA-Z0-9_-]+)\/?$/;

function readRecentRooms(): string[] {
  try {
    const raw = localStorage.getItem(ROOM_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRoom(roomId: string) {
  try {
    const rest = readRecentRooms().filter((id) => id !== roomId);
    localStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify([roomId, ...rest].slice(0, MAX_RECENT_ROOMS)));
  } catch {
    // localStorage no disponible (modo privado, etc.) — la lista simplemente no persiste.
  }
}

function forgetRoom(roomId: string) {
  try {
    localStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify(readRecentRooms().filter((id) => id !== roomId)));
  } catch {
    // no-op
  }
}

type Screen = { type: 'home' } | { type: 'room'; roomId: string };

function screenFromPathname(pathname: string): Screen {
  const match = pathname.match(ROOM_PATH_PATTERN);
  return match ? { type: 'room', roomId: match[1] } : { type: 'home' };
}

function unionRect(rects: DOMRect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="cw-header">
      <h1 className="cw-header__title">Crucigrama Futbolero</h1>
      {children}
    </header>
  );
}

function Footer() {
  return (
    <footer className="cw-footer">
      © {new Date().getFullYear()}{' '}
      <a href="https://portfolio.francomarino.dev" target="_blank" rel="noopener noreferrer">
        Franco Mariño
      </a>
    </footer>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(() => screenFromPathname(window.location.pathname));

  useEffect(() => {
    function handlePopState() {
      setScreen(screenFromPathname(window.location.pathname));
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const goHome = useCallback(() => {
    window.history.pushState(null, '', '/');
    setScreen({ type: 'home' });
  }, []);

  const goToRoom = useCallback((roomId: string) => {
    window.history.pushState(null, '', `/room/${roomId}`);
    setScreen({ type: 'room', roomId });
  }, []);

  return (
    <div className="cw-app">
      {screen.type === 'home' && <Home onEnterRoom={goToRoom} />}
      {screen.type === 'room' && <RoomScreen roomId={screen.roomId} onBackHome={goHome} />}
      <Footer />
    </div>
  );
}

function Home({ onEnterRoom }: { onEnterRoom: (roomId: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recentRooms = readRecentRooms();

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom();
      rememberRoom(room.roomId);
      onEnterRoom(room.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error desconocido');
      setCreating(false);
    }
  }

  return (
    <>
      <Header>
        <p className="cw-header__subtitle">Un crucigrama nuevo en cada sala</p>
      </Header>
      <main className="cw-main">
        <button type="button" className="cw-home-actions__primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creando…' : 'Nueva sala'}
        </button>
        {error && <p className="cw-status cw-status--error">No se pudo crear la sala: {error}</p>}

        {recentRooms.length > 0 && (
          <div className="cw-recent-rooms">
            <p className="cw-recent-rooms__label">Salas recientes</p>
            <ul className="cw-recent-rooms__list">
              {recentRooms.map((roomId) => (
                <li key={roomId}>
                  <button
                    type="button"
                    className="cw-recent-rooms__item"
                    onClick={() => onEnterRoom(roomId)}
                  >
                    Sala {roomId}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </>
  );
}

type RoomLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; room: RoomState };

function RoomScreen({ roomId, onBackHome }: { roomId: string; onBackHome: () => void }) {
  const [loadState, setLoadState] = useState<RoomLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getRoom(roomId)
      .then((room) => {
        if (cancelled) return;
        if (!room) {
          // Id nunca creado (link inválido/typo) — no tiene sentido seguir listándolo en Home.
          forgetRoom(roomId);
          setLoadState({ status: 'error', message: 'sala no encontrada' });
          return;
        }
        rememberRoom(room.roomId);
        setLoadState({ status: 'ready', room });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadState({ status: 'error', message: err instanceof Error ? err.message : 'error desconocido' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  return (
    <>
      <Header>
        <button type="button" className="cw-header__back" onClick={onBackHome}>
          ← Inicio
        </button>
      </Header>
      <main className="cw-main">
        {loadState.status === 'loading' && <p className="cw-status">Cargando puzzle…</p>}
        {loadState.status === 'error' && (
          <p className="cw-status cw-status--error">No se pudo cargar el crucigrama: {loadState.message}</p>
        )}
        {loadState.status === 'ready' && <PuzzleGame room={loadState.room} key={loadState.room.roomId} />}
      </main>
    </>
  );
}

function initFromRoom(room: RoomState) {
  return puzzleReducer(createInitialState(room.puzzle), {
    type: 'HYDRATE',
    puzzle: room.puzzle,
    solvedEntryIds: room.progress.solvedEntryIds,
    revealedCells: room.progress.revealedCells,
  });
}

function PuzzleGame({ room }: { room: RoomState }) {
  const [state, dispatch] = useReducer(puzzleReducer, room, initFromRoom);
  const [initialRect, setInitialRect] = useState<Rect | null>(null);

  const puzzle = state.puzzle;
  const totalEntries = puzzle.entries.length;
  const solvedCount = state.solvedEntryIds.size;
  const isComplete = solvedCount === totalEntries;

  function handleSelectEntry(entryId: string) {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-entries~="${entryId}"]`));
    setInitialRect(cells.length > 0 ? unionRect(cells.map((el) => el.getBoundingClientRect())) : null);
    dispatch({ type: 'SELECT_ENTRY', entryId });
  }

  async function handleSubmit(value: string) {
    const entryId = state.activeEntryId;
    if (!entryId) return;
    dispatch({ type: 'SUBMIT_ANSWER_START', entryId });
    try {
      const result = await submitAnswer(room.roomId, entryId, value);
      dispatch({
        type: 'SUBMIT_ANSWER_SUCCESS',
        entryId,
        correct: result.correct,
        revealedCells: result.revealedCells,
      });
    } catch (err) {
      dispatch({
        type: 'SUBMIT_ANSWER_FAILURE',
        message: err instanceof Error ? err.message : 'no se pudo enviar, reintentá',
      });
    }
  }

  function handleClose() {
    dispatch({ type: 'DESELECT' });
  }

  const activeEntry = state.activeEntryId
    ? puzzle.entries.find((e) => e.wordId === state.activeEntryId)
    : undefined;

  return (
    <>
      <div className="cw-scoreboard">
        <span className="cw-scoreboard__digits">
          {String(solvedCount).padStart(2, '0')} / {String(totalEntries).padStart(2, '0')}
        </span>
        <span className="cw-scoreboard__label">entradas resueltas</span>
      </div>

      {isComplete && <p className="cw-status cw-status--win">¡Crucigrama completo! 🏆</p>}

      <div className="cw-grid-scroll">
        <GridView
          puzzle={puzzle}
          solvedEntryIds={state.solvedEntryIds}
          revealedCells={state.revealedCells}
          onSelectEntry={handleSelectEntry}
        />
      </div>

      {activeEntry && (
        <ZoomOverlay
          entry={activeEntry}
          revealedCells={state.revealedCells}
          initialRect={initialRect}
          wasWrong={state.lastSubmissionWasWrong}
          submitting={state.submitting}
          submitError={state.submitError}
          onSubmit={handleSubmit}
          onClose={handleClose}
        />
      )}
    </>
  );
}
