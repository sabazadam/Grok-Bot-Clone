import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Attachment } from "@grokbot/shared";
import { config } from "./config.js";

/** Official desktop allows 6 files / 25MB. We keep a 12MB ceiling so JSON uploads stay practical. */
export const MAX_ATTACH_FILES = 6;
export const MAX_ATTACH_BYTES = 12 * 1024 * 1024;

export interface IncomingFile {
  name: string;
  mime: string;
  dataBase64: string;
}

export function uploadsDir(): string {
  const dir = path.join(config.dataDir, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveAttachments(files: IncomingFile[]): Attachment[] {
  const out: Attachment[] = [];
  for (const file of files.slice(0, MAX_ATTACH_FILES)) {
    const raw = Buffer.from(file.dataBase64, "base64");
    if (!raw.length || raw.length > MAX_ATTACH_BYTES) continue;
    const id = nanoid(10);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
    const stored = `${id}_${safe}`;
    fs.writeFileSync(path.join(uploadsDir(), stored), raw);
    out.push({
      id,
      name: file.name.slice(0, 120) || safe,
      mime: file.mime || "application/octet-stream",
      url: `/uploads/${stored}`,
      size: raw.length,
    });
  }
  return out;
}

export function hostPathForAttachment(att: Attachment): string | undefined {
  const name = att.url.replace(/^\/uploads\//, "");
  if (!name || name.includes("..") || name.includes("/")) return undefined;
  const full = path.join(uploadsDir(), name);
  return fs.existsSync(full) ? full : undefined;
}
