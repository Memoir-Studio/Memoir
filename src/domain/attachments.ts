import { relativePathFromNote } from "./paths";

export const ATTACHMENTS_DIR = "attachments";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const ATTACHMENT_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "svg",
] as const;

export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

export type AttachmentFile = {
  relativePath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  modifiedMs: number;
  size: number;
};

export type SaveAttachmentInput = {
  bytesBase64: string;
  fileName?: string;
  mimeType?: string;
};

const MIME_TO_EXTENSION: Record<string, AttachmentExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

const EXTENSION_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

const GENERIC_STEM = /^(image|blob|untitled|paste|screenshot)(\s*[-_]?\d+)?$/i;

export function isAttachmentExtension(value: string): value is AttachmentExtension {
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(value.toLowerCase());
}

export function extensionFromMime(mimeType: string): AttachmentExtension | null {
  return MIME_TO_EXTENSION[mimeType.trim().toLowerCase()] ?? null;
}

export function mimeFromExtension(extension: string): string {
  return EXTENSION_TO_MIME[extension.toLowerCase()] ?? "application/octet-stream";
}

export function extensionFromFileName(fileName: string): AttachmentExtension | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  return isAttachmentExtension(match[1]) ? match[1] : null;
}

export function isImageFile(file: { name: string; type: string }): boolean {
  return Boolean(extensionFromMime(file.type) || extensionFromFileName(file.name));
}

export function sanitizeAttachmentFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  let slug = "";
  let lastDash = false;
  for (const character of base) {
    if (character === ".") {
      if (slug && !slug.endsWith(".")) slug += ".";
      lastDash = false;
      continue;
    }
    if (/\p{Letter}|\p{Number}|_/u.test(character)) {
      slug += character;
      lastDash = false;
      continue;
    }
    if (!lastDash && slug) {
      slug += "-";
      lastDash = true;
    }
  }
  return slug.replace(/^[.-]+|[.-]+$/g, "") || "image";
}

export function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function suggestedPasteFileName(
  file: { name: string; type: string },
  now = new Date(),
): string {
  const extension = extensionFromMime(file.type) ?? extensionFromFileName(file.name) ?? "png";
  const rawStem = file.name.replace(/\.[^.]+$/, "").trim();
  const generic = !rawStem || GENERIC_STEM.test(rawStem);
  const stem = generic ? `paste-${formatStamp(now)}` : sanitizeAttachmentFileName(rawStem);
  return `${stem}.${extension}`;
}

export function escapeMarkdownAlt(value: string): string {
  return value.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim() || "image";
}

export function attachmentAlt(attachment: Pick<AttachmentFile, "fileName">): string {
  return escapeMarkdownAlt(attachment.fileName.replace(/\.[^.]+$/, ""));
}

export function markdownImageForAttachment(
  noteRelativePath: string,
  attachment: Pick<AttachmentFile, "relativePath" | "fileName">,
  alt = attachmentAlt(attachment),
): string {
  const href = relativePathFromNote(noteRelativePath, attachment.relativePath);
  return `![${alt}](${href})`;
}

export function markdownForAttachments(
  noteRelativePath: string | null,
  attachments: Array<Pick<AttachmentFile, "relativePath" | "fileName">>,
): string {
  if (!noteRelativePath || attachments.length === 0) return "";
  return attachments
    .map((attachment) => markdownImageForAttachment(noteRelativePath, attachment))
    .join("\n\n");
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) {
    const kb = size / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function collectClipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isImageFile(file)) fromItems.push(file);
  }
  if (fromItems.length) return uniqueFiles(fromItems);
  return uniqueFiles(Array.from(data.files ?? []).filter(isImageFile));
}

function uniqueFiles(files: File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
