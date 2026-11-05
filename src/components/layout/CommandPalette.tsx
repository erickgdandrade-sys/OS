import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, CornerDownLeft, FolderKanban, ListChecks, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";

type Hit = { kind: "client" | "project" | "task"; id: string; title: string; subtitle?: string; to: string };

/** Busca global. Consulta o banco com RLS: cada pessoa só encontra o que pode ver. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const { orgId, can } = useAuth();
  const term = q.trim();

  useEffect(() => { if (open) { setQ(""); setIdx(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["search", orgId, term],
    enabled: open && term.length >= 2 && !!orgId,
    staleTime: 10_000,
    queryFn: async (): Promise<Hit[]> => {
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const [c, p, t] = await Promise.all([
        can("clients.read")
          ? supabase.from("clients").select("id, legal_name, trade_name").eq("organization_id", orgId!).or(`legal_name.ilike.${like},trade_name.ilike.${like}`).limit(5)
          : Promise.resolve({ data: [] as { id: string; legal_name: string; trade_name: string | null }[] }),
        supabase.from("projects").select("id, name, clients(legal_name)").eq("organization_id", orgId!).ilike("name", like).limit(6),
        supabase.from("tasks").select("id, title, project_id, projects(name)").eq("organization_id", orgId!).ilike("title", like).limit(6),
      ]);
      return [
        ...(c.data ?? []).map((x) => ({ kind: "client" as const, id: x.id, title: x.trade_name || x.legal_name, subtitle: "Cliente", to: `/clientes/${x.id}` })),
        ...((p.data ?? []) as unknown as { id: string; name: string; clients: { legal_name: string } | null }[]).map((x) => ({ kind: "project" as const, id: x.id, title: x.name, subtitle: x.clients?.legal_name, to: `/projetos/${x.id}` })),
        ...((t.data ?? []) as unknown as { id: string; title: string; project_id: string; projects: { name: string } | null }[]).map((x) => ({ kind: "task" as const, id: x.id, title: x.title, subtitle: x.projects?.name, to: `/projetos/${x.project_id}` })),
      ];
    },
  });

  const actions = useMemo<Hit[]>(() => [
    { kind: "project", id: "new-project", title: "Ir para projetos", to: "/projetos" },
    ...(can("clients.read") ? [{ kind: "client" as const, id: "new-client", title: "Ir para clientes", to: "/clientes" }] : []),
    { kind: "task", id: "my-tasks", title: "Minhas tarefas", to: "/tarefas" },
  ], [can]);
  const list = term.length >= 2 ? hits : actions;

  if (!open) return null;
  const go = (h: Hit) => { onClose(); nav({ to: h.to }); };
  const Icon = { client: Building2, project: FolderKanban, task: ListChecks };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-[2px] animate-in" onClick={onClose} />
      <div role="dialog" aria-label="Busca global" className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-lg animate-pop">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-fg-3" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} placeholder="Buscar clientes, projetos e tarefas…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, list.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && list[idx]) go(list[idx]);
            }} />
          <kbd className="rounded border border-border px-1.5 font-mono text-[10px] text-fg-3">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {term.length >= 2 && !isFetching && list.length === 0 && <li className="px-3 py-8 text-center text-sm text-fg-3">Nada encontrado para “{term}”.</li>}
          {term.length < 2 && <li className="px-3 pt-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-3">Atalhos</li>}
          {list.map((h, i) => {
            const I = Icon[h.kind];
            return (
              <li key={h.kind + h.id} role="option" aria-selected={i === idx}>
                <button onMouseEnter={() => setIdx(i)} onClick={() => go(h)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", i === idx && "bg-surface-2")}>
                  <I className="size-4 shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  {h.subtitle && <span className="truncate text-xs text-fg-3">{h.subtitle}</span>}
                  {i === idx && <CornerDownLeft className="size-3.5 text-fg-3" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>, document.body);
}
