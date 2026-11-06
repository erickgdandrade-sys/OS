import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Card, CardHeader, Field, Input, PageHeader, Segmented, Skeleton, cn, useToast } from "@/components/ui";
import { avatarPresets, PresetAvatar } from "@/components/ui/avatarPresets";
import { useAuth } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/domain";
import { supabase } from "@/lib/supabase";

/* Meu perfil: nome, telefone, foto (enviada ou avatar pronto), tema e senha.
   A foto é recortada em quadrado e reduzida no navegador antes do envio. */
type Me = { id: string; full_name: string; phone: string | null; avatar_path: string | null; theme: "light" | "dark" | "system"; updated_at: string };

async function squareJpeg(file: File, size = 512): Promise<Blob> {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Não foi possível processar a imagem."))), "image/jpeg", 0.88));
}

export function ProfilePage() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ["profile", uid], enabled: !!uid, queryFn: async () => {
    const { data, error } = await supabase.from("profiles").select("id, full_name, phone, avatar_path, theme, updated_at").eq("id", uid!).single();
    if (error) throw error; return data as Me;
  } });
  const [f, setF] = useState({ full_name: "", phone: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [pw, setPw] = useState({ a: "", b: "" });
  useEffect(() => { if (q.data) setF({ full_name: q.data.full_name, phone: q.data.phone ?? "" }); }, [q.data]);
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["project-members"] }); };
  const save = async (patch: Partial<Me>, ok: string) => {
    const { error } = await supabase.from("profiles").update(patch).eq("id", uid!);
    if (error) { toast({ tone: "error", message: errorMessage(error) }); return false; }
    toast({ tone: "success", message: ok }); refresh(); return true;
  };
  const oldUpload = () => (q.data?.avatar_path && !q.data.avatar_path.startsWith("preset:") ? q.data.avatar_path : null);

  const upload = async (file: File | undefined) => {
    if (!file || !uid) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) { toast({ tone: "error", message: "Envie uma imagem (JPG, PNG ou WebP)." }); return; }
    if (file.size > 15 * 1024 * 1024) { toast({ tone: "error", message: "Imagem muito grande (máx. 15 MB antes do ajuste)." }); return; }
    setBusy("upload");
    try {
      const blob = await squareJpeg(file);
      const path = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw up.error;
      const prev = oldUpload();
      if (await save({ avatar_path: path }, "Foto atualizada.")) { if (prev) await supabase.storage.from("avatars").remove([prev]); }
      else await supabase.storage.from("avatars").remove([path]);
    } catch (e) { toast({ tone: "error", message: errorMessage(e) }); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  };
  const pickPreset = async (id: string) => { setBusy(id); const prev = oldUpload(); if (await save({ avatar_path: `preset:${id}` }, "Avatar escolhido.") && prev) await supabase.storage.from("avatars").remove([prev]); setBusy(null); };
  const clearAvatar = async () => { setBusy("clear"); const prev = oldUpload(); if (await save({ avatar_path: null }, "Foto removida.") && prev) await supabase.storage.from("avatars").remove([prev]); setBusy(null); };
  const changePassword = async () => {
    if (pw.a.length < 8) { toast({ tone: "error", message: "A senha precisa ter pelo menos 8 caracteres." }); return; }
    if (pw.a !== pw.b) { toast({ tone: "error", message: "As senhas não conferem." }); return; }
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setBusy(null);
    if (error) toast({ tone: "error", message: errorMessage(error) }); else { setPw({ a: "", b: "" }); toast({ tone: "success", message: "Senha alterada." }); }
  };
  const setTheme = async (t: Me["theme"]) => {
    try { localStorage.setItem("nexo-theme", t); } catch { /* sem storage */ }
    const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    await save({ theme: t }, "Tema salvo.");
  };

  if (q.isLoading || !q.data) return <Skeleton className="h-64" />;
  const me = q.data;
  const current = me.avatar_path;
  return (
    <div>
      <PageHeader title="Meu perfil" description="Como você aparece para a equipe nas tarefas, comentários e no menu." />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <div className="grid justify-items-center gap-3 text-center">
            <Avatar name={me.full_name || session?.user.email} path={current} version={me.updated_at} size={128} />
            <div><p className="text-base font-semibold">{me.full_name || "Sem nome"}</p><p className="text-sm text-fg-3">{session?.user.email}</p></div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} aria-label="Escolher foto" />
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={<Camera className="size-4" />} loading={busy === "upload"} onClick={() => fileRef.current?.click()}>Enviar foto</Button>
              {current && <Button variant="ghost" icon={<Trash2 className="size-4" />} loading={busy === "clear"} onClick={clearAvatar}>Remover</Button>}
            </div>
            <p className="text-xs text-fg-3">A foto é recortada em quadrado e reduzida automaticamente.</p>
          </div>
        </Card>
        <div className="grid gap-4">
          <Card>
            <CardHeader title="Avatares prontos" description="Rostos dos assistentes e peças da marca ANDRA&GO." />
            <div className="flex flex-wrap gap-3">
              {avatarPresets.map((p) => {
                const on = current === `preset:${p.id}`;
                return (
                  <button key={p.id} type="button" onClick={() => pickPreset(p.id)} aria-pressed={on} aria-label={p.label} title={p.label} disabled={!!busy}
                    className={cn("relative rounded-full ring-2 ring-offset-2 ring-offset-surface transition", on ? "ring-accent" : "ring-transparent hover:ring-border-strong")}>
                    <PresetAvatar id={p.id} size={72} />
                    {on && <span className="absolute -right-1 -top-1 rounded-full bg-accent p-0.5 text-white"><Check className="size-3.5" /></span>}
                  </button>);
              })}
            </div>
          </Card>
          <Card>
            <CardHeader title="Dados" />
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (f.full_name.trim().length < 2) { toast({ tone: "error", message: "Informe seu nome." }); return; } save({ full_name: f.full_name.trim(), phone: f.phone.trim() || null }, "Perfil salvo."); }}>
              <Field label="Nome" required htmlFor="pf-name"><Input id="pf-name" value={f.full_name} maxLength={120} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoComplete="name" /></Field>
              <Field label="Telefone / WhatsApp" htmlFor="pf-phone"><Input id="pf-phone" value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="(81) 99999-0000" autoComplete="tel" /></Field>
              <Field label="E-mail" htmlFor="pf-email" hint="Para trocar o e-mail, fale com o administrador." className="sm:col-span-2"><Input id="pf-email" value={session?.user.email ?? ""} disabled /></Field>
              <div className="sm:col-span-2"><Button type="submit" variant="primary">Salvar</Button></div>
            </form>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Tema" />
              <Segmented value={me.theme} onChange={setTheme} items={[{ value: "light", label: "Claro" }, { value: "dark", label: "Escuro" }, { value: "system", label: "Do sistema" }]} />
            </Card>
            <Card>
              <CardHeader title="Trocar senha" />
              <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); changePassword(); }}>
                <Field label="Nova senha" htmlFor="pf-pw"><Input id="pf-pw" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></Field>
                <Field label="Repita a nova senha" htmlFor="pf-pw2"><Input id="pf-pw2" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
                <div><Button type="submit" loading={busy === "pw"}>Alterar senha</Button></div>
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
