import { describe, expect, it } from "vitest";
import defaults from "../../../site/site-config.json";
import { moveItem, siteProblems, slugify, uniqueSlug, type SiteContent } from "./siteContent";

const base = defaults as SiteContent;

describe("conteúdo do site", () => {
  it("gera endereços sem acentos", () => {
    expect(slugify("Identidade da Ação & Cia")).toBe("identidade-da-acao-cia");
    expect(slugify("!!!")).toBe("projeto");
  });
  it("não repete endereço de projeto", () => {
    expect(uniqueSlug("Marca", ["marca", "marca-2"])).toBe("marca-3");
    expect(uniqueSlug("Marca", [])).toBe("marca");
  });
  it("move itens sem sair da lista", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
  it("aceita o conteúdo padrão", () => {
    expect(siteProblems(base)).toEqual([]);
  });
  it("bloqueia e-mail e links inválidos", () => {
    const c = { ...base, contato: { email: "sem-arroba" }, redes: [{ nome: "Behance", url: "javascript:alert(1)" }] };
    expect(siteProblems(c)).toHaveLength(2);
  });
  it("aceita rede sem endereço, que fica oculta no site", () => {
    expect(siteProblems({ ...base, redes: [{ nome: "Behance", url: "" }] })).toEqual([]);
  });
});
