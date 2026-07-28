import type { Puzzle, WordBankEntry } from './types';
import { checkAnswer } from './validator';

export type Action =
  | { type: 'SELECT_ENTRY'; entryId: string }
  | { type: 'SUBMIT_ANSWER'; entryId: string; value: string }
  | { type: 'DESELECT' };

export interface PuzzleState {
  puzzle: Puzzle;
  solvedEntryIds: Set<string>;
  revealedCells: Map<string, string>;
  activeEntryId: string | null;
  lastSubmissionWasWrong: boolean;
}

export function createInitialState(puzzle: Puzzle): PuzzleState {
  return {
    puzzle,
    solvedEntryIds: new Set(),
    revealedCells: new Map(),
    activeEntryId: null,
    lastSubmissionWasWrong: false,
  };
}

// El reducer necesita el banco de palabras (clue + respuesta) para validar SUBMIT_ANSWER,
// así que se crea vía factory que lo cierra sobre bankById.
export function createPuzzleReducer(bankById: Map<string, WordBankEntry>) {
  return function puzzleReducer(state: PuzzleState, action: Action): PuzzleState {
    switch (action.type) {
      case 'SELECT_ENTRY': {
        if (state.solvedEntryIds.has(action.entryId)) return state;
        return { ...state, activeEntryId: action.entryId, lastSubmissionWasWrong: false };
      }

      case 'DESELECT': {
        if (state.activeEntryId === null && !state.lastSubmissionWasWrong) return state;
        return { ...state, activeEntryId: null, lastSubmissionWasWrong: false };
      }

      case 'SUBMIT_ANSWER': {
        const entry = state.puzzle.entries.find((e) => e.wordId === action.entryId);
        const bankEntry = bankById.get(action.entryId);
        if (!entry || !bankEntry) return state;

        const isCorrect = checkAnswer(action.value, entry, bankEntry);
        if (!isCorrect) {
          return { ...state, lastSubmissionWasWrong: true };
        }

        const solvedEntryIds = new Set(state.solvedEntryIds);
        solvedEntryIds.add(entry.wordId);

        const revealedCells = new Map(state.revealedCells);
        entry.cellRefs.forEach((cell, i) => {
          revealedCells.set(`${cell.row},${cell.col}`, bankEntry.answer[i]);
        });

        return {
          ...state,
          solvedEntryIds,
          revealedCells,
          activeEntryId: null,
          lastSubmissionWasWrong: false,
        };
      }

      default:
        return state;
    }
  };
}
