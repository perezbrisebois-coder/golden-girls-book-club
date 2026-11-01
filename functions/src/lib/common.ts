import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { createHash } from "node:crypto";

export const db = () => getFirestore();

export type Role = "member" | "admin";

/** Throws unless the caller entered the shared MEMBER or ADMIN password. */
export function requireRole(req: CallableRequest, needed: Role = "member"): Role {
  const role = req.auth?.token.role as Role | undefined;
  if (role !== "member" && role !== "admin") {
    throw new HttpsError("unauthenticated", "Please enter the club password first.");
  }
  if (needed === "admin" && role !== "admin") {
    throw new HttpsError("permission-denied", "Only the club admin can do that.");
  }
  return role;
}

export function requireAdmin(req: CallableRequest): void {
  requireRole(req, "admin");
}

/**
 * Throws unless the caller is identified as a member (name + PIN) whose
 * record still exists. Returns the member ID and current display name.
 */
export async function requireMember(
  req: CallableRequest,
): Promise<{ memberId: string; name: string; role: Role }> {
  const role = requireRole(req);
  const memberId = req.auth?.token.memberId as string | undefined;
  if (!memberId) {
    throw new HttpsError("unauthenticated", "Please tell us who you are (name and PIN) first.");
  }
  const snap = await db().collection("members").doc(memberId).get();
  if (!snap.exists) {
    throw new HttpsError("unauthenticated", "We couldn't find your member profile. Please sign in again.");
  }
  return { memberId, name: snap.get("name") as string, role };
}

/** Normalises a name for matching: "  Mary   Ann " -> "mary ann". */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function clientIp(req: CallableRequest): string {
  const fwd = req.rawRequest?.headers?.["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.rawRequest?.ip || "unknown";
}

// ---- Small input validators (throw friendly invalid-argument errors) ----

export function str(value: unknown, field: string, opts: { max: number; required?: boolean }): string {
  if (value === undefined || value === null || value === "") {
    if (opts.required) throw new HttpsError("invalid-argument", `Please fill in ${field}.`);
    return "";
  }
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `${field} must be text.`);
  const trimmed = value.trim();
  if (opts.required && !trimmed) throw new HttpsError("invalid-argument", `Please fill in ${field}.`);
  if (trimmed.length > opts.max) {
    throw new HttpsError("invalid-argument", `${field} is too long (max ${opts.max} characters).`);
  }
  return trimmed;
}

export function optionalUrl(value: unknown, field: string): string {
  const s = str(value, field, { max: 1000 });
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
    return u.toString();
  } catch {
    throw new HttpsError("invalid-argument", `${field} must be a web address starting with https://`);
  }
}

export function isoDate(value: unknown, field: string, required = false): string {
  const s = str(value, field, { max: 10, required });
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + "T00:00:00Z"))) {
    throw new HttpsError("invalid-argument", `${field} must be a valid date.`);
  }
  return s;
}

export function time24(value: unknown, field: string): string {
  const s = str(value, field, { max: 5 });
  if (!s) return "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) {
    throw new HttpsError("invalid-argument", `${field} must be a valid time.`);
  }
  return s;
}
