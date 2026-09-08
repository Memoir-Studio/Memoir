type EditorSliceContext = {
  setContent: (content: string) => void;
  saveActiveNote: () => Promise<void>;
  selectNote: (relativePath: string) => Promise<void>;
};

export function createEditorSlice({ setContent, saveActiveNote, selectNote }: EditorSliceContext) {
  return { setContent, saveActiveNote, selectNote };
}
