import { cn } from "@/components/ui";
import { logoArt } from "./logoArt";

/* Logotipo ANDRA&GO desenhado a partir dos arquivos oficiais (vetores).
   As letras usam a cor do texto (currentColor); o & tem cor própria:
   azul claro sobre fundo escuro, Azul Intenção sobre fundo claro. */
type Variant = "horizontal" | "stacked" | "stackedDescriptor";
export function Logo({ variant = "horizontal", className, tone = "dark", title = "ANDRA&GO", height }: { variant?: Variant; className?: string; tone?: "dark" | "light" | "mono"; title?: string; height?: string }) {
  const art = logoArt[variant];
  const amp = tone === "dark" ? "var(--amp)" : tone === "light" ? "var(--blue)" : "currentColor";
  return (
    <svg viewBox={art.vb} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title || undefined} className={cn("block", !height && "h-auto", tone === "dark" ? "text-white" : "text-fg", className)} style={height ? { height, width: "auto" } : undefined} fill="currentColor">
      {art.ink.map((d, i) => <path key={i} d={d} />)}
      {art.amp.map((d, i) => <path key={`a${i}`} d={d} fill={amp} />)}
      {"desc" in art && art.desc.map((d, i) => <path key={`d${i}`} d={d} />)}
    </svg>
  );
}

/* Assinatura do sistema: logotipo horizontal + “OS”. */
export function Wordmark({ className, os = true, tone = "dark" }: { className?: string; os?: boolean; tone?: "dark" | "light" }) {
  return (
    <span className={cn("inline-flex items-center gap-[0.4em] leading-none", className)} aria-label={os ? "ANDRA&GO OS" : "ANDRA&GO"} role="img">
      <Logo variant="horizontal" tone={tone} height="0.8em" title="" />
      {os && <span aria-hidden className={cn("text-[0.82em] font-medium tracking-[-0.01em]", tone === "dark" ? "text-white/45" : "text-fg-3")}>OS</span>}
    </span>
  );
}
