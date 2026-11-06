import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BringToFront, Eye, EyeOff, Image as ImageIcon, Link2, Maximize2, Minus, Palette, Plus, SendToBack, StickyNote, Trash2, Type } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, Select, Skeleton, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { date } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { signedUrls, uploadOrgFile } from "@/lib/upload";

/* Moodboards em canvas infinito: imagens, textos, notas, paletas e links.
   Arrastar move, a alça redimensiona, a roda do mouse (ou os botões) dá zoom
   e arrastar o fundo navega. Cada alteração é salva no banco. */
export type ElType = "image" | "link" | "text" | "palette" | "note" | "section";
export type El = { id: string; type: ElType; x: number; y: number; width: number; height: number; rotation: number; z_index: number; data: Record<string, unknown>; file_id: string | null; url?: string | null };
type Board = { id: string; title: string; kind: string; client_visible: boolean; viewport: { x: number; y: number; zoom: number }; updated_at: string };
export const boardKindLabel: Record<string, string> = {
  moodboard: "Moodboard", visual_references: "Referências visuais", semantic_universe: "Universo semântico", art_direction: "Direção de arte",
  creative_concept: "Conceito criativo", color_palette: "Paleta de cores", typography: "Tipografia", brand_applications: "Aplicações da marca",
};

export function MoodboardsPanel({ projectId, orgId, canEdit }: { projectId: string; orgId: string; canEdit: boolean }) {
  const toast = useToast();
  const { userId } = useOrg();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ title: "", kind: "moodboard" });
  const q = useQuery({ queryKey: ["moodboards", projectId], queryFn: async () => ((await supabase.from("moodboards").select("id, title, kind, client_visible, viewport, updated_at").eq("project_id", projectId).order("created_at")).data ?? []) as Board[] });
  if (openId) { const b = q.data?.find((x) => x.id === openId); if (b) return <MoodboardEditor board={b} orgId={orgId} projectId={projectId} canEdit={canEdit} onBack={() => { setOpenId(null); q.refetch(); }} />; }
  const create = async () => {
    if (f.title.trim().length < 2) { toast({ tone: "error", message: "Dê um nome ao quadro." }); return; }
    const { data, error } = await supabase.from("moodboards").insert({ organization_id: orgId, project_id: projectId, title: f.title.trim(), kind: f.kind, created_by: userId }).select("id").single();
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    setCreating(false); setF({ title: "", kind: "moodboard" }); await q.refetch(); setOpenId(data.id);
  };
  return (
    <Card>
      <CardHeader title="Moodboards e painéis" description="Quadros visuais do projeto. Marque “visível ao cliente” para mostrar no link do projeto (somente leitura)."
        actions={canEdit && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>Novo quadro</Button>} />
      {q.isLoading ? <Skeleton className="h-24" /> : !q.data?.length ? <EmptyState title="Nenhum quadro" description="Crie um moodboard, painel semântico, paleta ou direção de arte." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((b) => (
            <button key={b.id} type="button" onClick={() => setOpenId(b.id)} className="rounded-lg border border-border p-4 text-left hover:bg-surface-2">
              <p className="text-sm font-medium">{b.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-3">{boardKindLabel[b.kind]} · {date(b.updated_at)}{b.client_visible && <Badge tone="info">Visível ao cliente</Badge>}</p>
            </button>))}
        </div>)}
      <Modal open={creating} onClose={() => setCreating(false)} title="Novo quadro"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" onClick={create}>Criar e abrir</Button></>}>
        <div className="grid gap-4">
          <Field label="Nome" required htmlFor="mb-title"><Input id="mb-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Moodboard — conceito 1" /></Field>
          <Field label="Tipo" htmlFor="mb-kind"><Select id="mb-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(boardKindLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
      </Modal>
    </Card>
  );
}

const defaults: Record<ElType, { w: number; h: number; data: Record<string, unknown> }> = {
  text: { w: 320, h: 80, data: { text: "Título", size: 28, color: "#0B2239", weight: 600 } },
  note: { w: 220, h: 160, data: { text: "Nota", color: "#FEF3C7" } },
  palette: { w: 360, h: 120, data: { colors: ["#0B2239", "#1E9BF0", "#F5F5F4", "#F59E0B"] } },
  link: { w: 300, h: 90, data: { url: "", title: "" } },
  section: { w: 600, h: 400, data: { title: "Seção", color: "#E2E8F0" } },
  image: { w: 320, h: 240, data: {} },
};

