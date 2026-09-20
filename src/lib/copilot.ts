import type { ChallanRecord } from "@/types/challan";
import type { Invoice } from "@/types/billing";
import { formatINR } from "@/lib/utils";
import { challanEffectiveStatus } from "@/lib/challan-helpers";

/**
 * Offline stand-in for the reference app's `/api/copilot` route. There is no AI layer in
 * the desktop build, so this heuristically matches a query against the live local data and
 * returns deterministic, data-backed answers. Unknown queries get a helpful fallback.
 */
export function copilotAnswer(
  query: string,
  context: { challans: ChallanRecord[]; invoices: Invoice[] }
): string {
  const q = query.toLowerCase().trim();
  const { challans, invoices } = context;

  const countWhere = (fn: (c: ChallanRecord) => boolean) => challans.filter(fn).length;
  const totalWeight = (list: ChallanRecord[]) =>
    Math.round(list.reduce((sum, c) => sum + c.lineItems.reduce((s, i) => s + (i.weight ?? 0) + (i.ribWeight ?? 0), 0), 0) * 100) / 100;

  if (/(total|how many|count of)?\s*(incoming|inward)/.test(q) && /challan|lot|goods|fabric/.test(q)) {
    const n = countWhere((c) => c.documentType === "incoming");
    return `You have ${n} incoming challan${n === 1 ? "" : "s"} on record. ${
      n > 0 ? `The most recent is lot ${challans.find((c) => c.documentType === "incoming")?.header.challanNo ?? "—"}.` : ""
    }`;
  }

  if (/(total|how many|count of)?\s*(outgoing|outward|dispatch)/.test(q) && /challan|lot|goods|fabric/.test(q)) {
    const n = countWhere((c) => c.documentType === "outgoing");
    return `You have ${n} outgoing challan${n === 1 ? "" : "s"}. Of these, ${countWhere(
      (c) => c.documentType === "outgoing" && !c.billed
    )} are still pending billing.`;
  }

  if (/pending.*(billing|invoice)|unbilled|to bill/.test(q)) {
    const pending = challans.filter((c) => c.documentType === "outgoing" && !c.billed);
    return `There ${pending.length === 1 ? "is" : "are"} ${pending.length} unbilled outgoing challan${
      pending.length === 1 ? "" : "s"
    } worth approximately ${formatINR(
      pending.reduce((sum, c) => sum + c.lineItems.reduce((s, i) => s + (i.weight ?? 0) * (i.rate ?? 0), 0), 0)
    )} in job-work value. Head to Billing → Generate to raise invoices.`;
  }

  if (/(draft|saved|billed)\s*challan|status\b/.test(q)) {
    const draft = countWhere((c) => challanEffectiveStatus(c) === "draft");
    const saved = countWhere((c) => challanEffectiveStatus(c) === "saved");
    const billed = countWhere((c) => challanEffectiveStatus(c) === "billed");
    return `Breakdown by status: ${draft} draft, ${saved} saved, and ${billed} billed.`;
  }

  if (/invoice|billed this month|this month/.test(q) && /(total|value|amount|revenue)/.test(q)) {
    const value = invoices.reduce((sum, i) => sum + i.totals.grandTotal, 0);
    return `Across ${invoices.length} invoice${invoices.length === 1 ? "" : "s"} on record, the billed value totals ${formatINR(
      value
    )}.`;
  }

  if (/paid\s*invoice|received|collected|outstanding/.test(q)) {
    const paid = invoices.filter((i) => i.status === "paid");
    const sent = invoices.filter((i) => i.status === "sent");
    return `${paid.length} invoice${paid.length === 1 ? " is" : "s are"} paid (${formatINR(
      paid.reduce((s, i) => s + i.totals.grandTotal, 0)
    )}), and ${sent.length} invoice${sent.length === 1 ? " is" : "s are"} still outstanding (${formatINR(
      sent.reduce((s, i) => s + i.totals.grandTotal, 0)
    )}).`;
  }

  if (/(vehicle|truck|lorry|transport)/.test(q) && /(latest|recent|today|this week)/.test(q)) {
    const vehicle = challans.find((c) => c.header.vehicleNo)?.header.vehicleNo;
    return vehicle
      ? `The most recent challan on record was moved by vehicle ${vehicle}.`
      : `No vehicle numbers on record yet.`;
  }

  if (/weight|tonnage|kgs|kg\b/.test(q) && /(incoming|received|this week|today)/.test(q)) {
    const w = totalWeight(challans.filter((c) => c.documentType === "incoming"));
    return `Incoming challans total ${w.toLocaleString("en-IN")} kg of grey material across all records.`;
  }

  if (/hello|hi\b|hey/.test(q)) {
    return "Hello! I can answer questions about your challans, billing status, and job-work totals from the local data. Try asking about pending billing or the number of outgoing challans.";
  }

  return "I couldn't map that question to a record here. Try asking about pending billing, challan statuses, invoice totals, or vehicle movements.";
}