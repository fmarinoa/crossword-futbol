import type { Room } from './room';

export interface WordBankEntry {
  id: string;
  answer: string;
  clue: string;
  category: string;
}

// Forma estructural de la grilla: sin answer ni clue, se guarda tal cual en el storage del DO.
export interface StructuralEntry {
  wordId: string;
  number: number;
  orientation: 'H' | 'V';
  row: number;
  col: number;
  length: number;
  cellRefs: { row: number; col: number }[];
}

export interface StructuralPuzzle {
  id: string;
  rows: number;
  cols: number;
  entries: StructuralEntry[];
  cellIndex: Record<string, string[]>;
}

// Forma que viaja al cliente: cada entry lleva su clue embebido, nunca el answer.
export interface ClientEntry extends StructuralEntry {
  clue: string;
}

export interface ClientPuzzle {
  id: string;
  rows: number;
  cols: number;
  entries: ClientEntry[];
  cellIndex: Record<string, string[]>;
}

export interface RevealedCell {
  row: number;
  col: number;
  letter: string;
}

export interface RoomState {
  roomId: string;
  puzzle: ClientPuzzle;
  progress: {
    solvedEntryIds: string[];
    revealedCells: RevealedCell[];
  };
}

export interface SubmitResult {
  correct: boolean;
  revealedCells?: RevealedCell[];
}

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}
