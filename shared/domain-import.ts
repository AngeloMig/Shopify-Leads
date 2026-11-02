/** Parse a small domain list or CSV without guessing columns in a multi-column file. */
export function importDomains(text: string): string[] {
  if (text.length > 1_000_000)
    throw new Error("Keep the import file under 1 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("The CSV contains an unfinished quoted field.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) throw new Error("Add at least one store domain.");
  const header = rows[0].map((s) => s.replace(/^\uFEFF/, "").toLowerCase());
  const column = header.findIndex((s) =>
    ["domain", "url", "website", "store domain"].includes(s),
  );
  if (column < 0 && rows.some((row) => row.length > 1))
    throw new Error(
      "For a CSV, include a Domain, URL or Website column header.",
    );
  const values = (column >= 0 ? rows.slice(1) : rows)
    .map((row) => row[column >= 0 ? column : 0])
    .filter(Boolean);
  if (!values.length || values.length > 50)
    throw new Error("Import between 1 and 50 store domains at a time.");
  return values;
}
