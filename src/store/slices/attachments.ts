import type { AttachmentFile, SaveAttachmentInput } from "../../domain/attachments";

type AttachmentSliceContext = {
  refreshAttachments: () => Promise<void>;
  saveAttachments: (inputs: SaveAttachmentInput[]) => Promise<AttachmentFile[]>;
  savePastedImages: (files: File[]) => Promise<string>;
  importDroppedImages: (sourcePaths: string[]) => Promise<string>;
  importAttachments: () => Promise<AttachmentFile[]>;
  deleteAttachment: (relativePath: string) => Promise<void>;
};

export function createAttachmentSlice(context: AttachmentSliceContext) {
  return context;
}
