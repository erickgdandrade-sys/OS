import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Film, Image as ImageIcon, LayoutGrid, Link2, List, Pencil, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Progress, Segmented, Select, Skeleton, cn, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { errorMessage } from "@/lib/domain";
import { date } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { fileSize, isImage, signedUrls, uploadOrgFile } from "@/lib/upload";

/* Biblioteca de ativos do estúdio: todos os arquivos que o usuário pode ver
   (RLS), com busca, filtros, pastas, tags e pré-visualização. */
type Row = { id: string; name: string; storage_path: string; mime_type: string | null; size_bytes: number | null; kind: "file" | "link"; external_url: string | null; folder: string | null; tags: string[];
  project_id: string | null; client_id: string | null; client_visible: boolean; created_at: string; uploaded_by: string | null; client_request_id: string | null;
  projects: { name: string } | null; clients: { legal_name: string; trade_name: string | null } | null };
const typeOf = (r: Row) => r.kind === "link" ? "link" : isImage(r.mime_type, r.name) ? "image" : (r.mime_type ?? "").startsWith("video/") ? "video" : "doc";
const typeLabel = { image: "Imagens", video: "Vídeos", doc: "Documentos", link: "Links" } as const;

export function LibraryPage() {
  const { orgId, userId } = useOrg();
  const toast = useToast();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [f, setF] = useState({ q: "", type: "", project: "", folder: "", tag: "" });
  const [edit, setEdit] = useState<Row | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [uploading, setUploading] = useState(false);
  const q = useQuery({ queryKey: ["library", orgId], queryFn: async () => {
    const { data, error } = await supabase.from("files").select("id, name, storage_path, mime_type, size_bytes, kind, external_url, folder, tags, project_id, client_id, client_visible, created_at, uploaded_by, client_request_id, projects(name), clients(legal_name, trade_name)")
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1000);
    if (error) throw error;
    const rows = data as unknown as Row[];
    const urls = await signedUrls(rows.filter((r) => typeOf(r) === "image").slice(0, 200).map((r) => r.storage_path));
    return { rows, urls };
  } });
  const rows = q.data?.rows ?? [];
  const folders = useMemo(() => [...new Set(rows.map((r) => r.folder).filter(Boolean) as string[])].sort(), [rows]);
  const tags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows]);
  const projects = useMemo(() => [...new Map(rows.filter((r) => r.projects).map((r) => [r.project_id!, r.projects!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const shown = rows.filter((r) => (!f.q || `${r.name} ${r.tags.join(" ")} ${r.projects?.name ?? ""}`.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.type || typeOf(r) === f.type) && (!f.project || r.project_id === f.project) && (!f.folder || r.folder === f.folder) && (!f.tag || r.tags.includes(f.tag)));
  const open = async (r: Row, download = false) => {
    if (r.kind === "link") { window.open(r.external_url!, "_blank", "noopener"); return; }
    const { data, error } = await supabase.storage.from("org-files").createSignedUrl(r.storage_path, 300, download ? { download: r.name } : undefined);
    if (error || !data) toast({ tone: "error", message: errorMessage(error) }); else window.open(data.signedUrl, "_blank", "noopener");
  };
  return (
    <div>
      <PageHeader title="Biblioteca" description="Todos os arquivos do estúdio: dos projetos, enviados pelos clientes e gerais."
        actions={<Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setUploading(true)}>Enviar arquivos</Button>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-fg-3" /><Input aria-label="Buscar arquivos" placeholder="Buscar por nome, tag ou projeto" className="pl-8" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <Select aria-label="Tipo" className="w-36" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Todos os tipos</option>{Object.entries(typeLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Select aria-label="Projeto" className="w-48" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}><option value="">Todos os projetos</option>{projects.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          {folders.length > 0 && <Select aria-label="Pasta" className="w-44" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })}><option value="">Todas as pastas</option>{folders.map((x) => <option key={x}>{x}</option>)}</Select>}
          {tags.length > 0 && <Select aria-label="Tag" className="w-40" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}><option value="">Todas as tags</option>{tags.map((x) => <option key={x}>{x}</option>)}</Select>}
          <Segmented value={view} onChange={setView} items={[{ value: "grid", label: "Grade", icon: <LayoutGrid className="size-3.5" /> }, { value: "list", label: "Lista", icon: <List className="size-3.5" /> }]} />
        </div>
        <div className="p-3">
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-48" /> : !shown.length ? <EmptyState title={rows.length ? "Nada encontrado" : "Biblioteca vazia"} description={rows.length ? "Ajuste os filtros." : "Envie arquivos aqui ou dentro dos projetos."} /> :
            view === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {shown.map((r) => {
                  const t = typeOf(r); const url = q.data?.urls[r.storage_path];
                  return (
                    <div key={r.id} className="group overflow-hidden rounded-lg border border-border">
                      <button type="button" onClick={() => open(r)} className="flex aspect-[4/3] w-full items-center justify-center bg-surface-2" aria-label={`Abrir ${r.name}`}>
                        {t === "image" && url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" /> : t === "video" ? <Film className="size-8 text-fg-3" /> : t === "link" ? <Link2 className="size-8 text-fg-3" /> : <FileText className="size-8 text-fg-3" />}
                      </button>
                      <div className="p-2">
                        <p className="truncate text-xs font-medium" title={r.name}>{r.name}</p>
                        <p className="truncate text-[11px] text-fg-3">{r.projects?.name ?? (r.clients ? clientName(r.clients) : "Geral")} · {date(r.created_at)}</p>
                        <div className="mt-1 flex items-center gap-1">
                          {r.client_request_id && <Badge tone="info">Do cliente</Badge>}{r.client_visible && <Badge>Cliente vê</Badge>}
                          <span className="flex-1" />
                          <button type="button" aria-label={`Baixar ${r.name}`} className="rounded p-1 text-fg-3 hover:bg-surface-2" onClick={() => open(r, true)}>{r.kind === "link" ? <ExternalLink className="size-3.5" /> : <Download className="size-3.5" />}</button>
                          <button type="button" aria-label={`Editar ${r.name}`} className="rounded p-1 text-fg-3 hover:bg-surface-2" onClick={() => setEdit(r)}><Pencil className="size-3.5" /></button>
                        </div>
                      </div>
                    </div>);
                })}
              </div>) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs text-fg-3"><th className="py-2 pr-2">Nome</th><th className="pr-2">Projeto / cliente</th><th className="pr-2">Pasta</th><th className="pr-2">Tags</th><th className="pr-2 text-right">Tamanho</th><th className="pr-2">Data</th><th /></tr></thead>
                <tbody>{shown.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-2"><button type="button" className="flex items-center gap-2 hover:underline" onClick={() => open(r)}>{typeOf(r) === "image" ? <ImageIcon className="size-4 text-fg-3" /> : <FileText className="size-4 text-fg-3" />}<span className="max-w-72 truncate">{r.name}</span></button></td>
                    <td className="pr-2 text-fg-3">{r.projects?.name ?? (r.clients ? clientName(r.clients) : "Geral")}</td>
                    <td className="pr-2 text-fg-3">{r.folder ?? "—"}</td>
                    <td className="pr-2"><div className="flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                    <td className="pr-2 text-right tabular text-fg-3">{r.kind === "link" ? "Link" : fileSize(r.size_bytes)}</td>
                    <td className="pr-2 tabular text-fg-3">{date(r.created_at)}</td>
                    <td className="whitespace-nowrap text-right"><Button size="sm" variant="ghost" aria-label="Baixar" icon={<Download className="size-3.5" />} onClick={() => open(r, true)} /><Button size="sm" variant="ghost" aria-label="Editar" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(r)} /></td>
                  </tr>))}</tbody>
              </table></div>)}
          {shown.length > 0 && <p className="mt-3 text-xs text-fg-3">{shown.length} de {rows.length} arquivo(s){rows.length >= 1000 && " (mostrando os 1.000 mais recentes)"}</p>}
        </div>
      </Card>
      {edit && <EditFile r={edit} canDelete={edit.uploaded_by === userId || !!edit.project_id} onClose={() => setEdit(null)} onDelete={() => { setDel(edit); setEdit(null); }} onSaved={() => { setEdit(null); q.refetch(); }} />}
      {uploading && <UploadModal orgId={orgId} userId={userId} folders={folders} onClose={() => setUploading(false)} onDone={() => { setUploading(false); q.refetch(); }} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Excluir arquivo?" description="O arquivo é apagado do armazenamento e de onde estiver sendo usado (moodboards, galerias)."
        onConfirm={async () => {
          const r = del!; const { error } = await supabase.from("files").delete().eq("id", r.id);
          if (error) { toast({ tone: "error", message: errorMessage(error) }); return; }
          if (r.kind === "file") await supabase.storage.from("org-files").remove([r.storage_path]);
          setDel(null); q.refetch();
        }} />
    </div>
  );
}

