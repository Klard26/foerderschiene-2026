import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

export const apiLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

export const writeLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

/**
 * Public Förderprogramm-Finder endpoint: each submission triggers an AI
 * generation AND an outbound email to an arbitrary address, so it gets a much
 * stricter per-IP budget than the general AI limiter.
 */
export const finderLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error:
      "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
  },
});

export const aiLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "AI rate limit exceeded. Please try again in a minute." },
});
