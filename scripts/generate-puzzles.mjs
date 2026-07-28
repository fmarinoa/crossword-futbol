#!/usr/bin/env node
// Genera N puzzles estáticos de crucigrama futbolero. Corre en build time, sin deps externas.
// Uso: node scripts/generate-puzzles.mjs [--count=10] [--out=public/puzzles] [--bank=data/word-bank.json]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { count: 10, out: 'public/puzzles', bank: 'data/word-bank.json' };
  for (const raw of argv) {
    const m = raw.match(/^--([\w-]+)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'count') args.count = parseInt(value, 10);
    else if (key === 'out') args.out = value;
    else if (key === 'bank') args.bank = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const MIN_SUBSET = 15;
const MAX_SUBSET = 20;
const JACCARD_THRESHOLD = 0.4;
const SUBSET_ATTEMPTS_PER_PUZZLE = 200;
const PLACEMENT_ATTEMPTS_PER_SUBSET = 20;
const MIN_ENTRIES_IN_PUZZLE = 10;

function fail(message) {
  console.error(`[generate-puzzles] ERROR: ${message}`);
  process.exit(1);
}

function loadWordBank(bankPath) {
  const abs = path.resolve(repoRoot, bankPath);
  if (!existsSync(abs)) fail(`no se encontró el banco de palabras en ${abs}`);
  let bank;
  try {
    bank = JSON.parse(readFileSync(abs, 'utf-8'));
  } catch (e) {
    fail(`banco de palabras no es JSON válido: ${e.message}`);
  }
  if (!Array.isArray(bank) || bank.length < MIN_SUBSET) {
    fail(`banco de palabras insuficiente (necesita al menos ${MIN_SUBSET} entradas, tiene ${bank?.length ?? 0})`);
  }
  const seen = new Set();
  for (const entry of bank) {
    if (!entry.id || !entry.answer || !entry.clue) {
      fail(`entrada inválida en el banco: ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry.id)) fail(`id duplicado en el banco: ${entry.id}`);
    seen.add(entry.id);
    if (!/^[A-Z]+$/.test(entry.answer)) {
      fail(`respuesta "${entry.answer}" (id ${entry.id}) debe estar normalizada: MAYÚSCULAS A-Z sin espacios ni tildes`);
    }
  }
  return bank;
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sampleSubset(bank) {
  const size = randomInt(MIN_SUBSET, Math.min(MAX_SUBSET, bank.length));
  const pool = [...bank];
  const picked = [];
  for (let i = 0; i < size; i++) {
    const idx = randomInt(0, pool.length - 1);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

function jaccard(setA, setB) {
  let intersection = 0;
  for (const id of setA) if (setB.has(id)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function subsetIsDiverseEnough(subset, acceptedIdSets) {
  const ids = new Set(subset.map((w) => w.id));
  for (const prev of acceptedIdSets) {
    if (jaccard(ids, prev) > JACCARD_THRESHOLD) return false;
  }
  return true;
}

// --- Etapa 2: colocación en grilla ---

const key = (r, c) => `${r},${c}`;

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Ordena de mayor a menor longitud; dentro del mismo largo, orden aleatorio (varía entre intentos).
function orderWords(words) {
  const byLength = new Map();
  for (const w of words) {
    const len = w.answer.length;
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len).push(w);
  }
  const lengths = [...byLength.keys()].sort((a, b) => b - a);
  const ordered = [];
  for (const len of lengths) ordered.push(...shuffle(byLength.get(len)));
  return ordered;
}

function canPlace(grid, word, row, col, orientation) {
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

function candidatePositions(word, placedEntries) {
  const candidates = new Map(); // "row,col,orientation" -> true
  const list = [];
  for (const entry of placedEntries) {
    const perpendicular = entry.orientation === 'H' ? 'V' : 'H';
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

function tryPlaceSubset(subset) {
  const words = orderWords(subset);
  const grid = new Map();
  const placedEntries = [];
  const discarded = [];

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
    let best = null;
    for (const cand of candidates) {
      const result = canPlace(grid, word, cand.row, cand.col, cand.orientation);
      if (result && (!best || result.intersections > best.result.intersections)) {
        best = { ...cand, result };
      }
    }
    if (!best) {
      discarded.push(bankEntry.id);
      continue;
    }
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
        (other) => other !== entry && other.orientation !== entry.orientation && cellsOverlap(entry, other, r, c)
      );
      if (sharedWith) {
        hasCrossing = true;
        break;
      }
    }
    if (!hasCrossing) return null; // entrada aislada -> descartar intento completo
  }

  if (placedEntries.length < MIN_ENTRIES_IN_PUZZLE) return null;

  return { placedEntries, grid };
}

function cellsOverlap(entryA, entryB, row, col) {
  const dr = entryB.orientation === 'V' ? 1 : 0;
  const dc = entryB.orientation === 'H' ? 1 : 0;
  for (let i = 0; i < entryB.length; i++) {
    const r = entryB.row + dr * i;
    const c = entryB.col + dc * i;
    if (r === row && c === col) return true;
  }
  return false;
}

function finalizePuzzle(id, placedEntries) {
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
  const startPoints = new Map(); // "r,c" -> number
  const sortedByPosition = [...shifted].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  let counter = 1;
  for (const entry of sortedByPosition) {
    const posKey = key(entry.row, entry.col);
    if (!startPoints.has(posKey)) {
      startPoints.set(posKey, counter++);
    }
  }

  const cellIndex = {};
  const entries = shifted.map((entry) => {
    const dr = entry.orientation === 'V' ? 1 : 0;
    const dc = entry.orientation === 'H' ? 1 : 0;
    const cellRefs = [];
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
      number: startPoints.get(key(entry.row, entry.col)),
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

function generatePuzzle(bank, puzzleId, acceptedIdSets) {
  for (let attempt = 0; attempt < SUBSET_ATTEMPTS_PER_PUZZLE; attempt++) {
    const subset = sampleSubset(bank);
    if (!subsetIsDiverseEnough(subset, acceptedIdSets)) continue;

    for (let placeAttempt = 0; placeAttempt < PLACEMENT_ATTEMPTS_PER_SUBSET; placeAttempt++) {
      const placement = tryPlaceSubset(subset);
      if (placement) {
        acceptedIdSets.push(new Set(subset.map((w) => w.id)));
        return finalizePuzzle(puzzleId, placement.placedEntries);
      }
    }
  }
  return null;
}

function main() {
  const bank = loadWordBank(args.bank);
  if (!Number.isInteger(args.count) || args.count < 1) {
    fail(`--count debe ser un entero positivo (recibido: ${args.count})`);
  }

  const outDir = path.resolve(repoRoot, args.out);
  mkdirSync(outDir, { recursive: true });

  const acceptedIdSets = [];
  const puzzleIds = [];

  for (let n = 1; n <= args.count; n++) {
    const puzzleId = `puzzle-${String(n).padStart(2, '0')}`;
    const puzzle = generatePuzzle(bank, puzzleId, acceptedIdSets);
    if (!puzzle) {
      fail(
        `no se pudo generar un puzzle diverso y válido para "${puzzleId}" tras ${SUBSET_ATTEMPTS_PER_PUZZLE} intentos. ` +
          `El banco de palabras es insuficiente para producir ${args.count} puzzles diversos (>=${MIN_SUBSET} palabras, <${JACCARD_THRESHOLD * 100}% similitud, >=${MIN_ENTRIES_IN_PUZZLE} entradas cruzadas). Agregá más palabras al banco.`
      );
    }
    writeFileSync(path.join(outDir, `${puzzleId}.json`), JSON.stringify(puzzle, null, 2));
    puzzleIds.push(puzzleId);
    console.log(`[generate-puzzles] ${puzzleId}: ${puzzle.entries.length} entradas, grilla ${puzzle.rows}x${puzzle.cols}`);
  }

  const manifest = { puzzleIds };
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[generate-puzzles] listo: ${puzzleIds.length} puzzles en ${outDir}`);
}

main();
