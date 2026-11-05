// Formatação padrão: pt-BR, BRL, DD/MM/AAAA, America/Sao_Paulo.
export const TZ = "America/Sao_Paulo";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const money = (v: number | string | null | undefined) => brl.format(Number(v ?? 0));
export const moneyCompact = (v: number | string | null | undefined) => brlCompact.format(Number(v ?? 0));

/** Datas "puras" (date do Postgres, AAAA-MM-DD) não sofrem conversão de fuso. */
export function date(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return dateFmt.format(new Date(v));
}
export const dateTime = (v: string | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : "—");

/** Hoje em São Paulo, no formato AAAA-MM-DD. */
export function todayISO(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Dias até a data (negativo = atrasado). */
export function daysUntil(iso: string | null | undefined, today = todayISO()): number | null {
  if (!iso) return null;
  const a = Date.parse(today + "T00:00:00Z"), b = Date.parse(iso.slice(0, 10) + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export function hours(minutes: number | null | undefined): string {
  const m = Number(minutes ?? 0);
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

export function onlyDigits(s: string) { return s.replace(/\D/g, ""); }

export function formatDocument(doc: string | null | undefined): string {
  const d = onlyDigits(doc ?? "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc ?? "";
}

/** Validação de CPF/CNPJ pelos dígitos verificadores. */
export function isValidDocument(doc: string): boolean {
  const d = onlyDigits(doc);
  if (d.length === 11) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (len: number) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1+$/.test(d)) return false;
    const calc = (len: number) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = w.reduce((acc, wi, i) => acc + wi * Number(d[i]), 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Substitui {{variaveis}} de modelos de contrato/proposta, escapando HTML. */
export function fillTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): { html: string; missing: string[] } {
  const missing = new Set<string>();
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = tpl.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") { missing.add(key); return `<mark data-missing="${key}">{{${key}}}</mark>`; }
    return esc(String(v));
  });
  return { html, missing: [...missing] };
}
