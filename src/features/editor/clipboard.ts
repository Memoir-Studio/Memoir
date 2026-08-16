export async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export async function readClipboardText() {
  if (!navigator.clipboard?.readText) return "";
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

export async function readClipboardImageFiles() {
  const read = navigator.clipboard?.read;
  if (!read) return [];
  try {
    const items = await read.call(navigator.clipboard);
    const files: File[] = [];
    for (const item of items) {
      const type = item.types.find((value) => value.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      const extension = type.split("/")[1]?.split("+")[0] || "png";
      files.push(new File([blob], `image.${extension}`, { type }));
    }
    return files;
  } catch {
    return [];
  }
}
