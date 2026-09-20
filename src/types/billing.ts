import { z } from "zod";
import type { Party } from "@/types/challan";

export const billingStatusSchema = z.enum(["draft", "sent", "paid"]);
export type BillingStatus = z.infer<typeof billingStatusSchema>;

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
};

export const BILLING_STATUS_TRANSITIONS: Record<BillingStatus, BillingStatus[]> = {
  draft: ["sent"],
  sent: ["paid"],
  paid: [],
};

export const generateInvoiceSchema = z.object({
  challanIds: z.array(z.string()).min(1, "Select at least one Outgoing Challan"),
});
export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;

export const updateInvoiceStatusSchema = z.object({
  status: billingStatusSchema,
});

export const updateInvoiceDetailsSchema = z.object({
  invoiceDate: z.string().min(1, "Invoice date is required").optional(),
  header: z.object({ billing: z.any(), shipping: z.any() }).optional(),
  challanIds: z.array(z.string()).min(1, "Select at least one Outgoing Challan").optional(),
});
export type UpdateInvoiceDetailsInput = z.infer<typeof updateInvoiceDetailsSchema>;

export interface InvoiceLineGroup {
  hsnCode: string;
  particulars: string;
  lotNos: string[];
  totalRoll: number;
  totalWeight: number;
  amount: number;
}

export interface InvoiceLineWarning {
  challanId: string;
  lineItemId: string;
  particulars: string;
  lotNo: string;
}

export interface TaxLine {
  sacCode: string;
  gstRate: number;
  taxableAmount: number;
  isInterState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface InvoiceTotals {
  totalRoll: number;
  totalWeight: number;
  taxableAmount: number;
  totalTax: number;
  grandTotal: number;
}

export interface InvoiceHeader {
  billing: Party;
  shipping: Party;
}

export interface Invoice {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  status: BillingStatus;
  challanIds: string[];
  header: InvoiceHeader;
  lineGroups: InvoiceLineGroup[];
  warnings: InvoiceLineWarning[];
  taxLines: TaxLine[];
  totals: InvoiceTotals;
  createdAt: string;
}

export interface InvoiceListResponse {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
}