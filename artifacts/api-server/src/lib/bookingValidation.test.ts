import { describe, it, expect } from "vitest";
import {
  intervalsOverlap,
  slotConflictsWithBlocked,
  serviceBelongsToProvider,
  slotBelongsToProvider,
  paymentRequiredForCategory,
} from "./bookingValidation";

const at = (iso: string) => new Date(iso);

describe("intervalsOverlap", () => {
  const slot = { startTime: at("2026-06-16T10:00:00Z"), endTime: at("2026-06-16T11:00:00Z") };

  it("detects an enclosing interval", () => {
    expect(
      intervalsOverlap(slot, {
        startTime: at("2026-06-16T09:00:00Z"),
        endTime: at("2026-06-16T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("detects a partial overlap at the start", () => {
    expect(
      intervalsOverlap(slot, {
        startTime: at("2026-06-16T09:30:00Z"),
        endTime: at("2026-06-16T10:30:00Z"),
      }),
    ).toBe(true);
  });

  it("treats touching edges (half-open) as NOT overlapping", () => {
    // blocked ends exactly when slot starts
    expect(
      intervalsOverlap(slot, {
        startTime: at("2026-06-16T09:00:00Z"),
        endTime: at("2026-06-16T10:00:00Z"),
      }),
    ).toBe(false);
    // blocked starts exactly when slot ends
    expect(
      intervalsOverlap(slot, {
        startTime: at("2026-06-16T11:00:00Z"),
        endTime: at("2026-06-16T12:00:00Z"),
      }),
    ).toBe(false);
  });

  it("returns false for fully disjoint intervals", () => {
    expect(
      intervalsOverlap(slot, {
        startTime: at("2026-06-16T14:00:00Z"),
        endTime: at("2026-06-16T15:00:00Z"),
      }),
    ).toBe(false);
  });
});

describe("slotConflictsWithBlocked", () => {
  const slot = { startTime: at("2026-06-16T10:00:00Z"), endTime: at("2026-06-16T11:00:00Z") };

  it("is false when no blocked intervals exist", () => {
    expect(slotConflictsWithBlocked(slot, [])).toBe(false);
  });

  it("is false when all blocked intervals are disjoint", () => {
    expect(
      slotConflictsWithBlocked(slot, [
        { startTime: at("2026-06-16T08:00:00Z"), endTime: at("2026-06-16T09:00:00Z") },
        { startTime: at("2026-06-16T12:00:00Z"), endTime: at("2026-06-16T13:00:00Z") },
      ]),
    ).toBe(false);
  });

  it("is true when any blocked interval overlaps (SLOT_BLOCKED race)", () => {
    expect(
      slotConflictsWithBlocked(slot, [
        { startTime: at("2026-06-16T08:00:00Z"), endTime: at("2026-06-16T09:00:00Z") },
        { startTime: at("2026-06-16T10:30:00Z"), endTime: at("2026-06-16T11:30:00Z") },
      ]),
    ).toBe(true);
  });
});

describe("serviceBelongsToProvider", () => {
  it("is true only when the service's providerId matches", () => {
    expect(serviceBelongsToProvider({ providerId: 7 }, 7)).toBe(true);
    expect(serviceBelongsToProvider({ providerId: 7 }, 8)).toBe(false);
  });
});

describe("slotBelongsToProvider", () => {
  it("is true only when the slot's providerId matches", () => {
    expect(slotBelongsToProvider({ providerId: 7 }, 7)).toBe(true);
    expect(slotBelongsToProvider({ providerId: 99 }, 7)).toBe(false);
  });
});

describe("paymentRequiredForCategory", () => {
  it("requires payment for standard categories", () => {
    expect(paymentRequiredForCategory({ requiresDirectBilling: false })).toBe(true);
    expect(paymentRequiredForCategory({})).toBe(true);
    expect(paymentRequiredForCategory(null)).toBe(true);
    expect(paymentRequiredForCategory(undefined)).toBe(true);
  });

  it("does not require payment for direct-billing categories (RVG/StBVV)", () => {
    expect(paymentRequiredForCategory({ requiresDirectBilling: true })).toBe(false);
  });
});
