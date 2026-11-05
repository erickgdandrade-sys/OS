import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { fillVars, htmlToBlocks, pdfSafe, renderDocument } from "./pdf";

describe("gerador de PDF", () => {
  it("gera PDF válido com acentos, tabela, totais e paginação", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => [`Item ${i + 1} — produção de peça gráfica com descrição longa o bastante para quebrar linha`, "1", "R$ 1.000,00", "R$ 1.000,00"]);
    const bytes = await renderDocument({
      studio: "Fervo Estúdio", studioContact: "ola@fervo.studio · (81) 98888-0016", docLabel: "Proposta comercial", docNumber: "Nº 0014", accent: "#0EA5E9",
      blocks: [{ type: "h1", text: "Identidade visual — Arara Torrefação" }, { type: "h2", text: "Escopo" }, { type: "p", text: "Criação de símbolo, logotipo, paleta e manual. Ação, coração, informação." },
        { type: "table", columns: ["Item", "Qtd.", "Unitário", "Total"], widths: [6, 1, 2, 2], align: ["left", "right", "right", "right"], rows },
        { type: "totals", rows: [["Subtotal", "R$ 60.000,00"], ["Total", "R$ 54.000,00"]] }],
      footer: "Válida até 20/11/2026",
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("remove caracteres não suportados pela fonte padrão", () => {
    expect(pdfSafe("Início → fim “ok” ✓")).toBe('Início -> fim "ok" ');
  });

  it("converte o HTML do contrato em blocos", () => {
    const b = htmlToBlocks("<h1>Contrato</h1><h2>1. Objeto</h2><p>Texto <strong>forte</strong> &amp; claro</p><ul><li>Item</li></ul>");
    expect(b).toEqual([{ type: "h1", text: "Contrato" }, { type: "h2", text: "1. Objeto" }, { type: "p", text: "Texto forte & claro" }, { type: "p", text: "• Item" }]);
  });

  it("preenche variáveis e marca as ausentes", () => {
    expect(fillVars("{{nome_cliente}} / {{escopo}}", { nome_cliente: "Lume <Ótica>" })).toBe("Lume &lt;Ótica&gt; / [escopo]");
  });
});
