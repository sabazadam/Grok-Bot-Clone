import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hostPathForAttachment, saveAttachments, uploadsDir } from "./uploads.js";

describe("attachments", () => {
  it("writes files and rejects path traversal", () => {
    const [att] = saveAttachments([
      { name: "notes.txt", mime: "text/plain", dataBase64: Buffer.from("hello").toString("base64") },
    ]);
    expect(att?.name).toBe("notes.txt");
    expect(att?.url.startsWith("/uploads/")).toBe(true);
    const host = hostPathForAttachment(att!);
    expect(host && fs.existsSync(host)).toBe(true);
    expect(fs.readFileSync(host!, "utf8")).toBe("hello");
    expect(
      hostPathForAttachment({
        id: "x",
        name: "evil",
        mime: "text/plain",
        url: "/uploads/../secret",
        size: 1,
      }),
    ).toBeUndefined();
    if (host) fs.rmSync(host, { force: true });
    const leftover = path.join(uploadsDir(), path.basename(att!.url));
    fs.rmSync(leftover, { force: true });
  });
});
