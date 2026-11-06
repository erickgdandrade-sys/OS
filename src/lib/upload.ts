import { supabase } from "@/lib/supabase";

/* Envio de arquivos para o bucket privado `org-files` + registro em public.files.
   O caminho começa sempre pelo id da organização (exigido pela política do Storage). */
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export type UploadedFile = { id: string; name: string; storage_path: string; mime_type: string | null; size_bytes: number | null };

export async function uploadOrgFile(opts: { orgId: string; userId: string; file: File; projectId?: string | null; clientId?: string | null; folder?: string | null; tags?: string[]; clientVisible?: boolean }): Promise<UploadedFile> {
  const { orgId, userId, file } = opts;
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: limite de 500 MB.`);
  const path = `${orgId}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\- ]+/g, "_")}`;
  const up = await supabase.storage.from("org-files").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await supabase.from("files").insert({
    organization_id: orgId, project_id: opts.projectId ?? null, client_id: opts.clientId ?? null, storage_path: path, name: file.name,
    mime_type: file.type || null, size_bytes: file.size, uploaded_by: userId, folder: opts.folder ?? null, tags: opts.tags ?? [], client_visible: opts.clientVisible ?? false,
  }).select("id, name, storage_path, mime_type, size_bytes").single();
  if (error) { await supabase.storage.from("org-files").remove([path]); throw error; }
  return data as UploadedFile;
}

/** URLs assinadas em lote (expiram; nunca públicas). */
export async function signedUrls(paths: string[], seconds = 3600): Promise<Record<string, string>> {
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.storage.from("org-files").createSignedUrls(uniq, seconds);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
}

export const isImage = (mime?: string | null, name?: string) => (mime ?? "").startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(name ?? "");
export const fileSize = (n?: number | null) => n == null ? "—" : n > 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
