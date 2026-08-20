/**
 * Direct Resend connector client for transactional email delivery.
 *
 * Replit manages the Resend credentials and refreshes connector access at
 * request time. The API server must therefore create a new connector client
 * for each call rather than caching credentials or handling API keys itself.
 */
import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

export const DEFAULT_RESEND_FROM_EMAIL =
  process.env["RESEND_FROM_EMAIL"] ??
  "Förderschiene <hello@xn--frderschiene-4ib.de>";

export interface ResendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string }>;
  idempotencyKey?: string;
}

export type ResendSendResult =
  | { sent: true; skipped: false; error: null }
  | { sent: false; skipped: true; error: string }
  | { sent: false; skipped: false; error: string };

function responseErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as Record<string, unknown>).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  const message = (body as Record<string, unknown>).message;
  return typeof message === "string" ? message : fallback;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    return responseErrorMessage(
      await response.json(),
      `Resend returned HTTP ${response.status}`,
    );
  } catch {
    return `Resend returned HTTP ${response.status}`;
  }
}

/**
 * Sends one email directly through the Replit-managed Resend connector.
 *
 * The connector supplies the provider credential out-of-process, so no Resend
 * API key is read from, persisted in, or exposed by this application.
 */
export async function sendEmailViaResend(
  input: ResendEmailInput,
): Promise<ResendSendResult> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  try {
    // Do not cache this object: connector credentials can rotate between calls.
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: DEFAULT_RESEND_FROM_EMAIL,
        to: input.to,
        subject: input.subject,
        ...(input.html === undefined ? {} : { html: input.html }),
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.replyTo === undefined ? {} : { reply_to: input.replyTo }),
        ...(input.attachments?.length
          ? { attachments: input.attachments }
          : {}),
      }),
    });

    if (response.ok) {
      return { sent: true, skipped: false, error: null };
    }

    return {
      sent: false,
      skipped: false,
      error: await readErrorMessage(response),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: input.to }, "Direct Resend connector request failed");
    return { sent: false, skipped: false, error };
  }
}

/**
 * Confirms that the Replit-managed Resend connection is currently authorized.
 * This is a read-only check and never sends an email.
 */
export async function isResendConfigured(): Promise<boolean> {
  try {
    const connectors = new ReplitConnectors();
    const response = await connectors.proxy("resend", "/domains", {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}