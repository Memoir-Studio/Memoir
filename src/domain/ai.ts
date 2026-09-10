import type { AppSettings } from "./settings";

export type AiRewriteScope = "selection" | "document";
export type AiSettings = AppSettings["ai"];

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiRewriteTarget = {
  path: string;
  from: number;
  to: number;
  source: string;
  scope: AiRewriteScope;
};

export type AiEditProposal = {
  tool: "replace_selection" | "replace_document";
  replacement: string;
};

export type AiChatResponse = {
  message: string;
  edit: AiEditProposal | null;
};

export const AI_CHAT_PROGRESS_EVENT = "ai-chat-progress";

export type AiChatProgress = {
  stage:
    | "preparing"
    | "callingModel"
    | "callingTool"
    | "toolCompleted"
    | "generating"
    | "completed"
    | "failed";
  model?: string;
  tool?: string;
  query?: string;
  resultCount?: number;
};

export type AiEditorEdit = AiRewriteTarget & {
  replacement: string;
};
