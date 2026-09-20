import type { RateCardRecord } from "@/types/masters";

function norm(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

export interface RateContext {
  customerName?: string;
  process?: string;
  depth?: string;
  fabricQuality?: string;
}

/**
 * Finds the rate card applicable to a challan line item's customer/process/depth — see #75.
 * Requires all three of customer, process and depth to be filled in before suggesting
 * anything. When a fabric quality is given, a rate card carrying the same fabric quality
 * wins over a blanket one that leaves it blank.
 */
export function findMatchingRateCard(
  rateCards: RateCardRecord[],
  context: RateContext
): RateCardRecord | undefined {
  if (!norm(context.customerName) || !norm(context.process) || !norm(context.depth)) return undefined;

  const candidates = rateCards.filter(
    (card) =>
      norm(card.customerName) === norm(context.customerName) &&
      norm(card.process) === norm(context.process) &&
      norm(card.depth) === norm(context.depth)
  );
  if (candidates.length === 0) return undefined;

  const contextQuality = norm(context.fabricQuality);
  if (contextQuality) {
    const qualityMatch = candidates.find((card) => norm(card.fabricQuality) === contextQuality);
    if (qualityMatch) return qualityMatch;
  }
  return candidates.find((card) => !norm(card.fabricQuality)) ?? candidates[0];
}