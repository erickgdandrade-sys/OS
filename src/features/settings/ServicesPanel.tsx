import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Field, Input, Modal, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { useOrg } from "@/features/auth/AuthProvider";
import { categoryLabel, errorMessage, type ProjectCategory } from "@/lib/domain";
import { money } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Service = { id: string; name: string; category: ProjectCategory; description: string | null; unit: string; unit_price: number; default_revisions: number; is_recurring: boolean; is_active: boolean };
const empty = { name: "", category: "branding" as ProjectCategory, description: "", unit: "projeto", unit_price: "", default_revisions: "2", is_recurring: false, is_active: true };

/** Catálogo de serviços e precificação usado no construtor de propostas. */
export function ServicesPanel() {
  const { orgId } = useOrg();
  const toast = useToast();
  const [edit, setEdit] = useState<(typeof empty & { id?: string }) | null>(null);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["services", orgId, "all"], queryFn: async () => (await supabase.from("services").select("*").eq("organization_id", orgId).order("name")).data as Service[] });
  const save = async () => {
    if (!edit) return;
    const row = { name: edit.name.trim(), category: edit.category, description: edit.description || null, unit: edit.unit, unit_price: Number(String(edit.unit_price).replace(",", ".")) || 0,
      default_revisions: Number(edit.default_revisions) || 0, is_recurring: edit.is_recurring, is_active: edit.is_active };
    const res = edit.id ? await supabase.from("services").update(row).eq("id", edit.id) : await supabase.from("services").insert({ ...row, organization_id: orgId });
    if (res.error) return toast({ tone: "error", message: errorMessage(res.error) });
    toast({ tone: "success", message: "Serviço salvo." }); setEdit(null); refetch();
  };
  if (isLoading) return <Spinner />;
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div><p className="text-sm font-medium">Serviços e preços</p><p className="text-xs text-fg-3">Base para os itens das propostas. Inativar não afeta propostas já emitidas.</p></div>
        <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ ...empty })}>Novo serviço</Button>
      </div>
      {!data?.length ? <p className="p-6 text-center text-sm text-fg-3">Nenhum serviço cadastrado.</p> : (
        <table className="w-full text-sm"><tbody>{data.map((s) => (
          <tr key={s.id} className="border-t border-border first:border-0 hover:bg-surface-2/60">
            <td className="px-4 py-3"><button onClick={() => setEdit({ ...s, description: s.description ?? "", unit_price: String(s.unit_price), default_revisions: String(s.default_revisions) })} className="font-medium hover:text-accent">{s.name}</button>
              <p className="text-xs text-fg-3">{categoryLabel[s.category]}{s.is_recurring ? " · recorrente" : ""}</p></td>
            <td className="px-4 py-3 text-right tabular">{money(s.unit_price)} <span className="text-xs text-fg-3">/ {s.unit}</span></td>
            <td className="w-24 px-4 py-3 text-right">{!s.is_active && <Badge>Inativo</Badge>}</td>
          </tr>))}</tbody></table>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Editar serviço" : "Novo serviço"}
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={edit.name.trim().length < 2} onClick={save}>Salvar</Button></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required htmlFor="s-name" className="sm:col-span-2"><Input id="s-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Categoria" htmlFor="s-cat"><Select id="s-cat" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as ProjectCategory })}>{Object.entries(categoryLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Unidade" htmlFor="s-unit"><Select id="s-unit" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}>{["projeto", "hora", "mês", "diária", "peça", "post"].map((u) => <option key={u}>{u}</option>)}</Select></Field>
            <Field label="Preço (R$)" htmlFor="s-price"><Input id="s-price" inputMode="decimal" value={edit.unit_price} onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })} /></Field>
            <Field label="Revisões padrão" htmlFor="s-rev"><Input id="s-rev" type="number" min={0} value={edit.default_revisions} onChange={(e) => setEdit({ ...edit, default_revisions: e.target.value })} /></Field>
            <Field label="Descrição" htmlFor="s-desc" className="sm:col-span-2"><Textarea id="s-desc" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={edit.is_recurring} onChange={(e) => setEdit({ ...edit, is_recurring: e.target.checked })} />Serviço recorrente</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Ativo</label>
          </div>
        </Modal>
      )}
    </Card>
  );
}
