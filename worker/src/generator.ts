// Puerto de scripts/generate-puzzles.mjs para correr en el Worker en vez de en build time.
// La lógica de subset selection + grid placement es la misma; se le sacó todo lo que dependía
// de fs/argv/proceso (loadWordBank de disco, CLI, escritura a archivo) y la comparación Jaccard
// entre puzzles (subsetIsDiverseEnough) — esa lógica existía para mantener 10 puzzles estáticos
// distinguibles entre sí dentro de un pool fijo; no aplica cuando cada sala genera un único
// puzzle aislado, sin compararlo contra ningún otro.

import type { StructuralEntry, StructuralPuzzle, WordBankEntry } from './types';

const MIN_SUBSET = 15;
const MAX_SUBSET = 20;
const SUBSET_ATTEMPTS_PER_PUZZLE = 200;
const PLACEMENT_ATTEMPTS_PER_SUBSET = 20;
const MIN_ENTRIES_IN_PUZZLE = 10;

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sampleSubset(bank: WordBankEntry[]): WordBankEntry[] {
  const size = randomInt(MIN_SUBSET, Math.min(MAX_SUBSET, bank.length));
  const pool = [...bank];
  const picked: WordBankEntry[] = [];
  for (let i = 0; i < size; i++) {
    const idx = randomInt(0, pool.length - 1);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

const key = (r: number, c: number) => `${r},${c}`;

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Ordena de mayor a menor longitud; dentro del mismo largo, orden aleatorio (varía entre intentos).
function orderWords(words: WordBankEntry[]): WordBankEntry[] {
  const byLength = new Map<number, WordBankEntry[]>();
  for (const w of words) {
    const len = w.answer.length;
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len)!.push(w);
  }
  const lengths = [...byLength.keys()].sort((a, b) => b - a);
  const ordered: WordBankEntry[] = [];
  for (const len of lengths) ordered.push(...shuffle(byLength.get(len)!));
  return ordered;
}

interface WorkingEntry {
  wordId: string;
  word: string;
  orientation: 'H' | 'V';
  row: number;
  col: number;
  length: number;
}

function canPlace(
  grid: Map<string, string>,
  word: string,
  row: number,
  col: number,
  orientation: 'H' | 'V'
): { intersections: number } | null {
  const len = word.length;
  const dr = orientation === 'V' ? 1 : 0;
  const dc = orientation === 'H' ? 1 : 0;

  // Celdas de borde (antes del inicio y después del final) deben estar vacías.
  const beforeKey = key(row - dr, col - dc);
  const afterKey = key(row + dr * len, col + dc * len);
  if (grid.has(beforeKey)) return null;
  if (grid.has(afterKey)) return null;

  let intersections = 0;
  for (let i = 0; i < len; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const cellKey = key(r, c);
    const existing = grid.get(cellKey);
    const letter = word[i];
    if (existing) {
      if (existing !== letter) return null; // colisión de letra distinta
      intersections++;
    } else {
      // Vecinos perpendiculares deben estar vacíos: evita adyacencias ilegales.
      if (orientation === 'H') {
        if (grid.has(key(r - 1, c)) || grid.has(key(r + 1, c))) return null;
      } else {
        if (grid.has(key(r, c - 1)) || grid.has(key(r, c + 1))) return null;
      }
    }
  }
  if (intersections === 0) return null; // toda palabra (salvo la primera) debe cruzar algo
  return { intersections };
}

function candidatePositions(word: string, placedEntries: WorkingEntry[]) {
  const candidates = new Map<string, true>();
  const list: { row: number; col: number; orientation: 'H' | 'V' }[] = [];
  for (const entry of placedEntries) {
    const perpendicular: 'H' | 'V' = entry.orientation === 'H' ? 'V' : 'H';
    for (let j = 0; j < entry.length; j++) {
      const letterAtEntry = entry.word[j];
      for (let i = 0; i < word.length; i++) {
        if (word[i] !== letterAtEntry) continue;
        const cellRow = entry.orientation === 'H' ? entry.row : entry.row + j;
        const cellCol = entry.orientation === 'H' ? entry.col + j : entry.col;
        const row = perpendicular === 'V' ? cellRow - i : cellRow;
        const col = perpendicular === 'H' ? cellCol - i : cellCol;
        const dedupeKey = `${row},${col},${perpendicular}`;
        if (candidates.has(dedupeKey)) continue;
        candidates.set(dedupeKey, true);
        list.push({ row, col, orientation: perpendicular });
      }
    }
  }
  return list;
}

function cellsOverlap(entryB: WorkingEntry, row: number, col: number): boolean {
  const dr = entryB.orientation === 'V' ? 1 : 0;
  const dc = entryB.orientation === 'H' ? 1 : 0;
  for (let i = 0; i < entryB.length; i++) {
    const r = entryB.row + dr * i;
    const c = entryB.col + dc * i;
    if (r === row && c === col) return true;
  }
  return false;
}

function tryPlaceSubset(subset: WordBankEntry[]): { placedEntries: WorkingEntry[] } | null {
  const words = orderWords(subset);
  const grid = new Map<string, string>();
  const placedEntries: WorkingEntry[] = [];

  const first = words[0];
  const startRow = 0;
  const startCol = 0;
  for (let i = 0; i < first.answer.length; i++) {
    grid.set(key(startRow, startCol + i), first.answer[i]);
  }
  placedEntries.push({
    wordId: first.id,
    word: first.answer,
    orientation: 'H',
    row: startRow,
    col: startCol,
    length: first.answer.length,
  });

  for (let idx = 1; idx < words.length; idx++) {
    const bankEntry = words[idx];
    const word = bankEntry.answer;
    const candidates = candidatePositions(word, placedEntries);
    let best: { row: number; col: number; orientation: 'H' | 'V'; result: { intersections: number } } | null = null;
    for (const cand of candidates) {
      const result = canPlace(grid, word, cand.row, cand.col, cand.orientation);
      if (result && (!best || result.intersections > best.result.intersections)) {
        best = { ...cand, result };
      }
    }
    if (!best) continue; // no se pudo ubicar, se descarta del puzzle

    for (let i = 0; i < word.length; i++) {
      const r = best.orientation === 'V' ? best.row + i : best.row;
      const c = best.orientation === 'H' ? best.col + i : best.col;
      grid.set(key(r, c), word[i]);
    }
    placedEntries.push({
      wordId: bankEntry.id,
      word,
      orientation: best.orientation,
      row: best.row,
      col: best.col,
      length: word.length,
    });
  }

  // Validación obligatoria: toda entrada debe intersecarse con al menos otra.
  for (const entry of placedEntries) {
    const dr = entry.orientation === 'V' ? 1 : 0;
    const dc = entry.orientation === 'H' ? 1 : 0;
    let hasCrossing = false;
    for (let i = 0; i < entry.length; i++) {
      const r = entry.row + dr * i;
      const c = entry.col + dc * i;
      const sharedWith = placedEntries.some(
        (other) => other !== entry && other.orientation !== entry.orientation && cellsOverlap(other, r, c)
      );
      if (sharedWith) {
        hasCrossing = true;
        break;
      }
    }
    if (!hasCrossing) return null; // entrada aislada -> descartar intento completo
  }

  if (placedEntries.length < MIN_ENTRIES_IN_PUZZLE) return null;

  return { placedEntries };
}

function finalizePuzzle(id: string, placedEntries: WorkingEntry[]): StructuralPuzzle {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -Infinity;
  let maxCol = -Infinity;
  for (const entry of placedEntries) {
    const dr = entry.orientation === 'V' ? 1 : 0;
    const dc = entry.orientation === 'H' ? 1 : 0;
    const endRow = entry.row + dr * (entry.length - 1);
    const endCol = entry.col + dc * (entry.length - 1);
    minRow = Math.min(minRow, entry.row, endRow);
    minCol = Math.min(minCol, entry.col, endCol);
    maxRow = Math.max(maxRow, entry.row, endRow);
    maxCol = Math.max(maxCol, entry.col, endCol);
  }

  const shifted = placedEntries.map((e) => ({
    ...e,
    row: e.row - minRow,
    col: e.col - minCol,
  }));

  // Numeración: recorre la grilla fila por fila, columna por columna.
  const startPoints = new Map<string, number>();
  const sortedByPosition = [...shifted].sort((a, b) => a.row - b.row || a.col - b.col);
  let counter = 1;
  for (const entry of sortedByPosition) {
    const posKey = key(entry.row, entry.col);
    if (!startPoints.has(posKey)) {
      startPoints.set(posKey, counter++);
    }
  }

  const cellIndex: Record<string, string[]> = {};
  const entries: StructuralEntry[] = shifted.map((entry) => {
    const dr = entry.orientation === 'V' ? 1 : 0;
    const dc = entry.orientation === 'H' ? 1 : 0;
    const cellRefs: { row: number; col: number }[] = [];
    for (let i = 0; i < entry.length; i++) {
      const r = entry.row + dr * i;
      const c = entry.col + dc * i;
      cellRefs.push({ row: r, col: c });
      const cKey = key(r, c);
      if (!cellIndex[cKey]) cellIndex[cKey] = [];
      cellIndex[cKey].push(entry.wordId);
    }
    return {
      wordId: entry.wordId,
      number: startPoints.get(key(entry.row, entry.col))!,
      orientation: entry.orientation,
      row: entry.row,
      col: entry.col,
      length: entry.length,
      cellRefs,
    };
  });

  return {
    id,
    rows: maxRow - minRow + 1,
    cols: maxCol - minCol + 1,
    entries,
    cellIndex,
  };
}

// Fail loud: si no logra un puzzle válido en los intentos permitidos, devuelve null. El caller
// (worker/src/room.ts) traduce esto a un 500 — nunca se sirve un puzzle roto.
export function generatePuzzle(bank: WordBankEntry[], puzzleId: string): StructuralPuzzle | null {
  for (let attempt = 0; attempt < SUBSET_ATTEMPTS_PER_PUZZLE; attempt++) {
    const subset = sampleSubset(bank);
    for (let placeAttempt = 0; placeAttempt < PLACEMENT_ATTEMPTS_PER_SUBSET; placeAttempt++) {
      const placement = tryPlaceSubset(subset);
      if (placement) return finalizePuzzle(puzzleId, placement.placedEntries);
    }
  }
  return null;
}
