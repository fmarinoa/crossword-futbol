const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ROOM_ID_LENGTH = 10;

export function generateRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return id;
}
