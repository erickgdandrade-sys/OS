import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./ContractsPages";

describe("sanitizeHtml (cláusulas de contrato)", () => {
  it("remove scripts, eventos e links, mantendo a formatação", () => {
    const out = sanitizeHtml('<h2 onclick="x()">1. Objeto</h2><p>Texto <strong>forte</strong></p><script>alert(1)</script><a href="javascript:x">link</a><img src=x onerror=alert(1)>');
    expect(out).toContain("<h2>1. Objeto</h2>");
    expect(out).toContain("<strong>forte</strong>");
    expect(out).not.toMatch(/script|onclick|onerror|<a|<img|javascript/i);
    expect(out).toContain("link");
  });
  it("preserva a marcação de variáveis pendentes", () => {
    expect(sanitizeHtml('<mark data-missing="escopo" style="color:red">{{escopo}}</mark>')).toBe('<mark data-missing="escopo">{{escopo}}</mark>');
  });
});
