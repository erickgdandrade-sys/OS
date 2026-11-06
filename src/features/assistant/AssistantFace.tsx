import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

/* Rostos dos assistentes, feitos só com caracteres do teclado.
   Andrade (tarefas) é quadrado e metódico: [o_o]. Gomes (plataforma) é solto: :v
   Ocioso: pisca e olha em volta de vez em quando. Trabalhando: lê, pensa, fala. */
export type Who = "andrade" | "gomes";
export type FaceState = "idle" | "working" | "done";

const frames: Record<Who, Record<FaceState, { f: string[]; ms: number }>> = {
  andrade: {
    idle: { f: ["[o_o]", "[o_o]", "[o_o]", "[o_o]", "[-_-]", "[o_o]", "[o_o]", "[o_o]", "[o_o]", "[o_o]", "[°_o]", "[o_°]", "[o_o]"], ms: 380 },
    working: { f: ["[o_o]", "[o_o ]", "[ o_o]", "[o_o]", "[O_o]", "[o_O]", "[•_•]", "[•_•]>", "[•_•]>>"], ms: 240 },
    done: { f: ["[^_^]", "[^_^]", "[^_~]", "[^_^]"], ms: 420 },
  },
  gomes: {
    idle: { f: [":v", ":v", ":v", ":v", ";v", ":v", ":v", ":v", ":V", ":v", ":v", ":^"], ms: 380 },
    working: { f: [":v", ":o", ":v", ":O", ":v", ":3", ":v", ":o"], ms: 200 },
    done: { f: [":D", ":D", ";D", ":D"], ms: 420 },
  },
};

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)"); if (!m) return;
    const on = () => setR(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

export function AssistantFace({ who, state = "idle", className, animate = true, label }: { who: Who; state?: FaceState; className?: string; animate?: boolean; label?: string }) {
  const reduced = useReducedMotion();
  const seq = frames[who][state];
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (!animate || reduced) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % seq.f.length), seq.ms);
    return () => window.clearInterval(t);
  }, [seq, animate, reduced]);
  const text = seq.f[i % seq.f.length];
  return (
    <span role="img" aria-label={label ?? (who === "andrade" ? "Andrade" : "Gomes")}
      className={cn("inline-flex select-none items-center justify-center whitespace-pre font-mono font-semibold leading-none tracking-tight",
        className)}>
      {/* largura fixa para o rosto não "pular" entre os quadros */}
      <span aria-hidden className="inline-block min-w-[5.2ch] text-center">{text}</span>
    </span>
  );
}

/* Avatar redondo com o rosto (para menu, cartões e o botão flutuante). */
export function AssistantAvatar({ who, state = "idle", size = 40, animate = true, className }: { who: Who; state?: FaceState; size?: number; animate?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
      who === "andrade" ? "bg-ink text-amp dark:bg-surface-3" : "bg-accent text-white", className)} style={{ width: size, height: size, fontSize: size * (who === "gomes" ? 0.36 : 0.26) }}>
      <AssistantFace who={who} state={state} animate={animate} />
    </span>
  );
}
