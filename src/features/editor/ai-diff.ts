export type DiffRow = {
  kind: "equal" | "add" | "remove" | "skip";
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
  count?: number;
};

const MAX_LCS_CELLS = 40_000;

function splitLines(value: string) {
  return value.split("\n");
}

function diffMiddle(before: string[], after: string[]): Array<["equal" | "add" | "remove", string]> {
  if (!before.length) return after.map((line) => ["add", line]);
  if (!after.length) return before.map((line) => ["remove", line]);
  if (before.length * after.length > MAX_LCS_CELLS) {
    return [
      ...before.map((line): ["remove", string] => ["remove", line]),
      ...after.map((line): ["add", string] => ["add", line]),
    ];
  }

  const table = Array.from({ length: before.length + 1 }, () =>
    new Uint32Array(after.length + 1),
  );
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] =
        before[left] === after[right]
          ? table[left + 1][right + 1] + 1
          : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }

  const rows: Array<["equal" | "add" | "remove", string]> = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      rows.push(["equal", before[left]]);
      left += 1;
      right += 1;
    } else if (table[left + 1][right] >= table[left][right + 1]) {
      rows.push(["remove", before[left]]);
      left += 1;
    } else {
      rows.push(["add", after[right]]);
      right += 1;
    }
  }
  while (left < before.length) rows.push(["remove", before[left++]]);
  while (right < after.length) rows.push(["add", after[right++]]);
  return rows;
}

export function createLineDiff(beforeValue: string, afterValue: string): DiffRow[] {
  const before = splitLines(beforeValue);
  const after = splitLines(afterValue);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }

  const tagged: Array<["equal" | "add" | "remove", string]> = [
    ...before.slice(0, prefix).map((line): ["equal", string] => ["equal", line]),
    ...diffMiddle(
      before.slice(prefix, before.length - suffix),
      after.slice(prefix, after.length - suffix),
    ),
    ...before.slice(before.length - suffix).map((line): ["equal", string] => ["equal", line]),
  ];

  let beforeLine = 1;
  let afterLine = 1;
  return tagged.map(([kind, text]) => {
    const row: DiffRow = {
      kind,
      text,
      beforeLine: kind === "add" ? null : beforeLine,
      afterLine: kind === "remove" ? null : afterLine,
    };
    if (kind !== "add") beforeLine += 1;
    if (kind !== "remove") afterLine += 1;
    return row;
  });
}

export function compactDiffRows(rows: DiffRow[], context = 3): DiffRow[] {
  const output: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind !== "equal") {
      output.push(rows[index++]);
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].kind === "equal") end += 1;
    const run = rows.slice(index, end);
    if (run.length <= context * 2 + 1) {
      output.push(...run);
    } else {
      output.push(...run.slice(0, context));
      output.push({
        kind: "skip",
        text: "",
        beforeLine: null,
        afterLine: null,
        count: run.length - context * 2,
      });
      output.push(...run.slice(-context));
    }
    index = end;
  }
  return output;
}

export function diffStats(rows: DiffRow[]) {
  return rows.reduce(
    (stats, row) => {
      if (row.kind === "add") stats.added += 1;
      if (row.kind === "remove") stats.removed += 1;
      return stats;
    },
    { added: 0, removed: 0 },
  );
}
