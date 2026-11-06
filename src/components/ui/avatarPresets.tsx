import { clsx as cn } from "clsx";
import { Logo } from "@/components/brand/Wordmark";
import { logoArt } from "@/components/brand/logoArt";
import { supabase } from "@/lib/supabase";

/* Avatares prontos (sem upload) e resolução da foto enviada pela pessoa.
   Valores aceitos pelo banco: "preset:<id>" ou "<user_id>/<arquivo>" no bucket `avatars`. */
export const avatarPresets: { id: string; label: string }[] = [
  { id: "andrade", label: "Rosto do Andrade" },
  { id: "gomes", label: "Rosto do Gomes" },
  { id: "amp-ink", label: "& sobre Tinta" },
  { id: "amp-blue", label: "& em Azul Intenção" },
  { id: "amp-paper", label: "& sobre Papel" },
  { id: "logo", label: "Logo ANDRA&GO" },
  { id: "stacked", label: "Logo empilhada" },
];

export function avatarUrl(path: string | null | undefined, version?: string | number) {
  if (!path || path.startsWith("preset:")) return null;
  const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  return version ? `${url}?v=${encodeURIComponent(String(version))}` : url;
}

/* O "&" oficial, recortado do logotipo horizontal (mesmo vetor do favicon). */
function Amp({ color, size }: { color: string; size: number }) {
  return (
    <svg aria-hidden viewBox="788 110 146 149" style={{ width: size * 0.5, height: size * 0.5 }} fill={color}>
      <path d={logoArt.horizontal.amp[0]} />
    </svg>
  );
}

export function PresetAvatar({ id, size }: { id: string; size: number }) {
  const base = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-mono font-semibold leading-none";
  const box = { width: size, height: size };
  switch (id) {
    case "andrade": return <span className={cn(base, "bg-[#0B0C12] text-[#7EB0F2]")} style={{ ...box, fontSize: size * 0.26 }}>[o_o]</span>;
    case "gomes": return <span className={cn(base, "bg-[#1F4FE0] text-white")} style={{ ...box, fontSize: size * 0.36 }}>:v</span>;
    case "amp-ink": return <span className={cn(base, "bg-[#0B0C12]")} style={box}><Amp color="#7EB0F2" size={size} /></span>;
    case "amp-blue": return <span className={cn(base, "bg-[#1F4FE0]")} style={box}><Amp color="#FFFFFF" size={size} /></span>;
    case "amp-paper": return <span className={cn(base, "bg-[#ECECEA] ring-1 ring-inset ring-black/5")} style={box}><Amp color="#1F4FE0" size={size} /></span>;
    case "logo": return <span className={cn(base, "bg-[#0B0C12] text-white")} style={box}><Logo variant="horizontal" tone="dark" title="" className="w-[76%]" /></span>;
    case "stacked": return <span className={cn(base, "bg-[#ECECEA] text-[#0B0C12]")} style={box}><Logo variant="stacked" tone="light" title="" className="w-[62%]" /></span>;
    default: return null;
  }
}
