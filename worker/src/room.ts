import { DurableObject } from 'cloudflare:workers';
import { generatePuzzle } from './generator';
import { checkAnswer } from './validator';
import type {
  ClientPuzzle,
  Difficulty,
  Env,
  RevealedCell,
  RoomState,
  StructuralEntry,
  StructuralPuzzle,
  SubmitResult,
  WordBankEntry,
} from './types';

const MIN_POOL_SIZE = 15; // debe coincidir con MIN_SUBSET en generator.ts

function cellsFor(entry: StructuralEntry, answer: string): RevealedCell[] {
  return entry.cellRefs.map((cell, i) => ({ row: cell.row, col: cell.col, letter: answer[i] }));
}

export class Room extends DurableObject<Env> {
  async createPuzzle(roomId: string, difficulty?: Difficulty | Difficulty[]): Promise<RoomState> {
    const existing = await this.ctx.storage.get<StructuralPuzzle>('puzzle');
    if (existing) throw new Error('room already exists');

    const pool = await this.fetchPool(difficulty);
    if (pool.length < MIN_POOL_SIZE) throw new Error('not enough words for requested difficulty');

    const puzzle = generatePuzzle(pool, roomId);
    if (!puzzle) throw new Error('no se pudo generar un puzzle válido');

    await this.ctx.storage.put('puzzle', puzzle);
    await this.ctx.storage.put('solved', [] as string[]);
    const bankById = await this.fetchByIds(puzzle.entries.map((e) => e.wordId));
    return this.hydrate(roomId, puzzle, [], bankById);
  }

  async getState(roomId: string): Promise<RoomState | null> {
    const puzzle = await this.ctx.storage.get<StructuralPuzzle>('puzzle');
    if (!puzzle) return null;
    const solved = (await this.ctx.storage.get<string[]>('solved')) ?? [];
    const bankById = await this.fetchByIds(puzzle.entries.map((e) => e.wordId));
    return this.hydrate(roomId, puzzle, solved, bankById);
  }

  async submitAnswer(entryId: string, value: string): Promise<SubmitResult> {
    const puzzle = await this.ctx.storage.get<StructuralPuzzle>('puzzle');
    if (!puzzle) throw new Error('room not found');

    const entry = puzzle.entries.find((e) => e.wordId === entryId);
    const bankEntry = (await this.fetchByIds([entryId])).get(entryId);
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

  private async fetchPool(difficulty?: Difficulty | Difficulty[]): Promise<WordBankEntry[]> {
    const list = difficulty === undefined ? [] : Array.isArray(difficulty) ? difficulty : [difficulty];
    if (list.length === 0) {
      const { results } = await this.env.DB.prepare(
        'SELECT id, answer, clue, category, difficulty FROM words',
      ).all<WordBankEntry>();
      return results;
    }
    const placeholders = list.map(() => '?').join(',');
    const { results } = await this.env.DB.prepare(
      `SELECT id, answer, clue, category, difficulty FROM words WHERE difficulty IN (${placeholders})`,
    )
      .bind(...list)
      .all<WordBankEntry>();
    return results;
  }

  private async fetchByIds(ids: string[]): Promise<Map<string, WordBankEntry>> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await this.env.DB.prepare(
      `SELECT id, answer, clue, category, difficulty FROM words WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<WordBankEntry>();
    return new Map(results.map((r) => [r.id, r]));
  }

  private hydrate(
    roomId: string,
    puzzle: StructuralPuzzle,
    solved: string[],
    bankById: Map<string, WordBankEntry>,
  ): RoomState {
    const entries = puzzle.entries.map((entry) => ({
      ...entry,
      clue: bankById.get(entry.wordId)?.clue ?? '',
    }));
    const clientPuzzle: ClientPuzzle = { ...puzzle, entries };

    const revealedCells: RevealedCell[] = [];
    for (const wordId of solved) {
      const entry = puzzle.entries.find((e) => e.wordId === wordId);
      const bankEntry = bankById.get(wordId);
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
