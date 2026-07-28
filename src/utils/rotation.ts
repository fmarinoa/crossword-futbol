const STORAGE_KEY = 'crossword-futbol:played-history';
const HISTORY_LIMIT = 4;

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(history: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage no disponible (modo privado, etc.) — la rotación simplemente no persiste.
  }
}

function randomFrom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

// Elige el próximo puzzle evitando los últimos 3-4 jugados. Si todos están en el
// historial (banco agotado), lo limpia y elige entre todos de nuevo.
export function pickNextPuzzleId(allPuzzleIds: string[]): string {
  if (allPuzzleIds.length === 0) {
    throw new Error('manifest de puzzles vacío');
  }
  const history = readHistory();
  let eligible = allPuzzleIds.filter((id) => !history.includes(id));

  if (eligible.length === 0) {
    writeHistory([]);
    eligible = allPuzzleIds;
  }

  const chosen = randomFrom(eligible);
  const nextHistory = [chosen, ...history.filter((id) => id !== chosen)].slice(0, HISTORY_LIMIT);
  writeHistory(nextHistory);
  return chosen;
}
