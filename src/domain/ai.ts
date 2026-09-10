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

export type AiEditorEdit = AiRewriteTarget & {
  replacement: string;
};
