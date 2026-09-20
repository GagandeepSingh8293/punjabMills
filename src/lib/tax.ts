import type { InvoiceLineGroup, TaxLine } from "@/types/billing";
import type { JobWorkSettings } from "@/types/masters";
import { isInterStateSupply } from "@/lib/gst-state";

export function calculateTax(
  groups: InvoiceLineGroup[],
  isInterState: boolean,
  jobWork: JobWorkSettings
): TaxLine[] {
  if (groups.length === 0) return [];

  const taxableAmount = Math.round(groups.reduce((sum, g) => sum + g.amount, 0) * 100) / 100;
  const tax = Math.round(taxableAmount * (jobWork.gstRate / 100) * 100) / 100;
  const cgst = isInterState ? 0 : Math.round((tax / 2) * 100) / 100;
  const sgst = isInterState ? 0 : Math.round((tax / 2) * 100) / 100;
  const igst = isInterState ? tax : 0;

  return [
    {
      sacCode: jobWork.sacCode,
      gstRate: jobWork.gstRate,
      taxableAmount,
      isInterState,
      cgst,
      sgst,
      igst,
      total: Math.round((taxableAmount + cgst + sgst + igst) * 100) / 100,
    },
  ];
}

export { isInterStateSupply };