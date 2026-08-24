type LiveEditorSession = {
  path: string;
  flush: () => string;
};

let session: LiveEditorSession | null = null;

export function bindLiveEditor(path: string, flush: () => string) {
  session = { path, flush };
  return () => {
    if (session?.path === path && session.flush === flush) {
      session = null;
    }
  };
}

export function flushLiveEditor(path: string | null) {
  if (!path || session?.path !== path) return null;
  return session.flush();
}
