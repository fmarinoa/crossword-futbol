import type { Puzzle, RevealedCell } from './types';

export type Action =
  | { type: 'HYDRATE'; puzzle: Puzzle; solvedEntryIds: string[]; revealedCells: RevealedCell[] }
  | { type: 'SELECT_ENTRY'; entryId: string }
  | { type: 'DESELECT' }
  | { type: 'SUBMIT_ANSWER_START'; entryId: string }
  | { type: 'SUBMIT_ANSWER_SUCCESS'; entryId: string; correct: boolean; revealedCells?: RevealedCell[] }
  | { type: 'SUBMIT_ANSWER_FAILURE'; message: string };

export interface PuzzleState {
  puzzle: Puzzle;
  solvedEntryIds: Set<string>;
  revealedCells: Map<string, string>;
  activeEntryId: string | null;
  lastSubmissionWasWrong: boolean;
  submitting: boolean;
  submitError: string | null;
}

function toRevealedMap(cells: RevealedCell[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const cell of cells) map.set(`${cell.row},${cell.col}`, cell.letter);
  return map;
}

export function createInitialState(puzzle: Puzzle): PuzzleState {
  return {
    puzzle,
    solvedEntryIds: new Set(),
    revealedCells: new Map(),
    activeEntryId: null,
    lastSubmissionWasWrong: false,
    submitting: false,
    submitError: null,
  };
}

export function puzzleReducer(state: PuzzleState, action: Action): PuzzleState {
  switch (action.type) {
    case 'HYDRATE': {
      return {
        puzzle: action.puzzle,
        solvedEntryIds: new Set(action.solvedEntryIds),
        revealedCells: toRevealedMap(action.revealedCells),
        activeEntryId: null,
        lastSubmissionWasWrong: false,
        submitting: false,
        submitError: null,
      };
    }

    case 'SELECT_ENTRY': {
      if (state.solvedEntryIds.has(action.entryId)) return state;
      return { ...state, activeEntryId: action.entryId, lastSubmissionWasWrong: false, submitError: null };
    }

    case 'DESELECT': {
      if (state.activeEntryId === null && !state.lastSubmissionWasWrong && !state.submitError) return state;
      return { ...state, activeEntryId: null, lastSubmissionWasWrong: false, submitError: null };
    }

    case 'SUBMIT_ANSWER_START': {
      if (state.activeEntryId !== action.entryId) return state;
      return { ...state, submitting: true, submitError: null };
    }

    case 'SUBMIT_ANSWER_SUCCESS': {
      if (state.activeEntryId !== action.entryId) return state;

      if (!action.correct) {
        return { ...state, submitting: false, lastSubmissionWasWrong: true };
      }

      const solvedEntryIds = new Set(state.solvedEntryIds);
      solvedEntryIds.add(action.entryId);

      const revealedCells = new Map(state.revealedCells);
      for (const cell of action.revealedCells ?? []) {
        revealedCells.set(`${cell.row},${cell.col}`, cell.letter);
      }

      return {
        ...state,
        solvedEntryIds,
        revealedCells,
        activeEntryId: null,
        lastSubmissionWasWrong: false,
        submitting: false,
        submitError: null,
      };
    }

    case 'SUBMIT_ANSWER_FAILURE': {
      // Error de red/servidor: distinto de "respuesta incorrecta", no dispara el shake.
      return { ...state, submitting: false, submitError: action.message };
    }

    default:
      return state;
  }
}
