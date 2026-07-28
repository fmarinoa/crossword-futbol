import { useCallback, useEffect, useReducer, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import GridView from './components/GridView';
import ZoomOverlay from './components/ZoomOverlay';
import { createInitialState, puzzleReducer } from './state/puzzleReducer';
import { createRoom, getRoom, submitAnswer } from './state/roomClient';
import type { Difficulty, Rect, RoomState } from './state/types';
import './App.css';

const ROOM_HISTORY_KEY = 'crossword-futbol:recent-rooms';
const MAX_RECENT_ROOMS = 5;
const ROOM_PATH_PATTERN = /^\/room\/([a-zA-Z0-9_-]+)\/?$/;

type DifficultyChoice = Difficulty | 'mixed';

interface RecentRoom {
  roomId: string;
  difficulty: DifficultyChoice;
  completed: boolean;
}

function isDifficultyChoice(value: unknown): value is DifficultyChoice {
  return value === 'mixed' || value === 'easy' || value === 'medium' || value === 'hard';
}

// Var CSS por dificultad, definida en index.css — reusada tanto por el picker de creación
// como por el color de las salas recientes. 'mixed' cubre además salas sin dificultad
// registrada (visitadas por link, nunca creadas desde este navegador).
const DIFFICULTY_COLOR_VAR: Record<DifficultyChoice, string> = {
  mixed: '--diff-mixed',
  easy: '--diff-easy',
  medium: '--diff-medium',
  hard: '--diff-hard',
};

// 'hard' deshabilitado: el banco hoy solo tiene 7 palabras difíciles, por debajo del mínimo
// para generar un puzzle (ver worker/src/room.ts MIN_POOL_SIZE) — reactivar cuando crezca el banco.
const DIFFICULTY_OPTIONS: { value: DifficultyChoice; label: string; disabled?: boolean }[] = [
  { value: 'mixed', label: 'Mezcla' },
  { value: 'easy', label: 'Fácil' },
  { value: 'medium', label: 'Medio' },
  { value: 'hard', label: 'Difícil', disabled: true },
];

function readRecentRooms(): RecentRoom[] {
  try {
    const raw = localStorage.getItem(ROOM_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rooms: RecentRoom[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        rooms.push({ roomId: entry, difficulty: 'mixed', completed: false });
      } else if (entry && typeof entry === 'object' && typeof (entry as { roomId?: unknown }).roomId === 'string') {
        const e = entry as { roomId: string; difficulty?: unknown; completed?: unknown };
        rooms.push({
          roomId: e.roomId,
          difficulty: isDifficultyChoice(e.difficulty) ? e.difficulty : 'mixed',
          completed: e.completed === true,
        });
      }
    }
    return rooms;
  } catch {
    return [];
  }
}

function writeRecentRooms(rooms: RecentRoom[]) {
  try {
    localStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify(rooms.slice(0, MAX_RECENT_ROOMS)));
  } catch {
    // localStorage no disponible (modo privado, etc.) — la lista simplemente no persiste.
  }
}

// difficulty se pasa explícito al crear una sala nueva; al resumir una ya conocida (link,
// lista de recientes) se preserva lo que ya sabíamos de ella, y 'mixed' si es la primera vez
// que la vemos en este navegador.
function rememberRoom(roomId: string, difficulty?: DifficultyChoice) {
  const existing = readRecentRooms();
  const prev = existing.find((r) => r.roomId === roomId);
  const rest = existing.filter((r) => r.roomId !== roomId);
  writeRecentRooms([
    { roomId, difficulty: difficulty ?? prev?.difficulty ?? 'mixed', completed: prev?.completed ?? false },
    ...rest,
  ]);
}

function forgetRoom(roomId: string) {
  writeRecentRooms(readRecentRooms().filter((r) => r.roomId !== roomId));
}

function markRoomCompleted(roomId: string) {
  const rooms = readRecentRooms();
  const idx = rooms.findIndex((r) => r.roomId === roomId);
  if (idx === -1 || rooms[idx].completed) return;
  const next = [...rooms];
  next[idx] = { ...next[idx], completed: true };
  writeRecentRooms(next);
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState<DifficultyChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ordenar recientes con las completadas al final (orden estable: preserva la recencia dentro
  // de cada grupo). No reactivo dentro de la vida de Home — mismo patrón que ya tenía el código.
  const recentRooms = [...readRecentRooms()].sort((a, b) => Number(a.completed) - Number(b.completed));

  async function handleCreate(choice: DifficultyChoice) {
    setCreating(choice);
    setError(null);
    try {
      const room = await createRoom(choice === 'mixed' ? undefined : choice);
      rememberRoom(room.roomId, choice);
      onEnterRoom(room.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error desconocido');
      setCreating(null);
    }
  }

  return (
    <>
      <Header>
        <p className="cw-header__subtitle">Un crucigrama nuevo en cada sala</p>
      </Header>
      <main className="cw-main">
        {!pickerOpen && (
          <button type="button" className="cw-home-actions__primary" onClick={() => setPickerOpen(true)}>
            Nueva sala
          </button>
        )}

        {pickerOpen && (
          <div className="cw-difficulty-picker" role="radiogroup" aria-label="Dificultad">
            {DIFFICULTY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={creating === opt.value}
                style={{ '--chip-color': `var(${DIFFICULTY_COLOR_VAR[opt.value]})` } as CSSProperties}
                className={`cw-difficulty-picker__option${
                  creating === opt.value ? ' cw-difficulty-picker__option--loading' : ''
                }`}
                onClick={() => handleCreate(opt.value)}
                disabled={opt.disabled || creating !== null}
                title={opt.disabled ? 'Próximamente: hacen falta más palabras difíciles' : undefined}
              >
                {creating === opt.value ? 'Creando…' : opt.label}
              </button>
            ))}
          </div>
        )}
        {error && <p className="cw-status cw-status--error">No se pudo crear la sala: {error}</p>}

        {recentRooms.length > 0 && (
          <div className="cw-recent-rooms">
            <p className="cw-recent-rooms__label">Salas recientes</p>
            <ul className="cw-recent-rooms__list">
              {recentRooms.map((room) => (
                <li key={room.roomId}>
                  <button
                    type="button"
                    className={`cw-recent-rooms__item${
                      room.completed ? ' cw-recent-rooms__item--completed' : ''
                    }`}
                    style={{ '--chip-color': `var(${DIFFICULTY_COLOR_VAR[room.difficulty]})` } as CSSProperties}
                    onClick={() => onEnterRoom(room.roomId)}
                  >
                    <span>Sala {room.roomId}</span>
                    {room.completed && (
                      <span className="cw-recent-rooms__trophy" aria-label="completada">
                        🏆
                      </span>
                    )}
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

  useEffect(() => {
    if (isComplete) markRoomCompleted(room.roomId);
  }, [isComplete, room.roomId]);

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
