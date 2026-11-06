import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, Download, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, Progress, Select, Skeleton, Textarea, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { signedUrls, uploadOrgFile } from "@/lib/upload";

/* Fotografia e audiovisual: produção (pré, captação, edição), shot list,
   roteiro, cronograma, equipe e equipamentos, e a galeria para o cliente
   escolher as fotos pelo link do projeto. */
type Shot = { id: string; text: string; done: boolean };
type Step = { id: string; time: string; text: string };
type Production = { id: string; kind: string; title: string; briefing: string | null; starts_at: string | null; ends_at: string | null; location: string | null; crew: string[]; equipment: string[];
  shot_list: Shot[]; script: string | null; schedule: Step[]; edit_stage: string; gallery_selection_enabled: boolean; created_at: string };
export const productionKindLabel: Record<string, string> = { photoshoot: "Ensaio fotográfico", photo_project: "Projeto fotográfico", event: "Evento", commercial: "Comercial", institutional_video: "Vídeo institucional", reels: "Reels", campaign: "Campanha" };
export const editStageLabel: Record<string, string> = { pre_production: "Pré-produção", shooting: "Captação", selection: "Seleção", editing: "Edição", color: "Cor/tratamento", review: "Revisão", delivered: "Entregue" };
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function ProductionsPanel({ projectId, orgId, canEdit, members }: { projectId: string; orgId: string; canEdit: boolean; members: { user_id: string; full_name?: string | null }[] }) {
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ title: "", kind: "photoshoot" });
  const q = useQuery({ queryKey: ["productions", projectId], queryFn: async () => ((await supabase.from("media_productions").select("*").eq("project_id", projectId).order("starts_at", { ascending: true, nullsFirst: false })).data ?? []) as Production[] });
  const open = q.data?.find((p) => p.id === openId);
  if (open) return <ProductionDetail p={open} orgId={orgId} projectId={projectId} canEdit={canEdit} members={members} onBack={() => setOpenId(null)} onChanged={() => q.refetch()} />;
  const create = async () => {
    if (f.title.trim().length < 2) { toast({ tone: "error", message: "Dê um nome à produção." }); return; }
    const { data, error } = await supabase.from("media_productions").insert({ organization_id: orgId, project_id: projectId, title: f.title.trim(), kind: f.kind }).select("id").single();
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    setCreating(false); await q.refetch(); setOpenId(data.id);
  };
  return (
    <Card>
      <CardHeader title="Produções" description="Ensaios, gravações e eventos do projeto, com shot list, cronograma e galeria de seleção."
        actions={canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>Nova produção</Button>} />
      {q.isLoading ? <Skeleton className="h-24" /> : !q.data?.length ? <EmptyState title="Nenhuma produção" description="Cadastre o ensaio ou a gravação para organizar a captação e liberar a seleção de fotos." /> : (
        <ul className="divide-y divide-border">
          {q.data.map((p) => {
            const done = p.shot_list.filter((s) => s.done).length;
            return (
              <li key={p.id}><button type="button" onClick={() => setOpenId(p.id)} className="flex w-full flex-wrap items-center gap-3 py-3 text-left hover:bg-surface-2">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{p.title}</p><p className="text-xs text-fg-3">{productionKindLabel[p.kind]}{p.starts_at && <> · {dateTime(p.starts_at)}</>}{p.location && <> · {p.location}</>}</p></div>
                {p.shot_list.length > 0 && <span className="text-xs text-fg-3">Shot list {done}/{p.shot_list.length}</span>}
                {p.gallery_selection_enabled && <Badge tone="info">Seleção aberta</Badge>}
                <Badge>{editStageLabel[p.edit_stage]}</Badge>
              </button></li>);
          })}
        </ul>)}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nova produção"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" onClick={create}>Criar e abrir</Button></>}>
        <div className="grid gap-4">
          <Field label="Nome" required htmlFor="pr-title"><Input id="pr-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Ensaio de produtos — coleção verão" /></Field>
          <Field label="Tipo" htmlFor="pr-kind"><Select id="pr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(productionKindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
      </Modal>
    </Card>
  );
}

