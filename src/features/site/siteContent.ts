/* Conteúdo editável do site público (public.site_settings.content).
   O formato espelha site/site-config.json, que é o padrão quando o banco está vazio. */
export type Project = {
  slug: string; exemplo?: boolean; titulo: string; cliente: string; ano: string; categorias: string[];
  resumo: string; desafio: string; solucao: string; capa: string; imagens: string[]; link: string;
};
export type Policy = { titulo: string; atualizadaEm: string; secoes: { titulo: string; paragrafos: string[] }[] };
export type SiteContent = {
  empresa: { nome: string; razaoSocial: string; cnpj: string; cidade: string };
  contato: { email: string };
  redes: { nome: string; url: string }[];
  textura: { intensidade: number; velocidade: number };
  frases: string[];
  portfolio: Project[];
  politicas: { privacidade: Policy; cookies: Policy };
};

export const emptyProject = (): Project => ({ slug: "", titulo: "", cliente: "", ano: String(new Date().getFullYear()), categorias: [], resumo: "", desafio: "", solucao: "", capa: "", imagens: [], link: "" });

export function slugify(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "projeto";
}
/** Endereço do projeto no site; repete com sufixo numérico quando o nome já existe. */
export function uniqueSlug(title: string, taken: string[]) {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
export const isHttpUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** Impede publicar um site que não funcionaria (o site ignora links inválidos sem avisar). */
export function siteProblems(c: SiteContent): string[] {
  const out: string[] = [];
  if (!isEmail(c.contato.email)) out.push("Geral: informe um e-mail de contato válido.");
  c.redes.forEach((r) => {
    if (r.url.trim() && !isHttpUrl(r.url)) out.push(`Redes: o endereço de ${r.nome || "um link"} precisa começar com https://.`);
    if (r.url.trim() && !r.nome.trim()) out.push("Redes: dê um nome a todos os links.");
  });
  c.portfolio.forEach((p) => { if (p.link.trim() && !isHttpUrl(p.link)) out.push(`Portfólio: o link de ${p.titulo} precisa começar com https://.`); });
  return out;
}
