import { useEffect, useMemo, useRef, useState } from 'react';
import type { Puzzle } from '../state/types';
import './GridView.css';

interface GridViewProps {
  puzzle: Puzzle;
  solvedEntryIds: Set<string>;
  revealedCells: Map<string, string>;
  onSelectEntry: (entryId: string) => void;
}

interface StartInfo {
  number: number;
  entryIds: string[];
}

export default function GridView({ puzzle, solvedEntryIds, revealedCells, onSelectEntry }: GridViewProps) {
  const startMap = useMemo(() => {
    const map = new Map<string, StartInfo>();
    for (const entry of puzzle.entries) {
      const start = entry.cellRefs[0];
      const key = `${start.row},${start.col}`;
      if (!map.has(key)) map.set(key, { number: entry.number, entryIds: [] });
      map.get(key)!.entryIds.push(entry.wordId);
    }
    return map;
  }, [puzzle]);

  const [flashingCells, setFlashingCells] = useState<Set<string>>(new Set());
  const prevSolvedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const prevSolved = prevSolvedRef.current;
    const newlySolved = puzzle.entries.filter(
      (e) => solvedEntryIds.has(e.wordId) && !prevSolved.has(e.wordId)
    );
    prevSolvedRef.current = new Set(solvedEntryIds);
    if (newlySolved.length === 0) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const keys = newlySolved.flatMap((e) => e.cellRefs.map((c) => `${c.row},${c.col}`));
    setFlashingCells((prev) => new Set([...prev, ...keys]));
    const timeout = setTimeout(() => {
      setFlashingCells((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }, 1100);
    return () => clearTimeout(timeout);
  }, [solvedEntryIds, puzzle]);

  function handleCellClick(entryIds: string[]) {
    const unsolved = entryIds.find((id) => !solvedEntryIds.has(id));
    if (unsolved) onSelectEntry(unsolved);
  }

  const cells = [];
  for (let row = 0; row < puzzle.rows; row++) {
    for (let col = 0; col < puzzle.cols; col++) {
      const key = `${row},${col}`;
      const entryIdsHere = puzzle.cellIndex[key];
      if (!entryIdsHere || entryIdsHere.length === 0) {
        cells.push(<div key={key} className="cw-cell cw-cell--empty" aria-hidden="true" />);
        continue;
      }
      const startInfo = startMap.get(key);
      const isClickable = !!startInfo && startInfo.entryIds.some((id) => !solvedEntryIds.has(id));
      const letter = revealedCells.get(key);
      const isFlashing = flashingCells.has(key);
      const allSolvedHere = entryIdsHere.every((id) => solvedEntryIds.has(id));

      cells.push(
        <button
          key={key}
          type="button"
          className={[
            'cw-cell',
            isClickable ? 'cw-cell--clickable' : '',
            isFlashing ? 'cw-cell--flash' : '',
            allSolvedHere ? 'cw-cell--solved' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-row={row}
          data-col={col}
          data-entries={entryIdsHere.join(' ')}
          disabled={!isClickable}
          aria-label={startInfo ? `Entrada número ${startInfo.number}` : undefined}
          onClick={() => startInfo && handleCellClick(startInfo.entryIds)}
        >
          {startInfo && <span className="cw-cell__number">{startInfo.number}</span>}
          {letter && <span className="cw-cell__letter">{letter}</span>}
        </button>
      );
    }
  }

  return (
    <div
      className="cw-grid"
      style={{
        gridTemplateColumns: `repeat(${puzzle.cols}, var(--cell-size))`,
        gridTemplateRows: `repeat(${puzzle.rows}, var(--cell-size))`,
      }}
    >
      {cells}
    </div>
  );
}