function EditFile({ r, canDelete, onClose, onSaved, onDelete }: { r: Row; canDelete: boolean; onClose: () => void; onSaved: () => void; onDelete: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: r.name, folder: r.folder ?? "", tags: r.tags.join(", "), client_visible: r.client_visible });
  const save = async () => {
    if (!f.name.trim()) return;
    const { error } = await supabase.from("files").update({ name: f.name.trim(), folder: f.folder.trim() || null, tags: f.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean), client_visible: f.client_visible }).eq("id", r.id);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Editar arquivo"
      footer={<>{canDelete && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={onDelete}>Excluir</Button>}<span className="flex-1" /><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Salvar</Button></>}>
      <div className="grid gap-3">
        <Field label="Nome" htmlFor="ef-name"><Input id="ef-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Pasta" htmlFor="ef-folder"><Input id="ef-folder" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} placeholder="Ex.: Logos finais" /></Field>
        <Field label="Tags (separadas por vírgula)" htmlFor="ef-tags"><Input id="ef-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="logo, vetor, aprovado" /></Field>
        {r.project_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.client_visible} onChange={(e) => setF({ ...f, client_visible: e.target.checked })} />O cliente vê este arquivo no portal do projeto</label>}
      </div>
    </Modal>
  );
}

function UploadModal({ orgId, userId, folders, onClose, onDone }: { orgId: string; userId: string; folders: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [f, setF] = useState({ project_id: "", folder: "", tags: "" });
  const [prog, setProg] = useState<number | null>(null);
  const projects = useQuery({ queryKey: ["projects-select", orgId], queryFn: async () => (await supabase.from("projects").select("id, name").eq("organization_id", orgId).not("status", "eq", "cancelled").order("name")).data ?? [] });
  const send = async () => {
    if (!files.length) { toast({ tone: "error", message: "Escolha os arquivos." }); return; }
    for (let i = 0; i < files.length; i++) {
      setProg((100 * i) / files.length);
      try { await uploadOrgFile({ orgId, userId, file: files[i], projectId: f.project_id || null, folder: f.folder.trim() || null, tags: f.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) }); }
      catch (e) { toast({ tone: "error", message: `${files[i].name}: ${errorMessage(e)}` }); }
    }
    setProg(null); toast({ tone: "success", message: "Envio concluído." }); onDone();
  };
  return (
    <Modal open onClose={onClose} title="Enviar arquivos" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={prog != null} onClick={send}>Enviar {files.length > 0 && `(${files.length})`}</Button></>}>
      <div className="grid gap-3">
        <input ref={ref} type="file" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} aria-label="Escolher arquivos" />
        <button type="button" onClick={() => ref.current?.click()} className={cn("rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-fg-3 hover:bg-surface-2")}>
          {files.length ? `${files.length} arquivo(s): ${files.slice(0, 3).map((x) => x.name).join(", ")}${files.length > 3 ? "…" : ""}` : "Clique para escolher arquivos (até 500 MB cada)"}
        </button>
        <Field label="Projeto" htmlFor="up-proj" hint="Sem projeto, o arquivo fica na biblioteca geral do estúdio."><Select id="up-proj" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">Geral (sem projeto)</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Pasta" htmlFor="up-folder"><Input id="up-folder" list="up-folders" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} /><datalist id="up-folders">{folders.map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Tags (separadas por vírgula)" htmlFor="up-tags"><Input id="up-tags" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        {prog != null && <Progress value={prog} />}
      </div>
    </Modal>
  );
}
