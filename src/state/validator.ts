import type { PlacedEntry, WordBankEntry } from './types';

// Mayúsculas, sin tildes/diacríticos, sin espacios. Punto más frágil del sistema: toda
// comparación de respuesta pasa por acá, de un solo lado o de los dos.
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '') // quita diacríticos (tildes, diéresis)
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function checkAnswer(input: string, entry: PlacedEntry, bankEntry: WordBankEntry): boolean {
  if (!bankEntry || bankEntry.id !== entry.wordId) return false;
  return normalizeAnswer(input) === normalizeAnswer(bankEntry.answer);
}
