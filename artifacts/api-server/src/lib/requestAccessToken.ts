/**
 * Guest access tokens for RfQ requests. A high-entropy opaque token is handed to
 * the customer ONCE at creation (and embedded in the emailed link); only its
 * SHA-256 hash is persisted (`requests.accessTokenHash`). Possession of the raw
 * token is the bearer credential for a guest to view offers + accept one.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a new opaque access token together with its SHA-256 hash. */
export function generateAccessToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented raw token against a stored hash. */
export function verifyAccessToken(
  token: string | null | undefined,
  storedHash: string | null | undefined,
): boolean {
  if (!token || !storedHash) return false;
  const a = Buffer.from(hashAccessToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
