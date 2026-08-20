import { afterEach, describe, expect, it, vi } from "vitest";

const connectorState = vi.hoisted(() => ({
  proxy: vi.fn(),
}));

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    proxy = connectorState.proxy;
  },
}));

import {
  DEFAULT_RESEND_FROM_EMAIL,
  isResendConfigured,
  sendEmailViaResend,
} from "./resendClient";

afterEach(() => {
  connectorState.proxy.mockReset();
});

describe("sendEmailViaResend", () => {
  it("sends through the direct Resend connector with the configured sender", async () => {
    connectorState.proxy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "fake-msg-id" }), { status: 202 }),
    );

    const result = await sendEmailViaResend({
      to: "user@example.com",
      subject: "Testnachricht",
      html: "<p>Hello</p>",
    });

    expect(result.sent).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.error).toBeNull();

    expect(connectorState.proxy).toHaveBeenCalledWith(
      "resend",
      "/emails",
      expect.objectContaining({ method: "POST" }),
    );
    const [, , options] = connectorState.proxy.mock.calls[0] as [
      string,
      string,
      { body: string; headers: Record<string, string> },
    ];
    const body = JSON.parse(options.body) as Record<string, unknown>;
    expect(body.from).toBe(DEFAULT_RESEND_FROM_EMAIL);
    expect(body.to).toBe("user@example.com");
    expect(body.subject).toBe("Testnachricht");
    expect(options.headers["Idempotency-Key"]).toEqual(expect.any(String));
  });

  it("returns error details on a non-2xx response without throwing", async () => {
    connectorState.proxy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Rate limited" } }),
        { status: 429 },
      ),
    );

    const result = await sendEmailViaResend({
      to: "user@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain("Rate limited");
  });

  it("returns an error when the connector request rejects", async () => {
    connectorState.proxy.mockRejectedValueOnce(new Error("Connector unavailable"));

    const result = await sendEmailViaResend({
      to: "user@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain("Connector unavailable");
  });
});

describe("isResendConfigured", () => {
  it("returns true when the domains endpoint responds successfully", async () => {
    connectorState.proxy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    expect(await isResendConfigured()).toBe(true);
    expect(connectorState.proxy).toHaveBeenCalledWith("resend", "/domains", {
      method: "GET",
    });
  });

  it("returns false when the domains endpoint reports an error", async () => {
    connectorState.proxy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "resend_unavailable" } }), { status: 503 }),
    );

    expect(await isResendConfigured()).toBe(false);
  });

  it("returns false when the connector is unavailable", async () => {
    connectorState.proxy.mockRejectedValueOnce(new Error("Not connected"));

    expect(await isResendConfigured()).toBe(false);
  });
});
