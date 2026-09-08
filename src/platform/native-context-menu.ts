export function installNativeContextMenuBlock() {
  const onContextMenu = (event: Event) => {
    event.preventDefault();
  };
  window.addEventListener("contextmenu", onContextMenu);
  return () => window.removeEventListener("contextmenu", onContextMenu);
}
