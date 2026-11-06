import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, ImageUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBreadcrumbs } from "@/components/layout/AppShell";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, IconButton, Input, Modal, PageHeader, Spinner, Tabs, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { appUrl, supabase } from "@/lib/supabase";
import defaults from "../../../site/site-config.json";
import { emptyProject, moveItem, siteProblems, uniqueSlug, type Policy, type Project, type SiteContent } from "./siteContent";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
type Tab = "general" | "social" | "phrases" | "portfolio" | "policies";

/** Envia uma imagem ao bucket público do site e devolve a URL definitiva. */
function useSiteUpload() {
  const { orgId } = useOrg();
  return async (file: File) => {
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) throw new Error(`${file.name}: use PNG, JPG, WebP, GIF ou AVIF.`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: limite de 10 MB por imagem.`);
    const path = `${orgId}/portfolio/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await supabase.storage.from("site-public").upload(path, file, { contentType: file.type });
    if (error) throw error;
    return supabase.storage.from("site-public").getPublicUrl(path).data.publicUrl;
  };
}

export function SitePage() {
  useBreadcrumbs([{ label: "Site" }]);
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("general");
  const [c, setC] = useState<SiteContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const q = useQuery({
    queryKey: ["site-settings", orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_settings").select("content").eq("organization_id", orgId).maybeSingle();
      if (error) throw error;
      return (data?.content ?? null) as Partial<SiteContent> | null;
    },
  });
  useEffect(() => { if (q.isSuccess && !dirty) setC({ ...(defaults as SiteContent), ...(q.data ?? {}) }); }, [q.isSuccess, q.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (patch: Partial<SiteContent>) => { setC((s) => (s ? { ...s, ...patch } : s)); setDirty(true); };
  const problems = c ? siteProblems(c) : [];
  const save = async () => {
    if (!c) return;
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({ organization_id: orgId, content: c }, { onConflict: "organization_id" });
    setSaving(false);
    if (error) return toast({ tone: "error", message: errorMessage(error) });
    setDirty(false);
    qc.invalidateQueries({ queryKey: ["site-settings", orgId] });
    toast({ tone: "success", message: "Site atualizado. As mudanças já estão no ar." });
  };

  const header = (
    <PageHeader title="Site" description="Portfólio, políticas, redes e contato do site público."
      actions={<>
        <a href={appUrl("/site/")} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="size-4" />}>Abrir site</Button></a>
        <Button variant="primary" loading={saving} disabled={!dirty || !!problems.length} onClick={save}>Salvar e publicar</Button>
      </>} />
  );
  if (q.isLoading || (q.isSuccess && !c)) return <>{header}<Spinner /></>;
  if (q.error) {
    const missing = /site_settings|PGRST205|42P01/.test(JSON.stringify(q.error));
    return <>{header}{missing
      ? <EmptyState title="O banco ainda não tem a tabela do site" description="Aplique a migration 20261111000100_site.sql no Supabase. O passo a passo está em docs/IMPLANTACAO.md." />
      : <ErrorState error={q.error} onRetry={() => q.refetch()} />}</>;
  }
  return (
    <>
      {header}
      <Tabs value={tab} onChange={setTab} items={[{ value: "general", label: "Geral" }, { value: "social", label: "Redes" }, { value: "phrases", label: "Frases" }, { value: "portfolio", label: "Portfólio", count: c!.portfolio.length }, { value: "policies", label: "Políticas" }]} />
      {!!problems.length && <div role="alert" className="mt-4 max-w-3xl rounded-lg border border-border bg-surface-2 p-3 text-sm"><p className="font-medium">Corrija antes de publicar:</p>{problems.map((p) => <p key={p} className="text-fg-2">{p}</p>)}</div>}
      <div className="pt-5">
        {tab === "general" ? <General c={c!} change={change} />
          : tab === "social" ? <Social c={c!} change={change} />
          : tab === "phrases" ? <Phrases c={c!} change={change} />
          : tab === "portfolio" ? <Portfolio c={c!} change={change} />
          : <Policies c={c!} change={change} />}
      </div>
    </>
  );
}

type PanelProps = { c: SiteContent; change: (p: Partial<SiteContent>) => void };

function General({ c, change }: PanelProps) {
  const emp = (k: keyof SiteContent["empresa"], v: string) => change({ empresa: { ...c.empresa, [k]: v } });
  const tex = (k: keyof SiteContent["textura"], v: number) => change({ textura: { ...c.textura, [k]: v } });
  return (
    <div className="grid max-w-3xl gap-4">
      <Card>
        <CardHeader title="Contato e empresa" description="O e-mail aparece no site. Razão social, CNPJ e cidade entram nas políticas." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail de contato" required htmlFor="st-email" className="sm:col-span-2"><Input id="st-email" type="email" value={c.contato.email} onChange={(e) => change({ contato: { ...c.contato, email: e.target.value } })} /></Field>
          <Field label="Razão social" htmlFor="st-legal"><Input id="st-legal" value={c.empresa.razaoSocial} onChange={(e) => emp("razaoSocial", e.target.value)} /></Field>
          <Field label="CNPJ" htmlFor="st-cnpj"><Input id="st-cnpj" value={c.empresa.cnpj} onChange={(e) => emp("cnpj", e.target.value)} /></Field>
          <Field label="Cidade" htmlFor="st-city"><Input id="st-city" value={c.empresa.cidade} onChange={(e) => emp("cidade", e.target.value)} /></Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Textura da abertura" description="Controla a deformação do fundo azul na primeira tela do site." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Intensidade: ${c.textura.intensidade.toFixed(1).replace(".", ",")}`} htmlFor="st-int" hint="0 deixa a textura parada."><input id="st-int" type="range" min={0} max={2} step={0.1} className="w-full accent-[var(--accent)]" value={c.textura.intensidade} onChange={(e) => tex("intensidade", Number(e.target.value))} /></Field>
          <Field label={`Velocidade: ${c.textura.velocidade.toFixed(1).replace(".", ",")}`} htmlFor="st-vel"><input id="st-vel" type="range" min={0} max={3} step={0.1} className="w-full accent-[var(--accent)]" value={c.textura.velocidade} onChange={(e) => tex("velocidade", Number(e.target.value))} /></Field>
        </div>
      </Card>
    </div>
  );
}

function Social({ c, change }: PanelProps) {
  const set = (i: number, patch: Partial<SiteContent["redes"][number]>) => change({ redes: c.redes.map((r, n) => (n === i ? { ...r, ...patch } : r)) });
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Links do rodapé" description="Aparecem no rodapé do site, na ordem abaixo. Links sem endereço ficam ocultos."
        actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => change({ redes: [...c.redes, { nome: "", url: "" }] })}>Adicionar</Button>} />
      <div className="grid gap-3">
        {c.redes.map((r, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[180px_1fr_auto]">
            <Field label="Nome" htmlFor={`st-rn-${i}`}><Input id={`st-rn-${i}`} value={r.nome} onChange={(e) => set(i, { nome: e.target.value })} /></Field>
            <Field label="Endereço" htmlFor={`st-ru-${i}`}><Input id={`st-ru-${i}`} type="url" placeholder="https://" value={r.url} onChange={(e) => set(i, { url: e.target.value })} /></Field>
            <IconButton label={`Remover ${r.nome || "link"}`} onClick={() => change({ redes: c.redes.filter((_, n) => n !== i) })}><Trash2 className="size-4" /></IconButton>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Phrases({ c, change }: PanelProps) {
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Faixa de frases" description="Frases que passam na faixa escura da home. Escreva uma por linha." />
      <Field label="Frases" htmlFor="st-frases"><Textarea id="st-frases" rows={8} value={c.frases.join("\n")} onChange={(e) => change({ frases: e.target.value.split("\n") })} onBlur={() => change({ frases: c.frases.map((f) => f.trim()).filter(Boolean) })} /></Field>
    </Card>
  );
}

function Portfolio({ c, change }: PanelProps) {
  const [edit, setEdit] = useState<{ index: number | null; p: Project } | null>(null);
  const [del, setDel] = useState<number | null>(null);
  const commit = (p: Project) => {
    const others = c.portfolio.filter((_, i) => i !== edit!.index);
    const row = { ...p, slug: uniqueSlug(p.titulo, others.map((x) => x.slug)) };
    change({ portfolio: edit!.index == null ? [...c.portfolio, row] : c.portfolio.map((x, i) => (i === edit!.index ? row : x)) });
    setEdit(null);
  };
  return (
    <Card padded={false} className="max-w-4xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div><p className="text-sm font-medium">Projetos do portfólio</p><p className="text-xs text-fg-3">Os três primeiros aparecem na home. Use as setas para ordenar.</p></div>
        <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ index: null, p: emptyProject() })}>Novo projeto</Button>
      </div>
      {!c.portfolio.length ? <p className="p-6 text-center text-sm text-fg-3">Nenhum projeto cadastrado.</p> : (
        <ul>{c.portfolio.map((p, i) => (
          <li key={p.slug} className="flex items-center gap-3 border-t border-border p-3 first:border-0">
            {p.capa ? <img src={p.capa.startsWith("assets/") ? appUrl(`/site/${p.capa}`) : p.capa} alt="" className="h-12 w-16 shrink-0 rounded object-cover" /> : <div className="h-12 w-16 shrink-0 rounded bg-surface-2" />}
            <div className="min-w-0 flex-1">
              <button className="block max-w-full truncate text-left text-sm font-medium hover:text-accent" onClick={() => setEdit({ index: i, p })}>{p.titulo}</button>
              <p className="truncate text-xs text-fg-3">{[p.cliente, p.categorias.join(", "), p.ano].filter(Boolean).join(" · ")}</p>
            </div>
            {p.exemplo && <Badge>Exemplo</Badge>}
            <IconButton label={`Subir ${p.titulo}`} disabled={i === 0} onClick={() => change({ portfolio: moveItem(c.portfolio, i, -1) })}><ArrowUp className="size-4" /></IconButton>
            <IconButton label={`Descer ${p.titulo}`} disabled={i === c.portfolio.length - 1} onClick={() => change({ portfolio: moveItem(c.portfolio, i, 1) })}><ArrowDown className="size-4" /></IconButton>
            <IconButton label={`Excluir ${p.titulo}`} onClick={() => setDel(i)}><Trash2 className="size-4" /></IconButton>
          </li>))}</ul>
      )}
      {edit && <ProjectModal initial={edit.p} isNew={edit.index == null} onClose={() => setEdit(null)} onSave={commit} />}
      <ConfirmDialog open={del != null} onClose={() => setDel(null)} title="Excluir projeto?" description="O projeto sai do site quando você clicar em Salvar e publicar."
        onConfirm={() => { change({ portfolio: c.portfolio.filter((_, i) => i !== del) }); setDel(null); }} />
    </Card>
  );
}

