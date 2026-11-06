import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { clientName } from "@/features/clients/ClientsPages";
import { categoryLabel, projectStatusLabel, projectStatusTone, type ProjectCategory, type ProjectStatus } from "@/lib/domain";
import { date } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/* Atalho para os projetos de marca: naming, pesquisa competitiva e moodboards. */
type Row = { id: string; name: string; category: ProjectCategory; status: ProjectStatus; due_date: string | null; clients: { legal_name: string; trade_name: string | null } | null;
  naming_candidates: { count: number }[]; moodboards: { count: number }[]; brand_competitors: { count: number }[] };

export function BrandingHubPage() {
  const { orgId } = useOrg();
  const q = useQuery({ queryKey: ["branding-hub", orgId], queryFn: async () => {
    const { data, error } = await supabase.from("projects").select("id, name, category, status, due_date, clients(legal_name, trade_name), naming_candidates(count), moodboards(count), brand_competitors(count)")
      .eq("organization_id", orgId).in("category", ["branding", "naming", "art_direction"]).not("status", "eq", "cancelled").order("created_at", { ascending: false });
    if (error) throw error; return data as unknown as Row[];
  } });
  return (
    <div>
      <PageHeader title="Branding e naming" description="Projetos de marca com naming, pesquisa competitiva e moodboards." />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? (
        <EmptyState title="Nenhum projeto de marca" description="Crie um projeto com a categoria Branding ou Naming para usar estas ferramentas." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2"><Link to="/projetos/$projectId" params={{ projectId: p.id }} className="text-sm font-medium hover:underline">{p.name}</Link><Badge tone={projectStatusTone[p.status]} dot>{projectStatusLabel[p.status]}</Badge></div>
              <p className="mt-0.5 text-xs text-fg-3">{clientName(p.clients)} · {categoryLabel[p.category]}{p.due_date && <> · prazo {date(p.due_date)}</>}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Link to="/projetos/$projectId" params={{ projectId: p.id }} search={{ aba: "naming" }} className="rounded-full bg-surface-2 px-2.5 py-1 hover:bg-accent-soft">Naming · {p.naming_candidates[0]?.count ?? 0} nomes</Link>
                <Link to="/projetos/$projectId" params={{ projectId: p.id }} search={{ aba: "naming" }} className="rounded-full bg-surface-2 px-2.5 py-1 hover:bg-accent-soft">Concorrentes · {p.brand_competitors[0]?.count ?? 0}</Link>
                <Link to="/projetos/$projectId" params={{ projectId: p.id }} search={{ aba: "moodboards" }} className="rounded-full bg-surface-2 px-2.5 py-1 hover:bg-accent-soft">Moodboards · {p.moodboards[0]?.count ?? 0}</Link>
              </div>
            </Card>))}
        </div>)}
    </div>
  );
}
