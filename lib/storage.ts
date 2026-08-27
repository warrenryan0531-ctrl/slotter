import { db } from "./db";
import { randomUUID } from "crypto";

// B5: intake file uploads. Private bucket; the client uploads directly to a scoped signed URL
// (so large files never pass through our serverless function's small body limit), and owners read
// files back through short-lived signed download URLs. The bucket itself also enforces size + mime.
export const INTAKE_BUCKET = "intake";
export const INTAKE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const INTAKE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);

/** Make a filesystem/URL-safe basename; never lets path separators through. */
export function safeName(name: string): string {
  const base = (name || "file").split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/_{2,}/g, "_").slice(0, 120);
  if (!cleaned || /^\.+$/.test(cleaned)) return "file"; // never "" or a dots-only name
  return cleaned;
}

/** Mint a one-object signed upload URL under <slug>/<uuid>/<safeName>. */
export async function createIntakeUpload(slug: string, filename: string): Promise<{ path: string; signedUrl: string; token: string; name: string }> {
  const name = safeName(filename);
  const path = `${slug}/${randomUUID()}/${name}`;
  const { data, error } = await db().storage.from(INTAKE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`signed upload url failed: ${error?.message ?? "unknown"}`);
  return { path, signedUrl: data.signedUrl, token: data.token, name };
}

/** Short-lived signed download URL for an object (owner-only, checked by the route). */
export async function createIntakeDownload(path: string, seconds = 60): Promise<string> {
  const { data, error } = await db().storage.from(INTAKE_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`signed download url failed: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

/**
 * B5 cleanup sweep: GC intake files uploaded but never attached to a booking. Only considers
 * tracked uploads older than the grace window; keeps files a booking references (and stops tracking
 * them), deletes the rest from storage. Best-effort and bounded — safe to run on every cron tick.
 */
export async function sweepOrphanIntakeFiles(graceHours = 24, max = 200): Promise<{ scanned: number; deleted: number }> {
  const cutoff = new Date(Date.now() - graceHours * 3600_000).toISOString();
  const { data } = await db().from("bh_intake_uploads").select("path").lt("created_at", cutoff).limit(max);
  const rows = (data as { path: string }[]) ?? [];
  let deleted = 0;
  for (const r of rows) {
    try {
      const used = await db().rpc("bh_intake_path_used", { p_path: r.path });
      if (used.data === true) {
        // A booking references it → it's a real attachment. Stop tracking; leave the file.
        await db().from("bh_intake_uploads").delete().eq("path", r.path);
      } else {
        // Orphan → delete the object, then the tracking row.
        await db().storage.from(INTAKE_BUCKET).remove([r.path]);
        await db().from("bh_intake_uploads").delete().eq("path", r.path);
        deleted++;
      }
    } catch (e) {
      console.error("[b5] sweep failed for", r.path, (e as Error).message);
    }
  }
  return { scanned: rows.length, deleted };
}

/** The value stored on a booking's intake answer for a file: `file::<path>::<name>`. */
export const FILE_ANSWER_PREFIX = "file::";
export function encodeFileAnswer(path: string, name: string): string {
  return `${FILE_ANSWER_PREFIX}${path}::${name}`;
}
export function parseFileAnswer(v: string): { path: string; name: string } | null {
  if (!v.startsWith(FILE_ANSWER_PREFIX)) return null;
  const rest = v.slice(FILE_ANSWER_PREFIX.length);
  const idx = rest.lastIndexOf("::");
  if (idx < 0) return null;
  const path = rest.slice(0, idx), name = rest.slice(idx + 2);
  if (!path) return null;
  return { path, name: name || "file" };
}
