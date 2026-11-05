// Gerador de PDF de documentos (propostas e contratos), sem navegador.
// Usado pela Edge Function `document-pdf` (Deno, via deno.json) e testado com Vitest (Node).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export type Block =
  | { type: "h1" | "h2" | "p" | "small"; text: string }
  | { type: "table"; columns: string[]; rows: string[][]; widths: number[]; align?: ("left" | "right")[] }
  | { type: "totals"; rows: [string, string][] }
  | { type: "spacer"; size?: number };

export interface DocSpec {
  studio: string;
  studioContact?: string;
  docLabel: string;      // "Proposta comercial", "Contrato"
  docNumber: string;     // "Nº 0014"
  accent?: string;       // cor da identidade em hex (#0B2239)
  blocks: Block[];
  footer?: string;
}

const A4: [number, number] = [595.28, 841.89];
const M = 56; // margem

function hexToRgb(hex?: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return rgb(0.043, 0.133, 0.224); // #0B2239
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Troca caracteres que a fonte padrão (WinAnsi) não codifica. */
export function pdfSafe(text: string): string {
  return text.replace(/[→⇒]/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/ /g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e¡-ÿ–—•…€]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) <= width) { line = cand; continue; }
      if (line) out.push(line);
      line = w;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {   // palavra maior que a linha
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderDocument(spec: DocSpec): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${spec.docLabel} ${spec.docNumber}`));
  pdf.setProducer("NEXO Studio OS");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(spec.accent);
  const ink = rgb(0.055, 0.09, 0.15), muted = rgb(0.29, 0.33, 0.4), line = rgb(0.8, 0.83, 0.87);
  const W = A4[0] - 2 * M;
  let page!: PDFPage; let y = 0;

  const header = () => {
    page = pdf.addPage(A4);
    y = A4[1] - M;
    page.drawText(pdfSafe(spec.studio), { x: M, y: y - 12, size: 13, font: bold, color: ink });
    if (spec.studioContact) page.drawText(pdfSafe(spec.studioContact), { x: M, y: y - 27, size: 8.5, font: regular, color: muted });
    const label = pdfSafe(spec.docLabel.toUpperCase()), num = pdfSafe(spec.docNumber);
    page.drawText(label, { x: A4[0] - M - regular.widthOfTextAtSize(label, 8), y: y - 9, size: 8, font: regular, color: muted });
    page.drawText(num, { x: A4[0] - M - bold.widthOfTextAtSize(num, 13), y: y - 25, size: 13, font: bold, color: ink });
    y -= 38;
    page.drawRectangle({ x: M, y, width: W, height: 1.6, color: accent });
    y -= 26;
  };
  const ensure = (h: number) => { if (y - h < M + 24) header(); };
  header();

  for (const b of spec.blocks) {
    if (b.type === "spacer") { y -= b.size ?? 10; continue; }
    if (b.type === "h1" || b.type === "h2" || b.type === "p" || b.type === "small") {
      const size = b.type === "h1" ? 18 : b.type === "h2" ? 10 : b.type === "small" ? 8.5 : 10.5;
      const font = b.type === "p" || b.type === "small" ? regular : bold;
      const lh = size * (b.type === "h1" ? 1.25 : 1.45);
      if (b.type === "h2") { ensure(lh * 2); y -= 8; }
      const lines = wrap(b.type === "h2" ? b.text.toUpperCase() : b.text, font, size, W);
      for (const l of lines) {
        ensure(lh);
        page.drawText(l, { x: M, y: y - size, size, font, color: b.type === "h2" ? accent : b.type === "small" ? muted : ink });
        y -= lh;
      }
      y -= b.type === "h1" ? 6 : b.type === "h2" ? 2 : 6;
      continue;
    }
    if (b.type === "table") {
      const total = b.widths.reduce((a, c) => a + c, 0);
      const cols = b.widths.map((w) => (w / total) * W);
      const drawRow = (cells: string[], font: PDFFont, size: number, color = ink) => {
        const wrapped = cells.map((c, i) => wrap(c, font, size, cols[i] - 8));
        const h = Math.max(...wrapped.map((l) => l.length)) * size * 1.35 + 8;
        ensure(h);
        let x = M;
        wrapped.forEach((lines, i) => {
          lines.forEach((l, j) => {
            const right = b.align?.[i] === "right";
            const tx = right ? x + cols[i] - font.widthOfTextAtSize(l, size) - 2 : x + 2;
            page.drawText(l, { x: tx, y: y - 4 - size - j * size * 1.35, size, font, color });
          });
          x += cols[i];
        });
        y -= h;
        page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: line });
      };
      drawRow(b.columns.map((c) => c.toUpperCase()), regular, 7.5, muted);
      for (const r of b.rows) drawRow(r, regular, 9.5);
      y -= 8;
      continue;
    }
    if (b.type === "totals") {
      const w = 220, x = M + W - w;
      b.rows.forEach(([label, value], i) => {
        const last = i === b.rows.length - 1;
        const size = last ? 12 : 9.5, font = last ? bold : regular;
        ensure(size * 2);
        if (last) { page.drawRectangle({ x, y: y - 2, width: w, height: 1.4, color: accent }); y -= 6; }
        page.drawText(pdfSafe(label), { x, y: y - size, size, font, color: ink });
        const v = pdfSafe(value);
        page.drawText(v, { x: x + w - font.widthOfTextAtSize(v, size), y: y - size, size, font, color: ink });
        y -= size * 1.7;
      });
      y -= 6;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = pdfSafe(`${spec.footer ? spec.footer + "  ·  " : ""}Página ${i + 1} de ${pages.length}`);
    p.drawText(t, { x: M, y: M - 20, size: 7.5, font: regular, color: muted });
  });
  return await pdf.save();
}

/** Converte o HTML simples dos contratos em blocos (títulos, parágrafos e itens). */
export function htmlToBlocks(html: string): Block[] {
  const decode = (s: string) => s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const blocks: Block[] = [];
  const re = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase(), text = decode(m[2]);
    if (!text) continue;
    blocks.push({ type: tag === "h1" ? "h1" : tag === "h2" || tag === "h3" ? "h2" : "p", text: tag === "li" ? `• ${text}` : text });
  }
  if (!blocks.length && decode(html)) blocks.push({ type: "p", text: decode(html) });
  return blocks;
}

/** Substitui {{variaveis}}; as ausentes ficam visíveis como [variavel]. */
export function fillVars(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => {
    const v = vars[k];
    return v ? String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!) : `[${k}]`;
  });
}
