import { describe, expect, it } from "vitest";
import { addDaysISO, date, daysUntil, fillTemplate, formatDocument, hours, isValidDocument, money, todayISO } from "./format";
import { errorMessage } from "./domain";

describe("formatação pt-BR", () => {
  it("formata moeda em BRL", () => {
    expect(money(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(money(null).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
  it("formata datas puras sem deslocar fuso (DD/MM/AAAA)", () => {
    expect(date("2026-01-01")).toBe("01/01/2026");
    expect(date(null)).toBe("—");
  });
  it("usa o fuso de São Paulo para 'hoje'", () => {
    // 02:30 UTC de 02/03 ainda é 01/03 em São Paulo (UTC-3)
    expect(todayISO(new Date("2026-03-02T02:30:00Z"))).toBe("2026-03-01");
  });
  it("calcula dias até o prazo", () => {
    expect(daysUntil("2026-03-05", "2026-03-01")).toBe(4);
    expect(daysUntil("2026-02-27", "2026-03-01")).toBe(-2);
    expect(addDaysISO("2026-02-27", 3)).toBe("2026-03-02");
  });
  it("formata horas", () => {
    expect(hours(150)).toBe("2h30");
    expect(hours(60)).toBe("1h");
  });
});

describe("CPF/CNPJ", () => {
  it("valida dígitos verificadores", () => {
    expect(isValidDocument("529.982.247-25")).toBe(true);
    expect(isValidDocument("529.982.247-24")).toBe(false);
    expect(isValidDocument("11.222.333/0001-81")).toBe(true);
    expect(isValidDocument("11.222.333/0001-80")).toBe(false);
    expect(isValidDocument("111.111.111-11")).toBe(false);
  });
  it("formata documento", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("modelos de documento", () => {
  it("preenche variáveis, escapa HTML e aponta campos ausentes", () => {
    const r = fillTemplate("<p>{{nome_cliente}} — {{valor_total}} — {{escopo}}</p>", { nome_cliente: "Arara <Ltda>", valor_total: "R$ 10,00" });
    expect(r.html).toContain("Arara &lt;Ltda&gt;");
    expect(r.html).toContain('data-missing="escopo"');
    expect(r.missing).toEqual(["escopo"]);
  });
});

describe("mensagens de erro", () => {
  it("traduz erros conhecidos", () => {
    expect(errorMessage(new Error("Invalid login credentials"))).toBe("E-mail ou senha incorretos.");
    expect(errorMessage({ message: 'new row violates row-level security policy for table "clients"' })).toBe("Você não tem permissão para esta ação.");
  });
});