function ProjectModal({ initial, isNew, onClose, onSave }: { initial: Project; isNew: boolean; onClose: () => void; onSave: (p: Project) => void }) {
  const upload = useSiteUpload();
  const toast = useToast();
  const [p, setP] = useState(initial);
  const [cats, setCats] = useState(initial.categorias.join(", "));
  const [busy, setBusy] = useState(false);
  const cover = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const src = (u: string) => (u.startsWith("assets/") ? appUrl(`/site/${u}`) : u);
  const send = async (files: File[], done: (urls: string[]) => void) => {
    if (!files.length) return;
    setBusy(true);
    try { done(await Promise.all(files.map(upload))); }
    catch (e) { toast({ tone: "error", message: errorMessage(e) }); }
    setBusy(false);
  };
  const bind = (k: "titulo" | "cliente" | "ano" | "resumo" | "desafio" | "solucao" | "link") => ({ id: `st-p-${k}`, value: p[k], onChange: (e: { target: { value: string } }) => setP((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? "Novo projeto" : "Editar projeto"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={p.titulo.trim().length < 2 || busy} onClick={() => onSave({ ...p, titulo: p.titulo.trim(), categorias: cats.split(",").map((x) => x.trim()).filter(Boolean) })}>Aplicar</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" required htmlFor="st-p-titulo" className="sm:col-span-2"><Input {...bind("titulo")} /></Field>
        <Field label="Cliente" htmlFor="st-p-cliente"><Input {...bind("cliente")} /></Field>
        <Field label="Ano" htmlFor="st-p-ano"><Input inputMode="numeric" {...bind("ano")} /></Field>
        <Field label="Categorias" htmlFor="st-p-cats" hint="Separe por vírgula. Viram os filtros do portfólio." className="sm:col-span-2"><Input id="st-p-cats" value={cats} onChange={(e) => setCats(e.target.value)} /></Field>
        <Field label="Resumo" htmlFor="st-p-resumo" className="sm:col-span-2"><Textarea {...bind("resumo")} /></Field>
        <Field label="O desafio" htmlFor="st-p-desafio"><Textarea rows={4} {...bind("desafio")} /></Field>
        <Field label="A solução" htmlFor="st-p-solucao"><Textarea rows={4} {...bind("solucao")} /></Field>
        <Field label="Link externo" htmlFor="st-p-link" hint="Opcional. Mostra o botão Ver projeto." className="sm:col-span-2"><Input type="url" placeholder="https://" {...bind("link")} /></Field>
        <div className="grid gap-2 sm:col-span-2">
          <p className="text-sm font-medium">Capa</p>
          <div className="flex items-center gap-3">
            {p.capa && <img src={src(p.capa)} alt="Capa atual" className="h-20 w-28 rounded object-cover" />}
            <input ref={cover} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send([f], ([u]) => setP((s) => ({ ...s, capa: u }))); }} />
            <Button icon={<ImageUp className="size-4" />} loading={busy} onClick={() => cover.current?.click()}>Enviar capa</Button>
          </div>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <p className="text-sm font-medium">Galeria</p>
          <div className="flex flex-wrap gap-2">
            {p.imagens.map((u, i) => (
              <div key={u + i} className="relative">
                <img src={src(u)} alt={`Imagem ${i + 1}`} className="h-20 w-28 rounded object-cover" />
                <button type="button" aria-label={`Remover imagem ${i + 1}`} className="absolute right-1 top-1 rounded bg-surface p-1 shadow-sm" onClick={() => setP((s) => ({ ...s, imagens: s.imagens.filter((_, n) => n !== i) }))}><Trash2 className="size-3.5" /></button>
              </div>))}
          </div>
          <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; send(fs, (us) => setP((s) => ({ ...s, imagens: [...s.imagens, ...us] }))); }} />
          <div><Button icon={<ImageUp className="size-4" />} loading={busy} onClick={() => gallery.current?.click()}>Adicionar imagens</Button></div>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="accent-[var(--accent)]" checked={!!p.exemplo} onChange={(e) => setP((s) => ({ ...s, exemplo: e.target.checked }))} />Mostrar selo de exemplo</label>
      </div>
    </Modal>
  );
}

