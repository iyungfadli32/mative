import { z } from "zod";
import { WORKSPACE_ROLES } from "@/lib/permissions";

/**
 * Skema validasi bersama (Zod) — lib/validation/schemas.ts
 * Dipakai di boundary aplikasi (server action / route handler) SEBELUM
 * data menyentuh database. RLS tetap penegak terakhir.
 */

export const emailSchema = z.string().email("Masukkan alamat email yang valid.");

export const passwordSchema = z.string().min(8, "Kata sandi minimal 8 karakter.");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z
    .string()
    .trim()
    .min(2, "Nama tampilan minimal 2 karakter.")
    .max(80, "Nama tampilan maksimal 80 karakter."),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Masukkan kata sandi."),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  locale: z.string().min(2).max(10).default("id"),
  timezone: z.string().min(1).max(64),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Nama organisasi minimal 2 karakter.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan tanda hubung.")
    .min(2)
    .max(80),
});

export const workspaceSchema = z.object({
  organizationId: z.string().uuid("organization_id tidak valid."),
  name: z.string().trim().min(2, "Nama workspace minimal 2 karakter.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug hanya huruf kecil, angka, dan tanda hubung.")
    .min(2)
    .max(80),
  timezone: z.string().min(1).max(64).default("Asia/Jakarta"),
  defaultLocale: z.string().min(2).max(10).default("id"),
});

export const invitationSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  email: emailSchema,
  role: z.enum(WORKSPACE_ROLES, { message: "Role tidak dikenal." }),
});

/** Jenis resource yang boleh dibagikan ke klien lewat portal (P1-16). */
export const SHAREABLE_RESOURCE_TYPES = ["content_item", "campaign"] as const;
export type ShareableResourceType = (typeof SHAREABLE_RESOURCE_TYPES)[number];

export const resourceShareSchema = z.object({
  workspaceId: z.string().uuid("workspace_id tidak valid."),
  resourceType: z.enum(SHAREABLE_RESOURCE_TYPES),
  resourceId: z.string().uuid("resource_id tidak valid."),
  sharedWithUserId: z.string().uuid("shared_with_user_id tidak valid."),
});