export function MoodboardCanvas({ elements, viewport, editable, selected, onSelect, onChange, onViewport }: {
  elements: El[]; viewport: { x: number; y: number; zoom: number }; editable: boolean; selected?: string | null;
  onSelect?: (id: string | null) => void; onChange?: (id: string, patch: Partial<El>, commit: boolean) => void; onViewport?: (v: { x: number; y: number; zoom: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "pan" | "move" | "resize"; id?: string; sx: number; sy: number; ox: number; oy: number; ow?: number; oh?: number } | null>(null);
  const [vp, setVp] = useState(viewport);
  useEffect(() => setVp(viewport), [viewport]);
  const down = (e: RPointerEvent, mode: "pan" | "move" | "resize", el?: El) => {
    e.stopPropagation();
    if (mode !== "pan") onSelect?.(el!.id); else onSelect?.(null);
    if (mode !== "pan" && !editable) { drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: vp.x, oy: vp.y }; }
    else drag.current = mode === "pan" ? { mode, sx: e.clientX, sy: e.clientY, ox: vp.x, oy: vp.y } : { mode, id: el!.id, sx: e.clientX, sy: e.clientY, ox: el!.x, oy: el!.y, ow: el!.width, oh: el!.height };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx), dy = (e.clientY - d.sy);
    if (d.mode === "pan") setVp((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else if (d.mode === "move") onChange?.(d.id!, { x: Math.round(d.ox + dx / vp.zoom), y: Math.round(d.oy + dy / vp.zoom) }, false);
    else onChange?.(d.id!, { width: Math.max(40, Math.round(d.ow! + dx / vp.zoom)), height: Math.max(30, Math.round(d.oh! + dy / vp.zoom)) }, false);
  };
  const up = () => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.mode === "pan") onViewport?.(vp); else onChange?.(d.id!, {}, true);
  };
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setVp((v) => {
      const z = Math.min(3, Math.max(0.2, v.zoom * factor));
      const rect = ref.current?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0), py = cy ?? (rect ? rect.height / 2 : 0);
      const nv = { zoom: z, x: px - ((px - v.x) * z) / v.zoom, y: py - ((py - v.y) * z) / v.zoom };
      onViewport?.(nv); return nv;
    });
  }, [onViewport]);
  useEffect(() => {
    const node = ref.current; if (!node) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = node.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top); };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const fit = () => {
    if (!elements.length || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const minX = Math.min(...elements.map((e) => e.x)), minY = Math.min(...elements.map((e) => e.y));
    const maxX = Math.max(...elements.map((e) => e.x + e.width)), maxY = Math.max(...elements.map((e) => e.y + e.height));
    const z = Math.min(2, Math.max(0.2, Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY))));
    const nv = { zoom: z, x: 40 - minX * z + (r.width - 80 - (maxX - minX) * z) / 2, y: 40 - minY * z + (r.height - 80 - (maxY - minY) * z) / 2 };
    setVp(nv); onViewport?.(nv);
  };
  return (
    <div ref={ref} className="relative h-full min-h-[480px] touch-none overflow-hidden rounded-lg border border-border bg-surface-2"
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: `${24 * vp.zoom}px ${24 * vp.zoom}px`, backgroundPosition: `${vp.x}px ${vp.y}px` }}
      onPointerDown={(e) => down(e, "pan")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="application" aria-label="Quadro do moodboard">
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` }}>
        {[...elements].sort((a, b) => a.z_index - b.z_index).map((el) => (
          <div key={el.id} className={cn("absolute select-none", editable && "cursor-move", selected === el.id && "outline outline-2 outline-offset-2 outline-[var(--accent)]")}
            style={{ left: el.x, top: el.y, width: el.width, height: el.height, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}
            onPointerDown={(e) => down(e, "move", el)}>
            <ElementView el={el} />
            {editable && selected === el.id && <span className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-sm border-2 border-[var(--accent)] bg-surface" onPointerDown={(e) => down(e, "resize", el)} aria-hidden />}
          </div>))}
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" aria-label="Diminuir zoom" icon={<Minus className="size-3.5" />} onClick={() => zoomAt(1 / 1.2)} />
        <span className="w-12 text-center text-xs tabular">{Math.round(vp.zoom * 100)}%</span>
        <Button size="sm" variant="ghost" aria-label="Aumentar zoom" icon={<Plus className="size-3.5" />} onClick={() => zoomAt(1.2)} />
        <Button size="sm" variant="ghost" aria-label="Enquadrar tudo" icon={<Maximize2 className="size-3.5" />} onClick={fit} />
      </div>
      {!elements.length && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-fg-3">{editable ? "Adicione imagens, textos, notas e paletas pela barra acima." : "Quadro vazio."}</p>}
    </div>
  );
}

function ElementView({ el }: { el: El }) {
  const d = el.data as Record<string, string & number & string[]>;
  switch (el.type) {
    case "image": return el.url ? <img src={el.url} alt={(d.alt as string) || ""} draggable={false} className="size-full rounded object-cover shadow-sm" /> : <div className="flex size-full items-center justify-center rounded bg-surface text-xs text-fg-3">Imagem</div>;
    case "text": return <p className="size-full overflow-hidden whitespace-pre-wrap leading-tight" style={{ fontSize: Number(d.size) || 24, color: d.color as string, fontWeight: Number(d.weight) || 500, fontFamily: (d.font as string) || undefined }}>{d.text as string}</p>;
    case "note": return <div className="size-full overflow-hidden whitespace-pre-wrap rounded p-3 text-sm text-slate-900 shadow" style={{ background: d.color as string }}>{d.text as string}</div>;
    case "palette": return (
      <div className="flex size-full overflow-hidden rounded shadow-sm">
        {(d.colors as unknown as string[] ?? []).map((c, i) => <div key={i} className="flex flex-1 items-end p-1.5" style={{ background: c }}><span className="rounded bg-white/85 px-1 font-mono text-[10px] text-slate-900">{c}</span></div>)}
      </div>);
    case "link": return (
      <a href={d.url as string} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()} className="flex size-full flex-col justify-center overflow-hidden rounded border border-border bg-surface p-3 shadow-sm">
        <span className="truncate text-sm font-medium">{(d.title as string) || (d.url as string)}</span><span className="truncate text-xs text-accent">{d.url as string}</span></a>);
    case "section": return <div className="size-full rounded-lg border-2 border-dashed p-2 text-sm font-semibold text-slate-600" style={{ borderColor: d.color as string, background: `${d.color}33` }}>{d.title as string}</div>;
  }
}

function MoodboardEditor({ board, orgId, projectId, canEdit, onBack }: { board: Board; orgId: string; projectId: string; canEdit: boolean; onBack: () => void }) {
  const toast = useToast();
  const { userId } = useOrg();
  const [els, setEls] = useState<El[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [visible, setVisible] = useState(board.client_visible);
  const [loading, setLoading] = useState(true);
  const [del, setDel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("moodboard_elements").select("id, type, x, y, width, height, rotation, z_index, data, file_id, files(storage_path)").eq("moodboard_id", board.id).order("z_index");
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    const rows = (data ?? []) as unknown as (El & { files: { storage_path: string } | null })[];
    const urls = await signedUrls(rows.map((r) => r.files?.storage_path ?? ""));
    setEls(rows.map(({ files, ...r }) => ({ ...r, url: files ? urls[files.storage_path] : null }))); setLoading(false);
  }, [board.id, toast]);
  useEffect(() => { load(); }, [load]);
  const saveVp = useRef<number | undefined>(undefined);
  const onViewport = useCallback((v: { x: number; y: number; zoom: number }) => {
    if (!canEdit) return;
    window.clearTimeout(saveVp.current);
    saveVp.current = window.setTimeout(() => { supabase.from("moodboards").update({ viewport: v }).eq("id", board.id).then(); }, 600);
  }, [board.id, canEdit]);
  const persist = async (id: string, patch: Partial<El>) => {
    const { url: _u, id: _i, ...p } = patch as El;
    const { error } = await supabase.from("moodboard_elements").update(p).eq("id", id);
    if (error) toast({ tone: "error", message: errorMessage(error) });
  };
  const onChange = (id: string, patch: Partial<El>, commit: boolean) => {
    setEls((xs) => xs.map((e) => e.id === id ? { ...e, ...patch } : e));
    if (commit) { const el = els.find((e) => e.id === id); if (el) persist(id, { x: el.x, y: el.y, width: el.width, height: el.height }); }
  };
  const nextZ = () => (els.length ? Math.max(...els.map((e) => e.z_index)) + 1 : 1);
  const add = async (type: ElType, extra?: Partial<El>) => {
    const d = defaults[type];
    const v = board.viewport;
    const row = { organization_id: orgId, moodboard_id: board.id, type, x: Math.round((-v.x + 120) / v.zoom + els.length * 16), y: Math.round((-v.y + 120) / v.zoom + els.length * 16),
      width: d.w, height: d.h, z_index: type === "section" ? 0 : nextZ(), data: d.data, ...extra };
    const { url, ...ins } = row as El & typeof row;
    const { data, error } = await supabase.from("moodboard_elements").insert(ins).select("id, type, x, y, width, height, rotation, z_index, data, file_id").single();
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
    setEls((xs) => [...xs, { ...(data as El), url: url ?? null }]); setSel(data.id);
  };
  const addImages = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (!f.type.startsWith("image/")) { toast({ tone: "error", message: `${f.name}: envie uma imagem.` }); continue; }
      try {
        const up = await uploadOrgFile({ orgId, userId, file: f, projectId, folder: "Moodboards", tags: ["moodboard"] });
        const dims = await new Promise<{ w: number; h: number }>((res) => { const img = new window.Image(); img.onload = () => res({ w: img.width, h: img.height }); img.onerror = () => res({ w: 4, h: 3 }); img.src = URL.createObjectURL(f); });
        const w = 320, h = Math.round((320 * dims.h) / Math.max(1, dims.w));
        const urls = await signedUrls([up.storage_path]);
        await add("image", { file_id: up.id, width: w, height: Math.max(40, h), data: { alt: f.name }, url: urls[up.storage_path] });
      } catch (e) { toast({ tone: "error", message: errorMessage(e) }); }
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const selected = els.find((e) => e.id === sel) ?? null;
  const setData = (patch: Record<string, unknown>) => { if (!selected) return; const data = { ...selected.data, ...patch }; setEls((xs) => xs.map((e) => e.id === selected.id ? { ...e, data } : e)); };
  const commitData = () => { if (selected) persist(selected.id, { data: selected.data }); };
  const remove = async () => {
    if (!selected) return;
    const { error } = await supabase.from("moodboard_elements").delete().eq("id", selected.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { setEls((xs) => xs.filter((e) => e.id !== selected.id)); setSel(null); }
  };
  const reorder = (front: boolean) => { if (!selected) return; const z = front ? nextZ() : Math.min(...els.map((e) => e.z_index)) - 1; onChange(selected.id, { z_index: z }, false); persist(selected.id, { z_index: z }); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.key === "Delete" || e.key === "Backspace") && sel && canEdit && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); remove(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>Quadros</Button>
        <h2 className="text-base font-semibold">{board.title}</h2><Badge>{boardKindLabel[board.kind]}</Badge>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {canEdit && <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addImages(e.target.files)} aria-label="Enviar imagens" />
            <Button size="sm" icon={<ImageIcon className="size-3.5" />} onClick={() => fileRef.current?.click()}>Imagem</Button>
            <Button size="sm" icon={<Type className="size-3.5" />} onClick={() => add("text")}>Texto</Button>
            <Button size="sm" icon={<StickyNote className="size-3.5" />} onClick={() => add("note")}>Nota</Button>
            <Button size="sm" icon={<Palette className="size-3.5" />} onClick={() => add("palette")}>Paleta</Button>
            <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => add("link")}>Link</Button>
            <Button size="sm" onClick={() => add("section")}>Seção</Button>
            <Button size="sm" variant={visible ? "primary" : "ghost"} icon={visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} onClick={async () => {
              const { error } = await supabase.from("moodboards").update({ client_visible: !visible }).eq("id", board.id);
              if (error) toast({ tone: "error", message: errorMessage(error) }); else { setVisible(!visible); toast({ tone: "success", message: !visible ? "O cliente vê este quadro no link do projeto." : "Quadro oculto do cliente." }); }
            }}>{visible ? "Visível ao cliente" : "Oculto do cliente"}</Button>
            <Button size="sm" variant="ghost" aria-label="Excluir quadro" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)} />
          </>}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
        <div className="h-[70vh]">{loading ? <Skeleton className="h-full" /> : <MoodboardCanvas elements={els} viewport={board.viewport} editable={canEdit} selected={sel} onSelect={setSel} onChange={onChange} onViewport={onViewport} />}</div>
        <Card className="h-fit">
          {!selected ? <p className="text-sm text-fg-3">Selecione um elemento para editar. Arraste para mover, use a alça do canto para redimensionar e Delete para remover.</p> : (
            <div className="grid gap-3">
              <p className="text-sm font-medium">{{ image: "Imagem", text: "Texto", note: "Nota", palette: "Paleta", link: "Link", section: "Seção" }[selected.type]}</p>
              {(selected.type === "text" || selected.type === "note") && <Field label="Texto" htmlFor="el-text"><textarea id="el-text" className="min-h-24 w-full rounded-md border border-border bg-surface p-2 text-sm" value={(selected.data.text as string) ?? ""} onChange={(e) => setData({ text: e.target.value })} onBlur={commitData} disabled={!canEdit} /></Field>}
              {selected.type === "text" && <div className="grid grid-cols-2 gap-2">
                <Field label="Tamanho" htmlFor="el-size"><Input id="el-size" type="number" min={8} max={200} value={Number(selected.data.size) || 24} onChange={(e) => setData({ size: Number(e.target.value) })} onBlur={commitData} disabled={!canEdit} /></Field>
                <Field label="Cor" htmlFor="el-color"><Input id="el-color" type="color" value={(selected.data.color as string) ?? "#000000"} onChange={(e) => setData({ color: e.target.value })} onBlur={commitData} disabled={!canEdit} /></Field>
                <Field label="Fonte" htmlFor="el-font" className="col-span-2"><Input id="el-font" placeholder="Ex.: Georgia" value={(selected.data.font as string) ?? ""} onChange={(e) => setData({ font: e.target.value })} onBlur={commitData} disabled={!canEdit} /></Field>
              </div>}
              {(selected.type === "note" || selected.type === "section") && <Field label="Cor" htmlFor="el-bg"><Input id="el-bg" type="color" value={(selected.data.color as string) ?? "#FEF3C7"} onChange={(e) => setData({ color: e.target.value })} onBlur={commitData} disabled={!canEdit} /></Field>}
              {selected.type === "section" && <Field label="Título" htmlFor="el-st"><Input id="el-st" value={(selected.data.title as string) ?? ""} onChange={(e) => setData({ title: e.target.value })} onBlur={commitData} disabled={!canEdit} /></Field>}
              {selected.type === "palette" && <div className="grid gap-2">
                {((selected.data.colors as string[]) ?? []).map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="color" aria-label={`Cor ${i + 1}`} value={c} disabled={!canEdit} onChange={(e) => { const cs = [...(selected.data.colors as string[])]; cs[i] = e.target.value; setData({ colors: cs }); }} onBlur={commitData} className="h-8 w-10" />
                    <Input aria-label={`Hex da cor ${i + 1}`} value={c} disabled={!canEdit} onChange={(e) => { const cs = [...(selected.data.colors as string[])]; cs[i] = e.target.value; setData({ colors: cs }); }} onBlur={commitData} className="font-mono text-xs" />
                    {canEdit && <Button size="sm" variant="ghost" aria-label="Remover cor" icon={<Trash2 className="size-3.5" />} onClick={() => { const cs = (selected.data.colors as string[]).filter((_, j) => j !== i); persist(selected.id, { data: { ...selected.data, colors: cs } }); setData({ colors: cs }); }} />}
                  </div>))}
                {canEdit && <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => { const cs = [...((selected.data.colors as string[]) ?? []), "#94A3B8"]; setData({ colors: cs }); persist(selected.id, { data: { ...selected.data, colors: cs } }); }}>Cor</Button>}
              </div>}
              {selected.type === "link" && <>
                <Field label="Endereço" htmlFor="el-url"><Input id="el-url" type="url" placeholder="https://" value={(selected.data.url as string) ?? ""} onChange={(e) => setData({ url: e.target.value })} onBlur={() => { if (selected.data.url && !/^https?:\/\//.test(String(selected.data.url))) toast({ tone: "error", message: "Use um link começando com http(s)://" }); else commitData(); }} disabled={!canEdit} /></Field>
                <Field label="Título" htmlFor="el-lt"><Input id="el-lt" value={(selected.data.title as string) ?? ""} onChange={(e) => setData({ title: e.target.value })} onBlur={commitData} disabled={!canEdit} /></Field>
              </>}
              {canEdit && <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                <Button size="sm" variant="ghost" icon={<BringToFront className="size-3.5" />} onClick={() => reorder(true)}>Frente</Button>
                <Button size="sm" variant="ghost" icon={<SendToBack className="size-3.5" />} onClick={() => reorder(false)}>Trás</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={remove}>Remover</Button>
              </div>}
            </div>)}
        </Card>
      </div>
      <ConfirmDialog open={del} onClose={() => setDel(false)} title="Excluir quadro?" description="Os elementos do quadro serão apagados. As imagens continuam na biblioteca de arquivos."
        onConfirm={async () => { const { error } = await supabase.from("moodboards").delete().eq("id", board.id); if (error) toast({ tone: "error", message: errorMessage(error) }); else onBack(); }} />
    </div>
  );
}