function ProductionDetail({ p, orgId, projectId, canEdit, members, onBack, onChanged }: { p: Production; orgId: string; projectId: string; canEdit: boolean; members: { user_id: string; full_name?: string | null }[]; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: p.title, kind: p.kind, briefing: p.briefing ?? "", starts_at: toLocal(p.starts_at), ends_at: toLocal(p.ends_at), location: p.location ?? "", script: p.script ?? "", equipment: p.equipment.join(", ") });
  const [crew, setCrew] = useState<string[]>(p.crew);
  const [shots, setShots] = useState<Shot[]>(p.shot_list);
  const [schedule, setSchedule] = useState<Step[]>(p.schedule);
  const [newShot, setNewShot] = useState("");
  const [del, setDel] = useState(false);
  const save = async (patch: Record<string, unknown>, msg?: string) => {
    const { error } = await supabase.from("media_productions").update(patch).eq("id", p.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { if (msg) toast({ tone: "success", message: msg }); onChanged(); }
  };
  const saveInfo = () => {
    if (f.starts_at && f.ends_at && f.ends_at < f.starts_at) { toast({ tone: "error", message: "O término deve ser depois do início." }); return; }
    save({ title: f.title.trim(), kind: f.kind, briefing: f.briefing || null, starts_at: fromLocal(f.starts_at), ends_at: fromLocal(f.ends_at), location: f.location || null, script: f.script || null,
      equipment: f.equipment.split(",").map((s) => s.trim()).filter(Boolean), crew }, "Produção salva.");
  };
  const setShotsSave = (s: Shot[]) => { setShots(s); save({ shot_list: s }); };
  const setScheduleSave = (s: Step[]) => { setSchedule(s); save({ schedule: s }); };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>← Produções</Button>
        <h2 className="text-base font-semibold">{p.title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <Select aria-label="Etapa" className="w-44" value={p.edit_stage} disabled={!canEdit} onChange={(e) => save({ edit_stage: e.target.value }, "Etapa atualizada.")}>
            {Object.entries(editStageLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          {canEdit && <Button size="sm" variant="ghost" aria-label="Excluir produção" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)} />}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Planejamento" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" htmlFor="pd-title"><Input id="pd-title" value={f.title} disabled={!canEdit} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Tipo" htmlFor="pd-kind"><Select id="pd-kind" value={f.kind} disabled={!canEdit} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(productionKindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Início" htmlFor="pd-start"><Input id="pd-start" type="datetime-local" value={f.starts_at} disabled={!canEdit} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
            <Field label="Término" htmlFor="pd-end"><Input id="pd-end" type="datetime-local" value={f.ends_at} disabled={!canEdit} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></Field>
            <Field label="Local" htmlFor="pd-loc" className="sm:col-span-2"><Input id="pd-loc" value={f.location} disabled={!canEdit} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="Briefing da produção" htmlFor="pd-brief" className="sm:col-span-2"><Textarea id="pd-brief" value={f.briefing} disabled={!canEdit} onChange={(e) => setF({ ...f, briefing: e.target.value })} /></Field>
            <Field label="Equipamentos (separados por vírgula)" htmlFor="pd-eq" className="sm:col-span-2"><Input id="pd-eq" value={f.equipment} disabled={!canEdit} onChange={(e) => setF({ ...f, equipment: e.target.value })} placeholder="Câmera A, lente 35mm, 2 flashes, rebatedor" /></Field>
            <fieldset className="sm:col-span-2"><legend className="mb-1 text-xs font-medium text-fg-2">Equipe</legend>
              <div className="flex flex-wrap gap-2">{members.map((m) => {
                const on = crew.includes(m.user_id);
                return <button key={m.user_id} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => setCrew(on ? crew.filter((x) => x !== m.user_id) : [...crew, m.user_id])}
                  className={cn("rounded-full px-3 py-1 text-xs ring-1 ring-inset", on ? "bg-accent-soft text-accent ring-accent/30" : "ring-border")}>{m.full_name || "Sem nome"}</button>;
              })}</div></fieldset>
            <Field label="Roteiro" htmlFor="pd-script" className="sm:col-span-2"><Textarea id="pd-script" rows={5} value={f.script} disabled={!canEdit} onChange={(e) => setF({ ...f, script: e.target.value })} /></Field>
          </div>
          {canEdit && <Button className="mt-3" variant="primary" onClick={saveInfo}>Salvar planejamento</Button>}
        </Card>
        <div className="grid h-fit gap-4">
          <Card>
            <CardHeader title="Shot list" description={shots.length ? `${shots.filter((s) => s.done).length} de ${shots.length} capturados` : "Lista de cenas e enquadramentos."} />
            {shots.length > 0 && <Progress value={(100 * shots.filter((s) => s.done).length) / shots.length} className="mb-3" />}
            <ul className="grid gap-1.5">{shots.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={s.done} disabled={!canEdit} aria-label={s.text} onChange={() => setShotsSave(shots.map((x) => x.id === s.id ? { ...x, done: !x.done } : x))} />
                <span className={cn("flex-1", s.done && "text-fg-3 line-through")}>{s.text}</span>
                {canEdit && <Button size="sm" variant="ghost" aria-label="Remover" icon={<Trash2 className="size-3.5" />} onClick={() => setShotsSave(shots.filter((x) => x.id !== s.id))} />}
              </li>))}</ul>
            {canEdit && <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newShot.trim()) return; setShotsSave([...shots, { id: crypto.randomUUID(), text: newShot.trim(), done: false }]); setNewShot(""); }}>
              <Input aria-label="Nova cena" placeholder="Ex.: Plano aberto da fachada" value={newShot} onChange={(e) => setNewShot(e.target.value)} /><Button type="submit" size="sm" aria-label="Adicionar cena" icon={<Plus className="size-3.5" />} /></form>}
          </Card>
          <Card>
            <CardHeader title="Cronograma do dia" actions={canEdit && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setSchedule([...schedule, { id: crypto.randomUUID(), time: "", text: "" }])}>Horário</Button>} />
            {!schedule.length ? <p className="text-sm text-fg-3">Sem horários.</p> : <ul className="grid gap-2">{[...schedule].sort((a, b) => a.time.localeCompare(b.time)).map((s) => (
              <li key={s.id} className="flex gap-2">
                <Input aria-label="Horário" type="time" className="w-28" defaultValue={s.time} disabled={!canEdit} onBlur={(e) => setScheduleSave(schedule.map((x) => x.id === s.id ? { ...x, time: e.target.value } : x))} />
                <Input aria-label="Atividade" defaultValue={s.text} disabled={!canEdit} onBlur={(e) => setScheduleSave(schedule.map((x) => x.id === s.id ? { ...x, text: e.target.value } : x))} />
                {canEdit && <Button size="sm" variant="ghost" aria-label="Remover horário" icon={<Trash2 className="size-3.5" />} onClick={() => setScheduleSave(schedule.filter((x) => x.id !== s.id))} />}
              </li>))}</ul>}
          </Card>
        </div>
      </div>
      <Gallery p={p} orgId={orgId} projectId={projectId} canEdit={canEdit} onToggle={(v) => save({ gallery_selection_enabled: v }, v ? "Seleção aberta: o cliente escolhe as fotos no link do projeto." : "Seleção fechada para o cliente.")} />
      <ConfirmDialog open={del} onClose={() => setDel(false)} title="Excluir produção?" description="A galeria desta produção também será removida (os arquivos continuam na biblioteca)."
        onConfirm={async () => { const { error } = await supabase.from("media_productions").delete().eq("id", p.id); if (error) toast({ tone: "error", message: errorMessage(error) }); else { onChanged(); onBack(); } }} />
    </div>
  );
}

