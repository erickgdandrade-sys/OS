import { useQuery } from "@tanstack/react-query";
import { Plus, Send, Sparkles, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* Naming e pesquisa competitiva do projeto.
   Disponibilidade: o sistema NUNCA declara um nome disponível juridicamente —
   cada etapa exige o registro da pesquisa (banco exige notas e grava quem/quando). */
type Criterion = { id: string; name: string; weight: number };
type Territory = { id: string; name: string; description: string | null };
type Candidate = { id: string; name: string; territory_id: string | null; category: string | null; meaning: string | null; etymology: string | null; rationale: string | null;
  is_finalist: boolean; availability_status: Availability; availability_notes: string | null; availability_checked_at: string | null; availability_checked_by: string | null };
type Rank = { candidate_id: string; weighted_score: number | null; scorers: number };
type Availability = "not_checked" | "preliminary_search_done" | "conflict_found" | "sent_to_legal_review" | "cleared_by_legal";
export const availabilityLabel: Record<Availability, string> = {
  not_checked: "Não verificado", preliminary_search_done: "Pesquisa preliminar feita", conflict_found: "Conflito encontrado",
  sent_to_legal_review: "Em análise jurídica", cleared_by_legal: "Liberado pelo jurídico",
};
const availabilityTone: Record<Availability, "neutral" | "info" | "danger" | "warning" | "success"> = {
  not_checked: "neutral", preliminary_search_done: "info", conflict_found: "danger", sent_to_legal_review: "warning", cleared_by_legal: "success",
};

export function NamingPanel({ projectId, orgId, canEdit }: { projectId: string; orgId: string; canEdit: boolean }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Candidate | null>(null);
  const [newCrit, setNewCrit] = useState({ name: "", weight: "1" });
  const [newTerr, setNewTerr] = useState("");
  const [sending, setSending] = useState(false);
  const crit = useQuery({ queryKey: ["naming-criteria", projectId], queryFn: async () => ((await supabase.from("naming_criteria").select("id, name, weight").eq("project_id", projectId).order("weight", { ascending: false })).data ?? []) as Criterion[] });
  const terr = useQuery({ queryKey: ["naming-territories", projectId], queryFn: async () => ((await supabase.from("naming_territories").select("id, name, description").eq("project_id", projectId).order("name")).data ?? []) as Territory[] });
  const cands = useQuery({ queryKey: ["naming-candidates", projectId], queryFn: async () => ((await supabase.from("naming_candidates").select("*").eq("project_id", projectId).order("created_at")).data ?? []) as Candidate[] });
  const rank = useQuery({ queryKey: ["naming-ranking", projectId], queryFn: async () => ((await supabase.from("naming_ranking").select("candidate_id, weighted_score, scorers").eq("project_id", projectId)).data ?? []) as Rank[] });
  const refresh = () => { crit.refetch(); terr.refetch(); cands.refetch(); rank.refetch(); };
  const rows = useMemo(() => {
    const r = Object.fromEntries((rank.data ?? []).map((x) => [x.candidate_id, x]));
    return (cands.data ?? []).map((c) => ({ ...c, score: r[c.id]?.weighted_score ?? null, scorers: r[c.id]?.scorers ?? 0 }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [cands.data, rank.data]);
  const finalists = rows.filter((c) => c.is_finalist);
  const run = async (p: PromiseLike<{ error: unknown }>, ok?: string) => { const { error } = await p; if (error) toast({ tone: "error", message: errorMessage(error) }); else { if (ok) toast({ tone: "success", message: ok }); refresh(); } };

  const sendFinalists = async () => {
    if (!finalists.length) { toast({ tone: "error", message: "Marque pelo menos um finalista." }); return; }
    setSending(true);
    const desc = finalists.map((c) => `• ${c.name}${c.meaning ? ` — ${c.meaning}` : ""}${c.rationale ? `\n  ${c.rationale}` : ""}\n  Disponibilidade: ${availabilityLabel[c.availability_status]}`).join("\n");
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("approvals").insert({ organization_id: orgId, project_id: projectId, title: `Nomes finalistas (${finalists.length})`, description: desc.slice(0, 4000), entity_type: "naming", requested_by: u.user?.id });
    setSending(false);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else toast({ tone: "success", message: "Finalistas enviados para aprovação do cliente (aparecem no link do projeto)." });
  };

  return (
    <div className="grid gap-4">
      <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">A disponibilidade de um nome só é registrada com a pesquisa feita (INPI, domínio, redes). O sistema não declara um nome juridicamente livre: “Liberado pelo jurídico” exige o parecer anotado.</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Ranking de nomes" description={rows.length ? `${rows.length} candidato(s) · nota ponderada pelos pesos dos critérios (0 a 10)` : "Cadastre nomes, avalie cada critério e acompanhe o ranking."}
            actions={canEdit && <div className="flex gap-2">
              <Button size="sm" icon={<Send className="size-3.5" />} loading={sending} disabled={!finalists.length} onClick={sendFinalists}>Enviar finalistas ao cliente</Button>
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>Novo nome</Button></div>} />
          {cands.isLoading ? <Skeleton className="h-32" /> : !rows.length ? <EmptyState title="Nenhum nome ainda" description="Comece pelos territórios e critérios ao lado, depois cadastre os nomes." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs text-fg-3"><th className="py-2 pr-2">#</th><th className="pr-2">Nome</th><th className="pr-2">Território</th><th className="pr-2 text-right">Nota</th><th className="pr-2 text-right">Avaliações</th><th className="pr-2">Disponibilidade</th><th /></tr></thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr key={c.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2" onClick={() => setOpen(c)}>
                      <td className="py-2.5 pr-2 tabular text-fg-3">{i + 1}</td>
                      <td className="pr-2 font-medium">{c.name}</td>
                      <td className="pr-2 text-fg-3">{terr.data?.find((t) => t.id === c.territory_id)?.name ?? "—"}</td>
                      <td className="pr-2 text-right font-medium tabular">{c.score != null ? c.score.toFixed(2).replace(".", ",") : "—"}</td>
                      <td className="pr-2 text-right tabular text-fg-3">{c.scorers}</td>
                      <td className="pr-2"><Badge tone={availabilityTone[c.availability_status]}>{availabilityLabel[c.availability_status]}</Badge></td>
                      <td className="text-right">
                        <button type="button" disabled={!canEdit} aria-label={c.is_finalist ? "Remover dos finalistas" : "Marcar como finalista"} aria-pressed={c.is_finalist}
                          onClick={(e) => { e.stopPropagation(); run(supabase.from("naming_candidates").update({ is_finalist: !c.is_finalist }).eq("id", c.id)); }}
                          className={cn("rounded p-1", c.is_finalist ? "text-warning" : "text-fg-3 hover:text-fg")}><Star className={cn("size-4", c.is_finalist && "fill-current")} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="grid h-fit gap-4">
          <Card>
            <CardHeader title="Critérios e pesos" actions={canEdit && !crit.data?.length && <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={() => run(supabase.rpc("seed_naming_criteria", { p_project: projectId }), "Critérios padrão criados.")}>Usar padrão</Button>} />
            <ul className="grid gap-2">
              {crit.data?.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{c.name}</span>
                  <Input aria-label={`Peso de ${c.name}`} type="number" min={0} max={10} step={0.5} disabled={!canEdit} defaultValue={c.weight} className="w-20"
                    onBlur={(e) => { const w = Number(e.target.value); if (w !== Number(c.weight) && w >= 0 && w <= 10) run(supabase.from("naming_criteria").update({ weight: w }).eq("id", c.id)); }} />
                  {canEdit && <Button size="sm" variant="ghost" aria-label={`Remover ${c.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => run(supabase.from("naming_criteria").delete().eq("id", c.id))} />}
                </li>))}
            </ul>
            {canEdit && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newCrit.name.trim().length < 2) return;
              run(supabase.from("naming_criteria").insert({ organization_id: orgId, project_id: projectId, name: newCrit.name.trim(), weight: Number(newCrit.weight) || 1 })); setNewCrit({ name: "", weight: "1" }); }}>
              <Input aria-label="Novo critério" placeholder="Novo critério" value={newCrit.name} onChange={(e) => setNewCrit({ ...newCrit, name: e.target.value })} />
              <Input aria-label="Peso" type="number" min={0} max={10} className="w-20" value={newCrit.weight} onChange={(e) => setNewCrit({ ...newCrit, weight: e.target.value })} />
              <Button type="submit" size="sm" aria-label="Adicionar critério" icon={<Plus className="size-3.5" />} />
            </form>}
          </Card>
          <Card>
            <CardHeader title="Territórios" description="Caminhos criativos para agrupar os nomes." />
            <ul className="grid gap-1.5">{terr.data?.map((t) => <li key={t.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{t.name}</span>
              {canEdit && <Button size="sm" variant="ghost" aria-label={`Remover ${t.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => run(supabase.from("naming_territories").delete().eq("id", t.id))} />}</li>)}</ul>
            {canEdit && <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTerr.trim().length < 2) return;
              run(supabase.from("naming_territories").insert({ organization_id: orgId, project_id: projectId, name: newTerr.trim() })); setNewTerr(""); }}>
              <Input aria-label="Novo território" placeholder="Ex.: Natureza, Origem, Tupi" value={newTerr} onChange={(e) => setNewTerr(e.target.value)} />
              <Button type="submit" size="sm" aria-label="Adicionar território" icon={<Plus className="size-3.5" />} />
            </form>}
          </Card>
        </div>
      </div>
      <Competitors projectId={projectId} orgId={orgId} canEdit={canEdit} />
      {adding && <CandidateModal projectId={projectId} orgId={orgId} territories={terr.data ?? []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
      {open && <CandidateDetail c={open} criteria={crit.data ?? []} territories={terr.data ?? []} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}

function CandidateModal({ projectId, orgId, territories, onClose, onSaved }: { projectId: string; orgId: string; territories: Territory[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { userId } = useOrg();
  const [f, setF] = useState({ names: "", territory_id: "", meaning: "", rationale: "" });
  const save = async () => {
    const names = f.names.split(/\n/).map((n) => n.trim()).filter((n) => n.length >= 2);
    if (!names.length) { toast({ tone: "error", message: "Digite pelo menos um nome." }); return; }
    const { error } = await supabase.from("naming_candidates").insert(names.map((name) => ({ organization_id: orgId, project_id: projectId, name, territory_id: f.territory_id || null,
      meaning: names.length === 1 ? f.meaning || null : null, rationale: names.length === 1 ? f.rationale || null : null, created_by: userId })));
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: `${names.length} nome(s) adicionados.` }); onSaved(); }
  };
  return (
    <Modal open onClose={onClose} title="Novos nomes" description="Um nome por linha para cadastrar vários de uma vez."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Adicionar</Button></>}>
      <div className="grid gap-4">
        <Field label="Nomes" required htmlFor="nc-names"><Textarea id="nc-names" rows={4} value={f.names} onChange={(e) => setF({ ...f, names: e.target.value })} /></Field>
        <Field label="Território" htmlFor="nc-terr"><Select id="nc-terr" value={f.territory_id} onChange={(e) => setF({ ...f, territory_id: e.target.value })}><option value="">Sem território</option>{territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Significado (se for um nome só)" htmlFor="nc-mean"><Input id="nc-mean" value={f.meaning} onChange={(e) => setF({ ...f, meaning: e.target.value })} /></Field>
        <Field label="Justificativa (se for um nome só)" htmlFor="nc-rat"><Textarea id="nc-rat" value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function CandidateDetail({ c, criteria, territories, canEdit, onClose, onChanged }: { c: Candidate; criteria: Criterion[]; territories: Territory[]; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { userId, orgId } = useOrg();
  const [f, setF] = useState({ name: c.name, territory_id: c.territory_id ?? "", meaning: c.meaning ?? "", etymology: c.etymology ?? "", rationale: c.rationale ?? "" });
  const [av, setAv] = useState<{ status: Availability; notes: string }>({ status: c.availability_status, notes: "" });
  const [del, setDel] = useState(false);
  const scores = useQuery({ queryKey: ["naming-scores", c.id], queryFn: async () => (await supabase.from("naming_scores").select("criterion_id, scorer_id, score").eq("candidate_id", c.id)).data ?? [] });
  const mine = Object.fromEntries((scores.data ?? []).filter((s) => s.scorer_id === userId).map((s) => [s.criterion_id, s.score]));
  const setScore = async (criterion: string, score: number) => {
    const { error } = await supabase.from("naming_scores").upsert({ organization_id: orgId, candidate_id: c.id, criterion_id: criterion, scorer_id: userId, score });
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { scores.refetch(); onChanged(); }
  };
  const saveInfo = async () => {
    const { error } = await supabase.from("naming_candidates").update({ name: f.name.trim(), territory_id: f.territory_id || null, meaning: f.meaning || null, etymology: f.etymology || null, rationale: f.rationale || null }).eq("id", c.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Nome atualizado." }); onChanged(); }
  };
  const saveAvailability = async () => {
    if (av.status !== "not_checked" && av.notes.trim().length < 5) { toast({ tone: "error", message: "Descreva a pesquisa feita (onde buscou, classe, data, resultado)." }); return; }
    const stamp = `${new Date().toLocaleDateString("pt-BR")}: ${availabilityLabel[av.status]} — ${av.notes.trim()}`;
    const { error } = await supabase.from("naming_candidates").update({ availability_status: av.status, availability_notes: [c.availability_notes, stamp].filter(Boolean).join("\n") }).eq("id", c.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { toast({ tone: "success", message: "Validação registrada." }); onChanged(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={c.name}>
      <div className="grid gap-5">
        <section>
          <h3 className="mb-2 text-sm font-semibold">Sua avaliação (0 a 10)</h3>
          {!criteria.length ? <p className="text-sm text-fg-3">Cadastre os critérios primeiro.</p> : (
            <div className="grid gap-2">
              {criteria.map((cr) => (
                <div key={cr.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-44">{cr.name} <span className="text-xs text-fg-3">peso {String(cr.weight).replace(".", ",")}</span></span>
                  <div className="flex gap-1" role="radiogroup" aria-label={`Nota de ${cr.name}`}>
                    {Array.from({ length: 11 }, (_, n) => (
                      <button key={n} type="button" role="radio" aria-checked={mine[cr.id] === n} onClick={() => setScore(cr.id, n)}
                        className={cn("size-7 rounded text-xs tabular ring-1 ring-inset", mine[cr.id] === n ? "bg-accent text-white ring-accent" : "ring-border hover:bg-surface-2")}>{n}</button>))}
                  </div>
                </div>))}
              <p className="text-xs text-fg-3">{new Set((scores.data ?? []).map((s) => s.scorer_id)).size} pessoa(s) avaliaram este nome.</p>
            </div>)}
        </section>
        {canEdit && <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" htmlFor="cd-name"><Input id="cd-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Território" htmlFor="cd-terr"><Select id="cd-terr" value={f.territory_id} onChange={(e) => setF({ ...f, territory_id: e.target.value })}><option value="">Sem território</option>{territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Significado" htmlFor="cd-mean"><Input id="cd-mean" value={f.meaning} onChange={(e) => setF({ ...f, meaning: e.target.value })} /></Field>
          <Field label="Etimologia" htmlFor="cd-ety"><Input id="cd-ety" value={f.etymology} onChange={(e) => setF({ ...f, etymology: e.target.value })} /></Field>
          <Field label="Justificativa" htmlFor="cd-rat" className="sm:col-span-2"><Textarea id="cd-rat" value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2"><Button onClick={saveInfo}>Salvar informações</Button><Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)}>Excluir nome</Button></div>
        </section>}
        <section className="grid gap-3 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">Validação de disponibilidade</h3>
          <p className="text-sm">Situação atual: <Badge tone={availabilityTone[c.availability_status]}>{availabilityLabel[c.availability_status]}</Badge>{c.availability_checked_at && <span className="text-xs text-fg-3"> · registrado em {dateTime(c.availability_checked_at)}</span>}</p>
          {c.availability_notes && <pre className="whitespace-pre-wrap rounded bg-surface-2 p-2 font-sans text-xs">{c.availability_notes}</pre>}
          {canEdit && <>
            <Field label="Nova etapa" htmlFor="cd-av"><Select id="cd-av" value={av.status} onChange={(e) => setAv({ ...av, status: e.target.value as Availability })}>
              {Object.entries(availabilityLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Registro da pesquisa" required htmlFor="cd-av-notes" hint="Ex.: Busca no INPI classe 30 em 06/11, sem marcas idênticas; domínio .com.br livre no Registro.br; @arua ocupado no Instagram.">
              <Textarea id="cd-av-notes" value={av.notes} onChange={(e) => setAv({ ...av, notes: e.target.value })} /></Field>
            <div><Button variant="primary" onClick={saveAvailability}>Registrar etapa</Button></div>
          </>}
        </section>
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} title="Excluir nome?" description="As avaliações deste nome também serão apagadas."
        onConfirm={async () => { const { error } = await supabase.from("naming_candidates").delete().eq("id", c.id); if (error) toast({ tone: "error", message: errorMessage(error) }); else { onChanged(); onClose(); } }} />
    </Modal>
  );
}

type Competitor = { id: string; name: string; website: string | null; description: string | null; differentials: string | null; positioning: string | null; notes: string | null };
function Competitors({ projectId, orgId, canEdit }: { projectId: string; orgId: string; canEdit: boolean }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Competitor> | null>(null);
  const q = useQuery({ queryKey: ["competitors", projectId], queryFn: async () => ((await supabase.from("brand_competitors").select("*").eq("project_id", projectId).order("name")).data ?? []) as Competitor[] });
  const save = async () => {
    if (!edit?.name?.trim()) { toast({ tone: "error", message: "Informe o nome do concorrente." }); return; }
    if (edit.website && !/^https?:\/\//.test(edit.website)) { toast({ tone: "error", message: "O site precisa começar com http(s)://" }); return; }
    const row = { name: edit.name.trim(), website: edit.website || null, description: edit.description || null, differentials: edit.differentials || null, positioning: edit.positioning || null, notes: edit.notes || null };
    const { error } = edit.id ? await supabase.from("brand_competitors").update(row).eq("id", edit.id) : await supabase.from("brand_competitors").insert({ ...row, organization_id: orgId, project_id: projectId });
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { setEdit(null); q.refetch(); }
  };
  return (
    <Card>
      <CardHeader title="Pesquisa competitiva" description="Concorrentes, diferenciais e posicionamento para embasar a estratégia."
        actions={canEdit && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({})}>Concorrente</Button>} />
      {!q.data?.length ? <p className="text-sm text-fg-3">Nenhum concorrente cadastrado.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((c) => (
            <button key={c.id} type="button" disabled={!canEdit} onClick={() => setEdit(c)} className="rounded-lg border border-border p-3 text-left hover:bg-surface-2">
              <p className="text-sm font-medium">{c.name}</p>
              {c.website && <p className="truncate text-xs text-accent">{c.website}</p>}
              {c.positioning && <p className="mt-1 text-xs text-fg-2"><strong>Posicionamento:</strong> {c.positioning}</p>}
              {c.differentials && <p className="mt-1 text-xs text-fg-2"><strong>Diferenciais:</strong> {c.differentials}</p>}
            </button>))}
        </div>)}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Editar concorrente" : "Novo concorrente"}
          footer={<>{edit.id && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { await supabase.from("brand_competitors").delete().eq("id", edit.id!); setEdit(null); q.refetch(); }}>Excluir</Button>}
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" onClick={save}>Salvar</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required htmlFor="cp-name"><Input id="cp-name" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Site ou perfil" htmlFor="cp-site"><Input id="cp-site" type="url" placeholder="https://" value={edit.website ?? ""} onChange={(e) => setEdit({ ...edit, website: e.target.value })} /></Field>
            <Field label="Descrição" htmlFor="cp-desc" className="sm:col-span-2"><Textarea id="cp-desc" value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Posicionamento" htmlFor="cp-pos"><Textarea id="cp-pos" value={edit.positioning ?? ""} onChange={(e) => setEdit({ ...edit, positioning: e.target.value })} /></Field>
            <Field label="Diferenciais" htmlFor="cp-dif"><Textarea id="cp-dif" value={edit.differentials ?? ""} onChange={(e) => setEdit({ ...edit, differentials: e.target.value })} /></Field>
            <Field label="Observações" htmlFor="cp-notes" className="sm:col-span-2"><Textarea id="cp-notes" value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Modal>)}
    </Card>
  );
}