function Policies({ c, change }: PanelProps) {
  const [which, setWhich] = useState<"privacidade" | "cookies">("privacidade");
  const d: Policy = c.politicas[which];
  const set = (patch: Partial<Policy>) => change({ politicas: { ...c.politicas, [which]: { ...d, ...patch } } });
  const sec = (i: number, patch: Partial<Policy["secoes"][number]>) => set({ secoes: d.secoes.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  return (
    <div className="grid max-w-3xl gap-4">
      <Tabs value={which} onChange={setWhich} items={[{ value: "privacidade", label: "Privacidade" }, { value: "cookies", label: "Cookies" }]} />
      <Card>
        <CardHeader title={d.titulo} description="Use {{razaoSocial}}, {{cnpj}}, {{cidade}} e {{email}} para puxar os dados da aba Geral. Separe parágrafos com uma linha em branco." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" htmlFor="st-pol-t"><Input id="st-pol-t" value={d.titulo} onChange={(e) => set({ titulo: e.target.value })} /></Field>
          <Field label="Última atualização" htmlFor="st-pol-d"><Input id="st-pol-d" value={d.atualizadaEm} onChange={(e) => set({ atualizadaEm: e.target.value })} /></Field>
        </div>
      </Card>
      {d.secoes.map((s, i) => (
        <Card key={i}>
          <div className="grid gap-3">
            <div className="flex items-end gap-2">
              <Field label="Seção" htmlFor={`st-sec-${i}`} className="min-w-0 flex-1"><Input id={`st-sec-${i}`} value={s.titulo} onChange={(e) => sec(i, { titulo: e.target.value })} /></Field>
              <IconButton label={`Subir seção ${s.titulo}`} disabled={i === 0} onClick={() => set({ secoes: moveItem(d.secoes, i, -1) })}><ArrowUp className="size-4" /></IconButton>
              <IconButton label={`Descer seção ${s.titulo}`} disabled={i === d.secoes.length - 1} onClick={() => set({ secoes: moveItem(d.secoes, i, 1) })}><ArrowDown className="size-4" /></IconButton>
              <IconButton label={`Remover seção ${s.titulo}`} onClick={() => set({ secoes: d.secoes.filter((_, n) => n !== i) })}><Trash2 className="size-4" /></IconButton>
            </div>
            <Field label="Texto" htmlFor={`st-txt-${i}`}><Textarea id={`st-txt-${i}`} rows={5} value={s.paragrafos.join("\n\n")} onChange={(e) => sec(i, { paragrafos: e.target.value.split(/\n{2,}/) })} /></Field>
          </div>
        </Card>
      ))}
      <div><Button icon={<Plus className="size-4" />} onClick={() => set({ secoes: [...d.secoes, { titulo: "Nova seção", paragrafos: [""] }] })}>Adicionar seção</Button></div>
    </div>
  );
}
