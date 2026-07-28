// Validación server-side de respuestas. Duplicado del validator que antes vivía en el cliente
// (src/state/validator.ts, ahora borrado) — son ~15 líneas, no vale la pena un paquete
// compartido solo por esto.

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '') // quita diacríticos (tildes, diéresis)
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function checkAnswer(input: string, answer: string): boolean {
  return normalizeAnswer(input) === normalizeAnswer(answer);
}
