// Gera o PDF de uma proposta ou versão de contrato, guarda no Storage privado
// e devolve um link temporário. Lê os dados com o JWT de quem chamou (RLS).
// POST { kind: 'proposal' | 'contract', id, version? }
import { adminClient, handler, HttpError, isUuid, json, userClient } from "../_shared/http.ts";
import { contractPdf, proposalPdf } from "../_shared/documents.ts";

Deno.serve(handler(async (req) => {
  const { kind, id, version } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!["proposal", "contract"].includes(kind as string) || !isUuid(id)) throw new HttpError(400, "invalid_input");
  const caller = userClient(req);
  const { data: me } = await caller.auth.getUser();
  if (!me.user) throw new HttpError(401, "not_authenticated");

  const doc = kind === "proposal"
    ? await proposalPdf(caller, id)
    : await contractPdf(caller, id, typeof version === "number" ? version : undefined);

  // Grava com service role só depois de a leitura com RLS ter dado certo.
  const admin = adminClient();
  const path = `${doc.organizationId}/documents/${crypto.randomUUID()}/${doc.fileName}`;
  const up = await admin.storage.from("org-files").upload(path, doc.bytes, { contentType: "application/pdf" });
  if (up.error) throw new HttpError(500, "upload_failed", up.error.message);
  const { data: file, error } = await admin.from("files").insert({
    organization_id: doc.organizationId, storage_path: path, name: doc.fileName, mime_type: "application/pdf",
    size_bytes: doc.bytes.length, folder: "Documentos", tags: [kind as string], uploaded_by: me.user.id,
  }).select("id").single();
  if (error) throw new HttpError(500, "file_record_failed", error.message);
  if (kind === "proposal") await admin.from("proposals").update({ pdf_file_id: file.id }).eq("id", id);
  else if ("versionId" in doc) await admin.from("contract_versions").update({ pdf_file_id: file.id }).eq("id", doc.versionId).is("pdf_file_id", null);
  const { data: signed } = await admin.storage.from("org-files").createSignedUrl(path, 600, { download: doc.fileName });
  return json(req, 200, { url: signed?.signedUrl, file_id: file.id, missing: "missing" in doc ? doc.missing : [] });
}));
