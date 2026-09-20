import { z } from "zod";

export const ROLES = ["Admin", "Supervisor", "Operator", "Accounts"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  role: roleSchema,
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  phone: z.string().min(1, "Phone number is required"),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const loginSchema = z.object({
  identifier: z.string().min(1, "Enter your email or phone number"),
  password: z.string().min(1, "Enter your password"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = userSchema.pick({ name: true, email: true, phone: true });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updateAvatarSchema = z.object({
  avatarUrl: z.string().nullable(),
});
export type UpdateAvatarInput = z.infer<typeof updateAvatarSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;