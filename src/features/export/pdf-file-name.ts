import { folderName } from "../library/note-utils";

const ILLEGAL_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function suggestedPdfFileName(title: string, relativePath: string) {
  const fromTitle = title.replace(ILLEGAL_FILE_CHARS, " ").replace(/\s+/g, " ").trim();
  const fromPath = (relativePath.split("/").pop() || "note").replace(/\.(md|mdx)$/i, "");
  const stem = (fromTitle || fromPath || "note").slice(0, 80).trim() || "note";
  return `${stem}.pdf`;
}

export function defaultExportPath(workspaceRoot: string | null, relativePath: string, fileName: string) {
  if (!workspaceRoot) return fileName;
  const folder = folderName(relativePath);
  return folder ? `${workspaceRoot}/${folder}/${fileName}` : `${workspaceRoot}/${fileName}`;
}
