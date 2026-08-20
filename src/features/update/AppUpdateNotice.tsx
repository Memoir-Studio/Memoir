import { useRef } from "react";
import { UpdateNotice } from "./UpdateNotice";
import { useAppUpdateCheck } from "./useAppUpdateCheck";

export function AppUpdateNotice() {
  const { notice, dismiss, skip, openRelease } = useAppUpdateCheck();
  const shownRef = useRef(notice);
  if (notice) shownRef.current = notice;
  const shown = notice ?? shownRef.current;
  if (!shown) return null;
  return (
    <UpdateNotice
      latestVersion={shown.latestVersion ?? ""}
      onClose={dismiss}
      onDownload={() => void openRelease()}
      onSkip={() => void skip()}
      open={notice != null}
      releaseNotes={shown.releaseNotes}
    />
  );
}
