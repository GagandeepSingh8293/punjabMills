import { z } from "zod";
import { GSTIN_PATTERN, HSN_CODE_PATTERN } from "@/types/challan";

export const MASTER_TYPES = ["customers", "hsn-codes", "colours", "rate", "rate-cards", "depth", "shades"] as const;
export type MasterType = (typeof MASTER_TYPES)[number];

export const HEX_COLOUR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const customerSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    gstin: z.string().refine((v) => GSTIN_PATTERN.test(v), {
      message: "GSTIN must be 15 alphanumeric characters",
    }),
    address: z.string().min(1, "Address is required"),
    state: z.string().min(1, "State is required"),
    stateCode: z.string().min(1, "State code is required"),
  })
  .superRefine((data, ctx) => {
    if (!gstinMatchesStateCode(data.gstin, data.stateCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateCode"],
        message: `GSTIN state code (${data.gstin.slice(0, 2)}) doesn't match the entered State Code (${data.stateCode})`,
      });
    }
  });
export type CustomerInput = z.infer<typeof customerSchema>;
export type Customer = CustomerInput & { id: string; createdAt: string };

export const hsnCodeSchema = z.object({
  code: z.string().refine((v) => HSN_CODE_PATTERN.test(v), {
    message: "HSN code must be 4, 6 or 8 digits",
  }),
  description: z.string().min(1, "Description is required"),
  taxRate: z.coerce.number().min(0, "Tax rate can't be negative").max(100, "Tax rate can't exceed 100%"),
});
export type HsnCodeInput = z.infer<typeof hsnCodeSchema>;
export type HsnCodeRecord = HsnCodeInput & { id: string; createdAt: string };

export const colourSchema = z.object({
  name: z.string().min(1, "Name is required"),
  hex: z.string().refine((v) => HEX_COLOUR_PATTERN.test(v), {
    message: "Enter a valid hex colour, e.g. #1D4ED8",
  }),
});
export type ColourInput = z.infer<typeof colourSchema>;
export type ColourRecord = ColourInput & { id: string; createdAt: string };

export const processorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
});
export type ProcessorInput = z.infer<typeof processorSchema>;
export type ProcessorRecord = ProcessorInput & { id: string; createdAt: string };

export const rateSchema = z.object({
  value: z.coerce.number().nonnegative("Rate can't be negative"),
});
export type RateInput = z.infer<typeof rateSchema>;
export type RateRecord = RateInput & { id: string; createdAt: string };

export const rateCardSchema = z.object({
  customerName: z.string().min(1, "Customer is required"),
  process: z.string().min(1, "Process is required"),
  depth: z.string().min(1, "Depth is required"),
  fabricQuality: z.string().optional(),
  value: z.coerce.number().nonnegative("Rate can't be negative"),
});
export type RateCardInput = z.infer<typeof rateCardSchema>;
export type RateCardRecord = RateCardInput & { id: string; createdAt: string };

export const depthSchema = z.object({
  name: z.string().min(1, "Name is required"),
});
export type DepthInput = z.infer<typeof depthSchema>;
export type DepthRecord = DepthInput & { id: string; createdAt: string };

export const shadeSchema = z.object({
  name: z.string().min(1, "Colour name is required"),
  depth: z.string().min(1, "Depth is required (use '-' for no depth)"),
  hex: z.string().refine((v) => HEX_COLOUR_PATTERN.test(v), {
    message: "Enter a valid hex colour, e.g. #1D4ED8",
  }),
});
export type ShadeInput = z.infer<typeof shadeSchema>;
export type ShadeRecord = ShadeInput & { id: string; createdAt: string };

export const jobWorkSettingsSchema = z.object({
  sacCode: z.string().refine((v) => HSN_CODE_PATTERN.test(v), {
    message: "SAC code must be 4, 6 or 8 digits",
  }),
  gstRate: z.coerce.number().min(0, "GST rate can't be negative").max(100, "GST rate can't exceed 100%"),
});
export type JobWorkSettings = z.infer<typeof jobWorkSettingsSchema>;

export const INVOICE_NUMBER_SERIES_MODES = ["reset-yearly", "continuous"] as const;
export type InvoiceNumberSeriesMode = (typeof INVOICE_NUMBER_SERIES_MODES)[number];

export const invoiceNumberingSettingsSchema = z.object({
  prefix: z
    .string()
    .min(1, "Prefix is required")
    .max(10, "Prefix must be 10 characters or fewer")
    .regex(/^[A-Za-z0-9]+$/, "Prefix must contain only letters and numbers"),
  seriesMode: z.enum(INVOICE_NUMBER_SERIES_MODES),
  paddingDigits: z.coerce
    .number()
    .int("Must be a whole number")
    .min(1, "Must be at least 1 digit")
    .max(10, "Must be 10 digits or fewer"),
});
export type InvoiceNumberingSettings = z.infer<typeof invoiceNumberingSettingsSchema>;

export type MasterRecordFor<T extends MasterType> = T extends "customers"
  ? Customer
  : T extends "hsn-codes"
    ? HsnCodeRecord
    : T extends "colours"
      ? ColourRecord
      : T extends "processors"
        ? ProcessorRecord
        : T extends "rate"
          ? RateRecord
          : T extends "rate-cards"
            ? RateCardRecord
            : T extends "depth"
              ? DepthRecord
              : ShadeRecord;

export type MasterRecord =
  | Customer
  | HsnCodeRecord
  | ColourRecord
  | ProcessorRecord
  | RateRecord
  | RateCardRecord
  | DepthRecord
  | ShadeRecord;

export const emptyCustomer = (): CustomerInput => ({ name: "", gstin: "", address: "", state: "", stateCode: "" });
export const emptyHsnCode = (): HsnCodeInput => ({ code: "", description: "", taxRate: 5 });
export const emptyColour = (): ColourInput => ({ name: "", hex: "#1D4ED8" });
export const emptyProcessor = (): ProcessorInput => ({ name: "", contactName: "", phone: "" });
export const emptyRate = (): RateInput => ({ value: 0 });
export const emptyRateCard = (): RateCardInput => ({
  customerName: "",
  process: "",
  depth: "",
  fabricQuality: "",
  value: 0,
});
export const emptyDepth = (): DepthInput => ({ name: "" });
export const emptyShade = (): ShadeInput => ({ name: "", depth: "", hex: "#1D4ED8" });

export const EMPTY_MASTER_INPUT: Record<MasterType, Record<string, unknown>> = {
  customers: emptyCustomer() as unknown as Record<string, unknown>,
  "hsn-codes": emptyHsnCode() as unknown as Record<string, unknown>,
  colours: emptyColour() as unknown as Record<string, unknown>,
  rate: emptyRate() as unknown as Record<string, unknown>,
  "rate-cards": emptyRateCard() as unknown as Record<string, unknown>,
  depth: emptyDepth() as unknown as Record<string, unknown>,
  shades: emptyShade() as unknown as Record<string, unknown>,
};

function gstinMatchesStateCode(gstin: string, stateCode: string): boolean {
  if (gstin.length < 2 || !stateCode) return true;
  return gstin.slice(0, 2) === stateCode.trim();
}