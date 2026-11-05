// Monta os blocos de PDF de propostas e contratos a partir do banco.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { type Block, fillVars, htmlToBlocks, renderDocument } from "./pdf.ts";
import { HttpError } from "./http.ts";

const brl = (v: number | string | null | undefined) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));
const dt = (v: string | null | undefined) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const pad = (n: number) => String(n).padStart(4, "0");

/** `db` pode ser o cliente do usuário (RLS) ou o administrativo (link público). */
export async function proposalPdf(db: SupabaseClient, proposalId: string) {
  const { data: p, error } = await db.from("proposals")
    .select("*, clients(legal_name), organizations(name, email, phone, branding)").eq("id", proposalId).single();
  if (error || !p) throw new HttpError(404, "proposal_not_found");
  const { data: items } = await db.from("proposal_items").select("*").eq("proposal_id", proposalId).order("position");
  const blocks: Block[] = [
    { type: "h1", text: p.title },
    { type: "small", text: `Para ${p.clients?.legal_name ?? "—"} · emitida em ${dt(p.sent_at ?? p.created_at)} · válida até ${dt(p.valid_until)}` },
    { type: "spacer", size: 6 },
  ];
  for (const [t, v] of [["Apresentação", p.intro], ["Escopo", p.scope], ["Entregáveis", p.deliverables]] as const) if (v) blocks.push({ type: "h2", text: t }, { type: "p", text: v });
  blocks.push({ type: "h2", text: "Investimento" }, {
    type: "table", columns: ["Item", "Qtd.", "Unitário", "Total"], widths: [6, 1, 2, 2], align: ["left", "right", "right", "right"],
    rows: (items ?? []).map((i) => [`${i.description}${i.is_package ? " (pacote)" : ""}${i.details ? `\n${i.details}` : ""}`, String(Number(i.quantity)), brl(i.unit_price), brl(i.line_total)]),
  });
  const totals: [string, string][] = [["Subtotal", brl(p.subtotal)]];
  if (p.discount_type !== "none") totals.push(["Desconto", `- ${brl(Number(p.subtotal) - Number(p.total))}`]);
  totals.push(["Total", brl(p.total)]);
  blocks.push({ type: "totals", rows: totals });
  if (p.installments > 1) blocks.push({ type: "small", text: `Em ${p.installments}x de ${brl(Number(p.total) / p.installments)}${p.first_due_date ? `, a partir de ${dt(p.first_due_date)}` : ""}.` });
  blocks.push({ type: "h2", text: "Condições" }, { type: "p", text: [p.terms, `Revisões incluídas: ${p.revisions} rodada(s) por etapa.`].filter(Boolean).join("\n") });
  const org = p.organizations;
  const bytes = await renderDocument({ studio: org?.name ?? "Estúdio", studioContact: [org?.email, org?.phone].filter(Boolean).join(" · "),
    docLabel: "Proposta comercial", docNumber: `Nº ${pad(p.number)}`, accent: org?.branding?.primary_color, blocks, footer: `Proposta válida até ${dt(p.valid_until)}` });
  return { bytes, organizationId: p.organization_id as string, fileName: `proposta-${pad(p.number)}.pdf`, number: p.number as number };
}

export async function contractPdf(db: SupabaseClient, contractId: string, version?: number) {
  const { data: c, error } = await db.from("contracts").select("*, organizations(name, email, phone, branding)").eq("id", contractId).single();
  if (error || !c) throw new HttpError(404, "contract_not_found");
  const want = version ?? c.current_version;
  const { data: v } = await db.from("contract_versions").select("id, version, body_html").eq("contract_id", contractId).eq("version", want).single();
  if (!v) throw new HttpError(404, "version_not_found");
  const { data: vars } = await db.rpc("contract_variables", { p_contract: contractId });
  const html = fillVars(v.body_html, (vars ?? {}) as Record<string, string>);
  const missing = [...html.matchAll(/\[([a-z0-9_]+)\]/g)].map((m) => m[1]);
  const org = c.organizations;
  const bytes = await renderDocument({ studio: org?.name ?? "Estúdio", studioContact: [org?.email, org?.phone].filter(Boolean).join(" · "),
    docLabel: "Contrato", docNumber: `Nº ${pad(c.number)} · v${v.version}`, accent: org?.branding?.primary_color, blocks: htmlToBlocks(html),
    footer: `Contrato Nº ${pad(c.number)}, versão ${v.version}` });
  return { bytes, organizationId: c.organization_id as string, versionId: v.id as string, fileName: `contrato-${pad(c.number)}-v${v.version}.pdf`, missing, contract: c };
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
