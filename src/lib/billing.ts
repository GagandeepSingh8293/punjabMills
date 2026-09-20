import type {
  ChallanRecord,
  LineItem,
} from "@/types/challan";
import type { Invoice, InvoiceLineGroup, InvoiceLineWarning, InvoiceTotals, TaxLine } from "@/types/billing";
import { calculateTax, isInterStateSupply } from "@/lib/tax";
import type { JobWorkSettings, InvoiceNumberingSettings } from "@/types/masters";

/**
 * Client-side copy of the backend's invoice computation, used for the Generate preview
 * before the `generate_invoices` command persists. The command recomputes the same
 * numbers server-side, so preview and stored invoice always agree.
 */
export function groupLineItemsByHsn(challans: ChallanRecord[]): {
  groups: InvoiceLineGroup[];
  warnings: InvoiceLineWarning[];
} {
  const groupsByHsn = new Map<string, InvoiceLineGroup>();
  const warnings: InvoiceLineWarning[] = [];

  for (const challan of challans) {
    for (const item of challan.lineItems) {
      const amount = ((item.weight ?? 0) + (item.ribWeight ?? 0)) * (item.rate ?? 0);

      if (!item.hsnCode) {
        warnings.push({
          challanId: challan.id,
          lineItemId: item.id,
          particulars: item.particulars || "—",
          lotNo: item.lotNo || "—",
        });
        continue;
      }

      const existing = groupsByHsn.get(item.hsnCode);
      if (existing) {
        existing.totalRoll += (item.roll ?? 0) + (item.ribRoll ?? 0);
        existing.totalWeight += (item.weight ?? 0) + (item.ribWeight ?? 0);
        existing.amount = Math.round((existing.amount + amount) * 100) / 100;
        if (item.lotNo && !existing.lotNos.includes(item.lotNo)) existing.lotNos.push(item.lotNo);
      } else {
        groupsByHsn.set(item.hsnCode, {
          hsnCode: item.hsnCode,
          particulars: item.particulars || "—",
          lotNos: item.lotNo ? [item.lotNo] : [],
          totalRoll: (item.roll ?? 0) + (item.ribRoll ?? 0),
          totalWeight: (item.weight ?? 0) + (item.ribWeight ?? 0),
          amount: Math.round(amount * 100) / 100,
        });
      }
    }
  }

  return { groups: Array.from(groupsByHsn.values()), warnings };
}

export function computeInvoiceLineData(
  challans: ChallanRecord[],
  tenantStateCode: string | null | undefined,
  jobWork: JobWorkSettings
): {
  lineGroups: InvoiceLineGroup[];
  warnings: InvoiceLineWarning[];
  taxLines: TaxLine[];
  totals: InvoiceTotals;
} {
  const { groups, warnings } = groupLineItemsByHsn(challans);

  const firstChallan = challans[0];
  const isInterState = isInterStateSupply(tenantStateCode, firstChallan?.header.billing.stateCode);

  const taxLines = calculateTax(groups, isInterState, jobWork);

  const taxableAmount = groups.reduce((sum, g) => sum + g.amount, 0);
  const totalTax = taxLines.reduce((sum, t) => sum + t.cgst + t.sgst + t.igst, 0);

  return {
    lineGroups: groups,
    warnings,
    taxLines,
    totals: {
      totalRoll: groups.reduce((sum, g) => sum + g.totalRoll, 0),
      totalWeight: groups.reduce((sum, g) => sum + g.totalWeight, 0),
      taxableAmount: Math.round(taxableAmount * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      grandTotal: Math.round((taxableAmount + totalTax) * 100) / 100,
    },
  };
}

export type PreviewInvoice = Omit<Invoice, "id" | "invoiceNo" | "status" | "createdAt">;

export function buildInvoicePreview(
  challans: ChallanRecord[],
  tenantStateCode: string | null | undefined,
  jobWork: JobWorkSettings,
  invoiceDate = new Date().toISOString().slice(0, 10)
): PreviewInvoice {
  const firstChallan = challans[0];
  return {
    invoiceDate,
    challanIds: challans.map((c) => c.id),
    header: {
      billing: firstChallan?.header.billing,
      shipping: firstChallan?.header.shipping,
    },
    ...computeInvoiceLineData(challans, tenantStateCode, jobWork),
  };
}

export function lineItemAmount(item: LineItem): number {
  return Math.round(((item.weight ?? 0) + (item.ribWeight ?? 0)) * (item.rate ?? 0) * 100) / 100;
}