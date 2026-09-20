import { z } from "zod";

export const GSTIN_PATTERN = /^[0-9A-Z]{15}$/;
export const HSN_CODE_PATTERN = /^\d{4}$|^\d{6}$|^\d{8}$/;

export const documentTypeSchema = z.enum(["incoming", "outgoing", "billing"]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  incoming: "Incoming Challan",
  outgoing: "Outgoing Challan",
  billing: "Billing Document",
};

export const CHALLAN_COPY_LABELS = [
  "Original For Consignee",
  "Duplicate For Transporter",
  "Triplicate For Consignor",
] as const;

export const partySchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    address: z.string().min(1, "Address is required"),
    gstin: z
      .string()
      .optional()
      .refine((v) => !v || GSTIN_PATTERN.test(v), {
        message: "GSTIN must be 15 alphanumeric characters",
      }),
    state: z.string().min(1, "State is required"),
    stateCode: z.string().min(1, "State code is required"),
    mobile: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!gstinMatchesStateCode(data.gstin, data.stateCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateCode"],
        message: `GSTIN state code (${data.gstin!.slice(0, 2)}) doesn't match the entered State Code (${data.stateCode})`,
      });
    }
  });
export type Party = z.infer<typeof partySchema>;

export const challanHeaderSchema = z.object({
  challanNo: z.string().nullable(),
  challanDate: z.string().min(1, "Challan date is required"),
  eWayNo: z.string().optional(),
  vehicleNo: z.string().min(1, "Vehicle number is required"),
  dispatchDate: z.string().optional(),
  transporter: z.string().optional(),
  linkedIncomingChallanIds: z.array(z.string()).optional(),
  billing: partySchema,
  shipping: partySchema,
});
export type ChallanHeader = z.infer<typeof challanHeaderSchema>;

export const lineItemSchema = z.object({
  id: z.string(),
  particulars: z.string().optional(),
  hsnCode: z
    .string()
    .optional()
    .refine((v) => !v || HSN_CODE_PATTERN.test(v), {
      message: "HSN code must be 4, 6 or 8 digits",
    }),
  lotNo: z.string().optional(),
  colour: z.string().optional(),
  depth: z.string().optional(),
  processName: z.string().optional(),
  roll: z.coerce.number().nonnegative().optional(),
  weight: z.coerce.number().nonnegative().optional(),
  rate: z.coerce.number().nonnegative().optional(),
  ribRoll: z.coerce.number().nonnegative().optional(),
  ribWeight: z.coerce.number().nonnegative().optional(),
});
export type LineItem = z.infer<typeof lineItemSchema>;

export function addOutgoingRefinements(
  data: { documentType: DocumentType; header: ChallanHeader },
  ctx: z.RefinementCtx
) {
  if (data.documentType !== "outgoing") return;

  if (!data.header.dispatchDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["header", "dispatchDate"],
      message: "Dispatch date is required",
    });
  } else if (data.header.dispatchDate < data.header.challanDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["header", "dispatchDate"],
      message: "Dispatch date cannot be before the challan date",
    });
  }

  if (!data.header.transporter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["header", "transporter"],
      message: "Transporter is required",
    });
  }
}

export const challanBaseSchema = z.object({
  id: z.string().optional(),
  status: z.enum(["draft", "saved"]).default("draft"),
  documentType: documentTypeSchema.default("incoming"),
  header: challanHeaderSchema,
  lineItems: z.array(lineItemSchema),
  createdAt: z.string().optional(),
});

export const challanSchema = challanBaseSchema.superRefine(addOutgoingRefinements);
export type Challan = z.infer<typeof challanSchema>;

/** What the Rust commands return for a challan row: the stored record plus derived fields. */
export type ChallanRecord = Challan & {
  id: string;
  billed: boolean;
  dispatchedWeight?: number;
  pendingWeight?: number;
};

export interface ChallanListResponse {
  items: ChallanRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export const emptyParty = (): Party => ({
  name: "",
  address: "",
  gstin: "",
  state: "",
  stateCode: "",
  mobile: "",
});

export const emptyHeader = (): ChallanHeader => ({
  challanNo: null,
  challanDate: new Date().toISOString().slice(0, 10),
  eWayNo: "",
  vehicleNo: "",
  dispatchDate: "",
  transporter: "",
  linkedIncomingChallanIds: [],
  billing: emptyParty(),
  shipping: emptyParty(),
});

export const emptyLineItem = (id: string): LineItem => ({
  id,
  particulars: "",
  hsnCode: "",
  lotNo: "",
  colour: "",
  depth: "",
  processName: "",
  roll: undefined,
  weight: undefined,
  rate: undefined,
  ribRoll: undefined,
  ribWeight: undefined,
});

function toFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isLineItemRowValid(item: LineItem): boolean {
  return (
    toFiniteNumber(item.roll) !== null &&
    toFiniteNumber(item.weight) !== null &&
    toFiniteNumber(item.rate) !== null &&
    toFiniteNumber(item.ribRoll) !== null &&
    toFiniteNumber(item.ribWeight) !== null
  );
}

export function computeLineItemAmount(item: LineItem): number {
  if (!isLineItemRowValid(item)) return 0;
  const weight = (toFiniteNumber(item.weight) ?? 0) + (toFiniteNumber(item.ribWeight) ?? 0);
  const rate = toFiniteNumber(item.rate) ?? 0;
  return Math.round(weight * rate * 100) / 100;
}

export function computeTotals(lineItems: LineItem[]) {
  return lineItems.reduce(
    (acc, item) => {
      if (!isLineItemRowValid(item)) return acc;
      acc.totalRoll += (toFiniteNumber(item.roll) ?? 0) + (toFiniteNumber(item.ribRoll) ?? 0);
      acc.totalWeight += (toFiniteNumber(item.weight) ?? 0) + (toFiniteNumber(item.ribWeight) ?? 0);
      acc.totalApproxAmount += computeLineItemAmount(item);
      return acc;
    },
    { totalRoll: 0, totalWeight: 0, totalApproxAmount: 0 }
  );
}

function gstinMatchesStateCode(gstin: string | undefined, stateCode: string | undefined): boolean {
  if (!gstin || gstin.length < 2 || !stateCode) return true;
  return gstin.slice(0, 2) === stateCode.trim();
}