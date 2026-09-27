import type { Organization } from "@/lib/organization";
import type { Customer } from "@/lib/types";

export interface ToolContext {
  organization: Organization;
  conversationId: string;
  customer: Customer | null;
  now: Date;
}

/** Tools never throw at the caller: a failure is data, so the model can be told the truth. */
export type ToolResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

export interface Tool {
  name: string;
  /** Written for the model: what it does, and exactly which arguments it takes. */
  description: string;
  run(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export const ok = (data: Record<string, unknown>): ToolResult => ({ ok: true, data });
export const failed = (error: string): ToolResult => ({ ok: false, error });

export function requireString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function optionalString(args: Record<string, unknown>, key: string): string | null {
  return requireString(args, key);
}

/** Accepts "2026-10-02T14:30" as clinic-local, or a full ISO instant. */
export function parseWhen(value: string, toClinicInstant: (date: string, hour: number, minute: number) => Date): Date | null {
  const local = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/);
  if (local) return toClinicInstant(local[1], Number(local[2]), Number(local[3]));

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
