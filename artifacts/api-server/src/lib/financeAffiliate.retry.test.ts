import { describe, expect, it, vi } from "vitest";

const dbFailure = new Error("temporary database outage");
const state = vi.hoisted(() => {
  let retryValues: Record<string, unknown> | null = null;
  const where = vi.fn(async () => undefined);
  const set = vi.fn((values: Record<string, unknown>) => {
    retryValues = values;
    return { where };
  });
  return {
    get retryValues() {
      return retryValues;
    },
    reset() {
      retryValues = null;
      where.mockClear();
      set.mockClear();
    },
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              throw dbFailure;
            }),
          })),
        })),
      })),
      update: vi.fn(() => ({ set })),
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: state.db };
});

vi.mock("./email", () => ({
  sendFinanceLeadToPartner: vi.fn(),
  wasEmailSent: vi.fn(),
}));

vi.mock("./foerderschiene", () => ({
  matchFoerderschiene: vi.fn(),
}));

import { createFinanceLeadsForPaidReport } from "./financeAffiliate";

describe("createFinanceLeadsForPaidReport — failed creation retry", () => {
  it("persists a delayed retry with the error before rethrowing", async () => {
    state.reset();
    const before = Date.now();

    await expect(createFinanceLeadsForPaidReport(42)).rejects.toThrow(dbFailure);

    expect(state.db.update).toHaveBeenCalledTimes(1);
    expect(state.retryValues).toMatchObject({
      financeLeadLastError: "temporary database outage",
    });
    expect(state.retryValues?.financeLeadRetryAt).toBeInstanceOf(Date);
    expect((state.retryValues?.financeLeadRetryAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 60_000,
    );
  });
});