type Asset = { id: string; client_selected: boolean; selected_at: string | null; position: number; file_id: string; files: { name: string; storage_path: string } | null; url?: string };
function Gallery({ p, orgId, projectId, canEdit, onToggle }: { p: Production; orgId: string; projectId: string; canEdit: boolean; onToggle: (v: boolean) => void }) {
  const toast = useToast();
  const { userId } = useOrg();
  const ref = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState<{ done: number; total: number } | null>(null);
  const [onlySelected, setOnlySelected] = useState(false);
  const q = useQuery({ queryKey: ["gallery", p.id], queryFn: async () => {
    const rows = ((await supabase.from("media_assets").select("id, client_selected, selected_at, position, file_id, files(name, storage_path)").eq("production_id", p.id).order("position")).data ?? []) as unknown as Asset[];
    const urls = await signedUrls(rows.map((r) => r.files?.storage_path ?? ""));
    return rows.map((r) => ({ ...r, url: r.files ? urls[r.files.storage_path] : undefined }));
  } });
  const upload = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const start = (q.data?.length ?? 0);
    for (let i = 0; i < list.length; i++) {
      setUp({ done: i, total: list.length });
      try {
        const file = await uploadOrgFile({ orgId, userId, file: list[i], projectId, folder: `Galeria — ${p.title}`, tags: ["galeria"], clientVisible: false });
        const { error } = await supabase.from("media_assets").insert({ organization_id: orgId, production_id: p.id, file_id: file.id, position: start + i });
        if (error) throw error;
      } catch (e) { toast({ tone: "error", message: `${list[i].name}: ${errorMessage(e)}` }); }
    }
    setUp(null); if (ref.current) ref.current.value = ""; q.refetch();
  };
  const selected = (q.data ?? []).filter((a) => a.client_selected);
  const shown = onlySelected ? selected : q.data ?? [];
  const copyNames = async () => {
    const t = selected.map((a) => a.files?.name).filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(t); toast({ tone: "success", message: `${selected.length} nome(s) copiados — cole no Lightroom ou no explorador de arquivos.` }); } catch { toast({ tone: "error", message: "Não foi possível copiar." }); }
  };
  const downloadCsv = () => {
    const csv = "arquivo;selecionada_em\n" + selected.map((a) => `${a.files?.name};${a.selected_at ? new Date(a.selected_at).toLocaleString("pt-BR") : ""}`).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `selecao-${p.title}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <CardHeader title="Galeria de seleção" description={`${q.data?.length ?? 0} foto(s) · ${selected.length} escolhida(s) pelo cliente`}
        actions={<div className="flex flex-wrap gap-2">
          {selected.length > 0 && <><Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} onClick={copyNames}>Copiar nomes</Button><Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={downloadCsv}>CSV</Button></>}
          {canEdit && <><input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} aria-label="Enviar fotos" />
            <Button size="sm" icon={<Upload className="size-3.5" />} loading={!!up} onClick={() => ref.current?.click()}>Enviar fotos</Button>
            <Button size="sm" variant={p.gallery_selection_enabled ? "primary" : "ghost"} onClick={() => onToggle(!p.gallery_selection_enabled)}>{p.gallery_selection_enabled ? "Seleção aberta ao cliente" : "Abrir seleção ao cliente"}</Button></>}
        </div>} />
      {up && <div className="mb-3 grid gap-1"><p className="text-xs text-fg-3">Enviando {up.done + 1} de {up.total}…</p><Progress value={(100 * up.done) / up.total} /></div>}
      {p.gallery_selection_enabled && <p className="mb-3 text-xs text-fg-3">O cliente escolhe no link do projeto (em “O que precisamos de você”). Prefira enviar versões leves para a seleção.</p>}
      {selected.length > 0 && <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />Mostrar só as escolhidas</label>}
      {q.isLoading ? <Skeleton className="h-32" /> : !shown.length ? <p className="text-sm text-fg-3">{onlySelected ? "Nenhuma foto escolhida ainda." : "Nenhuma foto enviada."}</p> : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
          {shown.map((a) => (
            <figure key={a.id} className={cn("group relative aspect-square overflow-hidden rounded-md ring-2", a.client_selected ? "ring-accent" : "ring-transparent")}>
              {a.url ? <img src={a.url} alt={a.files?.name ?? ""} loading="lazy" className="size-full object-cover" /> : <div className="size-full bg-surface-2" />}
              {a.client_selected && <span className="absolute right-1 top-1 rounded-full bg-accent p-0.5 text-white" title="Escolhida pelo cliente"><CheckCircle2 className="size-3.5" /></span>}
              <figcaption className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 text-[10px] text-white opacity-0 group-hover:opacity-100">{a.files?.name}</figcaption>
              {canEdit && <button type="button" aria-label={`Remover ${a.files?.name} da galeria`} onClick={async () => { await supabase.from("media_assets").delete().eq("id", a.id); q.refetch(); }}
                className="absolute left-1 top-1 rounded bg-black/50 p-0.5 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"><Trash2 className="size-3.5" /></button>}
            </figure>))}
        </div>)}
    </Card>
  );
}
