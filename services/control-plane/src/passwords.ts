import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;

/** 不检查字符种类。只拒绝空密码和一份本地常见弱密码，完整撞库库尚未接入。 */
const LOCAL_WEAK_PASSWORDS = new Set([
  "12345678",
  "00000000",
  "11111111",
  "password",
  "qwertyui",
  "abc12345",
]);

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function assertPasswordAcceptable(password: string): string | null {
  if (password.length < 8) return "password_too_short";
  if (LOCAL_WEAK_PASSWORDS.has(password.toLowerCase())) return "password_too_weak";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const expected = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secretsMatch(value: string, storedHash: string): boolean {
  const actual = Buffer.from(hashSecret(value), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createChallengeCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createRecoveryCode(): string {
  const groups: string[] = [];
  for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
    let group = "";
    for (let charIndex = 0; charIndex < 4; charIndex += 1) {
      group += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export function normalizeMainlandPhone(input: string): string | null {
  const compact = input.replace(/[\s-]/g, "");
  if (/^1\d{10}$/.test(compact)) return compact;
  if (/^\+861\d{10}$/.test(compact)) return compact.slice(3);
  return null;
}

export function maskPhone(phone: string): string {
  if (phone.length < 7) return "****";
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

export function normalizeEmail(input: string): string | null {
  const compact = input.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(compact)) return null;
  return compact;
}
