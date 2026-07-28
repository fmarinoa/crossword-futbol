export interface PlacedEntry {
  wordId: string;
  number: number;
  orientation: 'H' | 'V';
  row: number;
  col: number;
  length: number;
  cellRefs: { row: number; col: number }[];
  clue: string;
}

export interface Puzzle {
  id: string;
  rows: number;
  cols: number;
  entries: PlacedEntry[];
  cellIndex: Record<string, string[]>;
}

export interface RevealedCell {
  row: number;
  col: number;
  letter: string;
}

export interface Progress {
  solvedEntryIds: string[];
  revealedCells: RevealedCell[];
}

export interface RoomState {
  roomId: string;
  puzzle: Puzzle;
  progress: Progress;
}

export interface SubmitResult {
  correct: boolean;
  revealedCells?: RevealedCell[];
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
