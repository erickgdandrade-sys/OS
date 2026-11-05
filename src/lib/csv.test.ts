import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("usa ; como separador, vírgula decimal, BOM e escapa aspas", () => {
    const csv = toCsv([{ d: 'Logo "Arara"; v2', v: 1234.5 }], [{ header: "Descrição", value: (r) => r.d }, { header: "Valor", value: (r) => r.v }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["Descrição;Valor", '"Logo ""Arara""; v2";1234,50']);
  });
});
