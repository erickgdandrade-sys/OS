import { cn } from "@/components/ui";

/* Assinatura tipográfica ANDRA&GO (manual de marca, estudo inicial):
   ANDRA e GO na grotesca em peso alto; o & é o único elemento com outra
   voz — serifada itálica, em azul. Não é um logotipo desenhado: é o nome
   composto com as fontes da identidade. */
export function Wordmark({ className, os = true, tone = "dark" }: { className?: string; os?: boolean; tone?: "dark" | "light" }) {
  return (
    <span className={cn("inline-flex items-baseline font-extrabold tracking-[-0.04em] leading-none", tone === "dark" ? "text-white" : "text-fg", className)} aria-label={os ? "ANDRA&GO OS" : "ANDRA&GO"}>
      <span aria-hidden>ANDRA</span>
      <span aria-hidden className={cn("voice mx-[0.02em] text-[1.12em] leading-none", tone === "dark" ? "text-amp" : "text-accent")}>&amp;</span>
      <span aria-hidden>GO</span>
      {os && <span aria-hidden className={cn("ml-[0.35em] font-medium tracking-[-0.01em]", tone === "dark" ? "text-white/45" : "text-fg-3")}>OS</span>}
    </span>
  );
}
