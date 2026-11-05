// Exportação CSV compatível com Excel em português (separador ";", vírgula decimal, BOM UTF-8).
export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(";"), ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(";"))];
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
