/**
 * 房间号生成。早期实现从 base36 token 里用 /[^A-Z0-9]/ 过滤，而 token 只含小写字母和数字，
 * 等于把字母全删掉，房间号退化成纯数字，keyspace 从 36^6 掉到 10^6。
 * 这里改为按显式字母表拒绝采样，既恢复完整 keyspace 也避免取模偏置。
 */

export const ROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export type RandomBytes = (length: number) => Uint8Array;

const UNBIASED_LIMIT = 256 - (256 % ROOM_CODE_ALPHABET.length);

function defaultRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomRoomCode(randomBytes: RandomBytes = defaultRandomBytes) {
  const chars: string[] = [];
  while (chars.length < ROOM_CODE_LENGTH) {
    for (const byte of randomBytes(ROOM_CODE_LENGTH)) {
      if (chars.length === ROOM_CODE_LENGTH) break;
      if (byte >= UNBIASED_LIMIT) continue;
      chars.push(ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]);
    }
  }
  return chars.join("");
}
