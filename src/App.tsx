import { useEffect, useMemo, useReducer, useState } from 'react';
import wordBankRaw from '../data/word-bank.json';
import GridView from './components/GridView';
import ZoomOverlay from './components/ZoomOverlay';
import { createInitialState, createPuzzleReducer } from './state/puzzleReducer';
import { pickNextPuzzleId } from './utils/rotation';
import type { Manifest, Puzzle, Rect, WordBankEntry } from './state/types';
import './App.css';

const wordBank = wordBankRaw as WordBankEntry[];
const bankById = new Map(wordBank.map((entry) => [entry.id, entry]));

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; puzzle: Puzzle };

function unionRect(rects: DOMRect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const base = import.meta.env.BASE_URL;
        const manifestRes = await fetch(`${base}puzzles/manifest.json`);
        if (!manifestRes.ok) throw new Error('no se pudo cargar el manifiesto de puzzles');
        const manifest: Manifest = await manifestRes.json();

        const puzzleId = pickNextPuzzleId(manifest.puzzleIds);
        const puzzleRes = await fetch(`${base}puzzles/${puzzleId}.json`);
        if (!puzzleRes.ok) throw new Error(`no se pudo cargar el puzzle "${puzzleId}"`);
        const puzzle: Puzzle = await puzzleRes.json();

        if (!cancelled) setLoadState({ status: 'ready', puzzle });
      } catch (err) {
        if (!cancelled) {
          setLoadState({ status: 'error', message: err instanceof Error ? err.message : 'error desconocido' });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="cw-app">
      <header className="cw-header">
        <h1 className="cw-header__title">Crucigrama Futbolero</h1>
      </header>

      <main className="cw-main">
        {loadState.status === 'loading' && <p className="cw-status">Cargando puzzle…</p>}
        {loadState.status === 'error' && (
          <p className="cw-status cw-status--error">No se pudo cargar el crucigrama: {loadState.message}</p>
        )}
        {loadState.status === 'ready' && <PuzzleGame puzzle={loadState.puzzle} />}
      </main>
    </div>
  );
}

function PuzzleGame({ puzzle }: { puzzle: Puzzle }) {
  const reducer = useMemo(() => createPuzzleReducer(bankById), []);
  const [state, dispatch] = useReducer(reducer, puzzle, createInitialState);
  const [initialRect, setInitialRect] = useState<Rect | null>(null);

  const totalEntries = puzzle.entries.length;
  const solvedCount = state.solvedEntryIds.size;
  const isComplete = solvedCount === totalEntries;

  function handleSelectEntry(entryId: string) {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-entries~="${entryId}"]`));
    setInitialRect(cells.length > 0 ? unionRect(cells.map((el) => el.getBoundingClientRect())) : null);
    dispatch({ type: 'SELECT_ENTRY', entryId });
  }

  function handleSubmit(value: string) {
    if (!state.activeEntryId) return;
    dispatch({ type: 'SUBMIT_ANSWER', entryId: state.activeEntryId, value });
  }

  function handleClose() {
    dispatch({ type: 'DESELECT' });
  }

  const activeEntry = state.activeEntryId
    ? puzzle.entries.find((e) => e.wordId === state.activeEntryId)
    : undefined;
  const activeBankEntry = state.activeEntryId ? bankById.get(state.activeEntryId) : undefined;

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

      {activeEntry && activeBankEntry && (
        <ZoomOverlay
          entry={activeEntry}
          bankEntry={activeBankEntry}
          revealedCells={state.revealedCells}
          initialRect={initialRect}
          wasWrong={state.lastSubmissionWasWrong}
          onSubmit={handleSubmit}
          onClose={handleClose}
        />
      )}
    </>
  );
}
