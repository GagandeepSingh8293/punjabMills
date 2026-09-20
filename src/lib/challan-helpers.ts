import type { ChallanRecord } from "@/types/challan";

export type ChallanEffectiveStatus = "draft" | "saved" | "billed";

export const CHALLAN_STATUS_LABELS: Record<ChallanEffectiveStatus, string> = {
  draft: "Draft",
  saved: "Saved",
  billed: "Billed",
};

/**
 * A challan's displayed status. The backend injects `billed` on every record (derived from
 * the Billing module) so this is a pure read of the row, mirroring `challanEffectiveStatus`.
 */
export function challanEffectiveStatus(challan: ChallanRecord | { billed?: boolean; status?: string }): ChallanEffectiveStatus {
  if (challan.billed === true) return "billed";
  const status = challan.status ?? "draft";
  if (status === "draft" || status === "saved") return status;
  return "draft";
}

export function challanTotalWeight(challan: Pick<ChallanRecord, "lineItems">): number {
  return challan.lineItems.reduce(
    (sum, item) => sum + (item.weight ?? 0) + (item.ribWeight ?? 0),
    0
  );
}

export function challanDispatchedWeight(challan: ChallanRecord): number {
  return challan.dispatchedWeight ?? 0;
}

export function challanPendingWeight(challan: ChallanRecord): number {
  return challan.pendingWeight ?? challanTotalWeight(challan) - challanDispatchedWeight(challan);
}

function distinctLineItemValues(challan: { lineItems: { colour?: string; depth?: string; hsnCode?: string }[] }, field: "colour" | "depth" | "hsnCode"): string[] {
  return Array.from(
    new Set(
      challan.lineItems
        .map((item) => item[field]?.trim())
        .filter((v): v is string => Boolean(v))
    )
  );
}

export function formatMultiValue(values: string[]): string {
  if (values.length === 0) return "—";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
}

export function challanHsnCodes(challan: ChallanRecord): string[] {
  return distinctLineItemValues(challan, "hsnCode");
}

export function challanColours(challan: ChallanRecord): string[] {
  return distinctLineItemValues(challan, "colour");
}

export function challanDepths(challan: ChallanRecord): string[] {
  return distinctLineItemValues(challan, "depth");
}