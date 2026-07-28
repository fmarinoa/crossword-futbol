import { DurableObject } from 'cloudflare:workers';
import wordBankRaw from '../../data/word-bank.json';
import { generatePuzzle } from './generator';
import { checkAnswer } from './validator';
import type {
  ClientPuzzle,
  Env,
  RevealedCell,
  RoomState,
  StructuralEntry,
  StructuralPuzzle,
  SubmitResult,
  WordBankEntry,
} from './types';

const WORD_BANK = wordBankRaw as WordBankEntry[];
const WORD_BANK_BY_ID = new Map(WORD_BANK.map((entry) => [entry.id, entry]));

function cellsFor(entry: StructuralEntry, answer: string): RevealedCell[] {
  return entry.cellRefs.map((cell, i) => ({ row: cell.row, col: cell.col, letter: answer[i] }));
}

export class Room extends DurableObject<Env> {
  async createPuzzle(roomId: string): Promise<RoomState> {
    const existing = await this.ctx.storage.get<StructuralPuzzle>('puzzle');
    if (existing) throw new Error('room already exists');

    const puzzle = generatePuzzle(WORD_BANK, roomId);
    if (!puzzle) throw new Error('no se pudo generar un puzzle válido');

    await this.ctx.storage.put('puzzle', puzzle);
    await this.ctx.storage.put('solved', [] as string[]);
    return this.hydrate(roomId, puzzle, []);
  }

  async getState(roomId: string): Promise<RoomState | null> {
    const puzzle = await this.ctx.storage.get<StructuralPuzzle>('puzzle');
    if (!puzzle) return null;
    const solved = (await this.ctx.storage.get<string[]>('solved')) ?? [];
    return this.hydrate(roomId, puzzle, solved);
  }

  async submitAnswer(entryId: string, value: string): Promise<SubmitResult> {
    const puzzle = await this.ctx.storage.get<StructuralPuzzle>('puzzle');
    if (!puzzle) throw new Error('room not found');

    const entry = puzzle.entries.find((e) => e.wordId === entryId);
    const bankEntry = WORD_BANK_BY_ID.get(entryId);
    if (!entry || !bankEntry) throw new Error('unknown entryId');

    const solved = (await this.ctx.storage.get<string[]>('solved')) ?? [];
    if (solved.includes(entryId)) {
      return { correct: true, revealedCells: cellsFor(entry, bankEntry.answer) };
    }

    if (!checkAnswer(value, bankEntry.answer)) {
      return { correct: false };
    }

    await this.ctx.storage.put('solved', [...solved, entryId]);
    return { correct: true, revealedCells: cellsFor(entry, bankEntry.answer) };
  }

  private hydrate(roomId: string, puzzle: StructuralPuzzle, solved: string[]): RoomState {
    const entries = puzzle.entries.map((entry) => ({
      ...entry,
      clue: WORD_BANK_BY_ID.get(entry.wordId)?.clue ?? '',
    }));
    const clientPuzzle: ClientPuzzle = { ...puzzle, entries };

    const revealedCells: RevealedCell[] = [];
    for (const wordId of solved) {
      const entry = puzzle.entries.find((e) => e.wordId === wordId);
      const bankEntry = WORD_BANK_BY_ID.get(wordId);
      if (!entry || !bankEntry) continue;
      revealedCells.push(...cellsFor(entry, bankEntry.answer));
    }

    return {
      roomId,
      puzzle: clientPuzzle,
      progress: { solvedEntryIds: solved, revealedCells },
    };
  }
}
