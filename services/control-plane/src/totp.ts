import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_MS = 30_000;

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpMatches(secret: string, code: string, nowMs: number): boolean {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const actual = Buffer.from(trimmed);
  for (const offsetMs of [-TOTP_STEP_MS, 0, TOTP_STEP_MS]) {
    const expected = Buffer.from(totpCode(secret, nowMs + offsetMs));
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

export function totpCode(secret: string, nowMs: number): string {
  const counter = Math.floor(nowMs / TOTP_STEP_MS);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) encoded += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return encoded;
}

function decodeBase32(secret: string): Buffer {
  const compact = secret.trim().toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of compact) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
