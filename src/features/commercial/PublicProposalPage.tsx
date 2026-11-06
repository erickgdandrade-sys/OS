import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileDown } from "lucide-react";
import { useState } from "react";
import { Button, ErrorState, Field, Input, Spinner, Textarea, useToast } from "@/components/ui";
import { errorMessage } from "@/lib/domain";
import { date, dateTime, money } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Data = {
  proposal: { id: string; number: number; title: string; status: string; intro: string | null; scope: string | null; deliverables: string | null; terms: string | null; revisions: number;
    discount_type: string; subtotal: number; total: number; installments: number; first_due_date: string | null; valid_until: string | null; sent_at: string | null;
    client_accepted_at: string | null; client_accepted_name: string | null; clients: { legal_name: string } | null;
    organizations: { name: string; email: string | null; phone: string | null; branding: { primary_color?: string } | null } | null };
  items: { id: string; description: string; details: string | null; quantity: number; unit_price: number; line_total: number; is_package: boolean }[];
  logo: string | null;
};

/** Página pública da proposta (sem login). Token no fragmento da URL, enviado em header. */
export function PublicProposalPage() {
  const toast = useToast();
  const token = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const valid = /^[0-9a-f]{64}$/.test(token);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("proposal-public", { body, headers: { "x-portal-token": token } });
    if (error) {
      let code = error.message;
      try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* */ }
      const map: Record<string, string> = { link_expired_or_revoked: "Este link expirou ou foi revogado. Peça um novo ao estúdio.", invalid_token: "Link inválido.",
        already_accepted: "Esta proposta já foi aceita.", proposal_not_open: "Esta proposta não está mais aberta para aceite.", name_required: "Informe seu nome completo." };
      throw new Error(map[code] ?? code);
    }
    return data;
  };
  const q = useQuery({ queryKey: ["public-proposal", token], enabled: valid, retry: false, queryFn: () => call({ action: "view" }) as Promise<Data> });
  if (!valid) return <Shell><ErrorState error="Link inválido. Confira o endereço recebido do estúdio." /></Shell>;
  if (q.isLoading) return <Shell><Spinner /></Shell>;
  if (q.error || !q.data) return <Shell><ErrorState error={q.error} /></Shell>;
  const { proposal: p, items, logo } = q.data;
  const accent = p.organizations?.branding?.primary_color ?? "#0B0C12";
  const open = ["sent", "viewed", "negotiation"].includes(p.status) && !p.client_accepted_at;

  const pdf = async () => {
    setBusy("pdf");
    try {
      const r = await call({ action: "pdf" }) as { base64: string; file_name: string };
      const bin = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bin], { type: "application/pdf" })); a.download = r.file_name; a.click();
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(null); }
  };
  const accept = async () => {
    setBusy("accept");
    try { await call({ action: "accept", name, note }); toast({ tone: "success", message: "Aceite registrado. O estúdio vai entrar em contato." }); q.refetch(); }
    catch (e) { toast({ tone: "error", message: errorMessage(e) }); } finally { setBusy(null); }
  };
  const Section = ({ t, v }: { t: string; v: string | null }) => v ? <section className="mt-8"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>{t}</h2><p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#2A3342]">{v}</p></section> : null;

  return (
    <Shell>
      <article className="overflow-hidden rounded-xl border border-[#E3E7ED] bg-white text-[#0E1726] shadow-sm">
        <header className="flex items-center justify-between gap-4 border-b-2 px-6 py-5 sm:px-10" style={{ borderColor: accent }}>
          {logo ? <img src={logo} alt={p.organizations?.name} className="max-h-10 max-w-[180px] object-contain" /> : <p className="text-lg font-semibold">{p.organizations?.name}</p>}
          <div className="text-right"><p className="text-[11px] uppercase tracking-wider text-[#4A5565]">Proposta comercial</p><p className="font-semibold tabular">Nº {String(p.number).padStart(4, "0")}</p></div>
        </header>
        <div className="px-6 py-8 sm:px-10">
          <h1 className="text-2xl font-semibold sm:text-3xl">{p.title}</h1>
          <p className="mt-2 text-sm text-[#4A5565]">Para {p.clients?.legal_name} · válida até {date(p.valid_until)}</p>
          <Section t="Apresentação" v={p.intro} /><Section t="Escopo" v={p.scope} /><Section t="Entregáveis" v={p.deliverables} />
          <section className="mt-8">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>Investimento</h2>
            <ul className="divide-y divide-[#E3E7ED] border-y border-[#E3E7ED]">{items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4 py-3 text-sm"><div><p className="font-medium">{i.description}{Number(i.quantity) !== 1 && ` × ${Number(i.quantity)}`}</p>{i.details && <p className="text-[#4A5565]">{i.details}</p>}</div><span className="shrink-0 tabular">{money(i.line_total)}</span></li>))}</ul>
            <div className="ml-auto mt-3 w-full max-w-xs text-sm">
              {p.discount_type !== "none" && <><div className="flex justify-between py-0.5"><span>Subtotal</span><span className="tabular">{money(p.subtotal)}</span></div>
                <div className="flex justify-between py-0.5"><span>Desconto</span><span className="tabular">− {money(Number(p.subtotal) - Number(p.total))}</span></div></>}
              <div className="mt-1 flex justify-between border-t-2 pt-2 text-lg font-semibold" style={{ borderColor: accent }}><span>Total</span><span className="tabular">{money(p.total)}</span></div>
              {p.installments > 1 && <p className="text-right text-xs text-[#4A5565]">em {p.installments}x de {money(Number(p.total) / p.installments)}</p>}
            </div>
          </section>
          <Section t="Condições" v={[p.terms, `Revisões incluídas: ${p.revisions} rodada(s) por etapa.`].filter(Boolean).join("\n")} />
        </div>
        <footer className="grid gap-4 border-t border-[#E3E7ED] bg-[#F7F8FA] px-6 py-6 sm:px-10">
          {p.client_accepted_at ? (
            <p className="flex items-center gap-2 text-sm text-[#15803D]"><CheckCircle2 className="size-5" />Aceita por {p.client_accepted_name} em {dateTime(p.client_accepted_at)}.</p>
          ) : open ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
              <Field label="Seu nome completo" htmlFor="acc-name"><Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Observação (opcional)" htmlFor="acc-note"><Textarea id="acc-note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <p className="text-xs text-[#4A5565] sm:col-span-2">Ao aceitar, registramos seu nome, a data e a hora. O contrato será enviado em seguida para assinatura eletrônica.</p>
            </div>
          ) : <p className="text-sm text-[#4A5565]">Esta proposta não está mais aberta para aceite.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button icon={<FileDown className="size-4" />} loading={busy === "pdf"} onClick={pdf}>Baixar PDF</Button>
            {open && <Button variant="primary" loading={busy === "accept"} disabled={name.trim().length < 3} onClick={accept}>Aceitar proposta</Button>}
          </div>
        </footer>
      </article>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#EEF1F5] px-4 py-8 sm:py-12"><div className="mx-auto max-w-3xl">{children}</div>
    <p className="mt-6 text-center text-xs text-[#7A8596]">Enviado pelo ANDRA&amp;GO OS</p></div>;
}
