/**
 * Pure booking-precondition checks, extracted so the slot/provider matching and
 * external-calendar overlap rules can be unit-tested without a database.
 */

export interface TimeInterval {
  startTime: Date;
  endTime: Date;
}

/**
 * Half-open interval overlap: two intervals collide iff each starts strictly
 * before the other ends. Mirrors the SQL predicate used to find a booking's
 * conflicting `blocked_slots` (`blocked.start < slot.end AND blocked.end > slot.start`).
 */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}

/**
 * A booking's slot is unbookable when it overlaps ANY of the provider's
 * external-calendar busy intervals.
 */
export function slotConflictsWithBlocked(
  slot: TimeInterval,
  blocked: TimeInterval[],
): boolean {
  return blocked.some((b) => intervalsOverlap(slot, b));
}

/**
 * The chosen service must belong to the provider the booking is being created
 * against (defends against mixing a foreign service into a provider's booking).
 */
export function serviceBelongsToProvider(
  service: { providerId: number },
  providerId: number,
): boolean {
  return service.providerId === providerId;
}

/**
 * The chosen time slot must belong to the booking's provider.
 */
export function slotBelongsToProvider(
  slot: { providerId: number },
  providerId: number,
): boolean {
  return slot.providerId === providerId;
}

/**
 * Payment is required for a booking unless its category bills the customer
 * directly (RVG/StBVV categories: Anwalt, Steuerberater, etc.).
 */
export function paymentRequiredForCategory(
  category?: { requiresDirectBilling?: boolean | null } | null,
): boolean {
  return !(category?.requiresDirectBilling ?? false);
}
