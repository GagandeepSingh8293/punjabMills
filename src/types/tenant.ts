import { z } from "zod";
import { GSTIN_PATTERN } from "@/types/challan";

export const tenantSettingsSchema = z
  .object({
    companyName: z.string().min(1, "Company name is required"),
    tagline: z.string().optional(),
    gstin: z.string().refine((v) => GSTIN_PATTERN.test(v), {
      message: "GSTIN must be 15 alphanumeric characters",
    }),
    address: z.string().min(1, "Address is required"),
    state: z.string().min(1, "State is required"),
    stateCode: z.string().min(1, "State code is required"),
    email: z.string().email("Enter a valid email").optional().or(z.literal("")),
    phone: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!gstinMatchesStateCode(data.gstin, data.stateCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stateCode"],
        message: `GSTIN state code (${data.gstin.slice(0, 2)}) doesn't match the selected state's code (${data.stateCode})`,
      });
    }
  });
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

function gstinMatchesStateCode(gstin: string, stateCode: string): boolean {
  if (gstin.length < 2 || !stateCode) return true;
  return gstin.slice(0, 2) === stateCode.trim();
}