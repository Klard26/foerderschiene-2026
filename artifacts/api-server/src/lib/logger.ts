import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
// Under Vitest the pino-pretty transport spawns a worker thread (thread-stream)
// that never settles inside the test worker, hanging module import. Skip it.
const isTest = !!process.env.VITEST;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
