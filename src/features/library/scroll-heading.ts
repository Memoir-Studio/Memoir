const PREVIEW_SCROLL_SELECTOR = ".preview-pane";

export function scrollHeadingInPreview(
  id: string,
  options?: { behavior?: ScrollBehavior; offset?: number },
) {
  const element = document.getElementById(id);
  if (!element) return false;
  const container = element.closest<HTMLElement>(PREVIEW_SCROLL_SELECTOR);
  if (!container) return false;

  const nextTop =
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    (options?.offset ?? 0);

  container.scrollTo({
    top: Math.max(0, nextTop),
    behavior: options?.behavior ?? "auto",
  });
  return true;
}
