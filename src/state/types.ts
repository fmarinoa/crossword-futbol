export interface WordBankEntry {
  id: string;
  answer: string;
  clue: string;
  category: string;
}

export interface PlacedEntry {
  wordId: string;
  number: number;
  orientation: 'H' | 'V';
  row: number;
  col: number;
  length: number;
  cellRefs: { row: number; col: number }[];
}

export interface Puzzle {
  id: string;
  rows: number;
  cols: number;
  entries: PlacedEntry[];
  cellIndex: Record<string, string[]>;
}

export interface Manifest {
  puzzleIds: string[];
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
