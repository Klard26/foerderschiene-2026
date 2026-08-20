import { describe, it, expect } from "vitest";
import {
  generateAccessToken,
  hashAccessToken,
  verifyAccessToken,
} from "./requestAccessToken";

describe("generateAccessToken", () => {
  it("returns a high-entropy raw token together with its SHA-256 hash", () => {
    const { token, tokenHash } = generateAccessToken();
    // base64url of 32 random bytes is 43 chars.
    expect(token).toHaveLength(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashAccessToken(token));
  });

  it("never repeats a token across calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateAccessToken().token);
    expect(seen.size).toBe(100);
  });
});

describe("hashAccessToken", () => {
  it("is deterministic and one-way (hash != raw)", () => {
    const { token } = generateAccessToken();
    expect(hashAccessToken(token)).toBe(hashAccessToken(token));
    expect(hashAccessToken(token)).not.toBe(token);
  });
});

describe("verifyAccessToken", () => {
  it("accepts the raw token against its own stored hash", () => {
    const { token, tokenHash } = generateAccessToken();
    expect(verifyAccessToken(token, tokenHash)).toBe(true);
  });

  it("rejects a wrong token", () => {
    const { tokenHash } = generateAccessToken();
    const other = generateAccessToken().token;
    expect(verifyAccessToken(other, tokenHash)).toBe(false);
  });

  it("rejects when either side is missing or empty", () => {
    const { token, tokenHash } = generateAccessToken();
    expect(verifyAccessToken(null, tokenHash)).toBe(false);
    expect(verifyAccessToken(undefined, tokenHash)).toBe(false);
    expect(verifyAccessToken("", tokenHash)).toBe(false);
    expect(verifyAccessToken(token, null)).toBe(false);
    expect(verifyAccessToken(token, undefined)).toBe(false);
    expect(verifyAccessToken(token, "")).toBe(false);
  });

  it("rejects a malformed (non-hex / wrong-length) stored hash without throwing", () => {
    const { token } = generateAccessToken();
    expect(verifyAccessToken(token, "deadbeef")).toBe(false);
    expect(verifyAccessToken(token, "zzz")).toBe(false);
  });
});
