import { mapGatewayError } from "../../domain/errors";
import { getGateways } from "../../gateways";
import { resolveLocale } from "../../i18n/locale";
import { t, type MessageKey, type MessageParams } from "../../i18n/translate";
import { useAppStore } from "../../store/app-store";
import { parseNote } from "../library/note-utils";
import { defaultExportPath, suggestedPdfFileName } from "./pdf-file-name";
import { renderNotePdf } from "./render-note-pdf";

function currentT(key: MessageKey, params?: MessageParams) {
  return t(resolveLocale(useAppStore.getState().settings.appearance.locale), key, params);
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function resolveNoteContent(relativePath: string) {
  const state = useAppStore.getState();
  const note = state.notes.find((item) => item.relativePath === relativePath);
  if (!note || !state.workspaceRoot) return null;

  if (state.activePath === relativePath && state.loadedContentPath === relativePath) {
    return { content: state.content, note };
  }

  try {
    const draft = await getGateways().persistence.readDraft(state.workspaceRoot, relativePath);
    if (draft != null) return { content: draft, note };
  } catch {
    // Fall through to the file on disk.
  }

  const content = await getGateways().workspace.readNote(state.workspaceRoot, relativePath);
  return { content, note };
}

export async function exportNotePdf(relativePath: string) {
  const previousStatus = useAppStore.getState().status;
  try {
    const resolved = await resolveNoteContent(relativePath);
    if (!resolved) {
      useAppStore.setState({ error: currentT("errors.exportPdf", { message: currentT("dialog.currentNote") }) });
      return null;
    }

    const { settings, workspaceRoot } = useAppStore.getState();
    const title = parseNote(resolved.content, resolved.note.fileName).title;
    const fileName = suggestedPdfFileName(title, relativePath);
    const chosen = await getGateways().workspace.chooseExportPath({
      defaultPath: defaultExportPath(workspaceRoot, relativePath, fileName),
      title: currentT("dialog.exportPdf"),
    });
    if (!chosen) return null;

    useAppStore.setState({ error: "", status: currentT("editor.exportingPdf") });
    const bytes = await renderNotePdf({
      bodyFont: settings.appearance.bodyFont,
      content: resolved.content,
      locale: resolveLocale(settings.appearance.locale),
      note: resolved.note,
      relativePath,
      root: workspaceRoot,
    });
    const bytesBase64 = bytesToBase64(bytes);
    await getGateways().workspace.writeExportFile(chosen, bytesBase64);
    useAppStore.setState({ status: currentT("status.exportedPdf") });
    return chosen;
  } catch (error) {
    useAppStore.setState({
      error: currentT("errors.exportPdf", { message: mapGatewayError(error).message }),
      status: previousStatus,
    });
    return null;
  }
}
