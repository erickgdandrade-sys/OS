// Componentes base do design system. Todos usam os tokens de src/styles.css.
import { clsx } from "clsx";
import { Loader2, X, AlertTriangle, Inbox, CheckCircle2, Info } from "lucide-react";
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import type { Tone } from "@/lib/domain";
import { initials } from "@/lib/format";

export const cn = clsx;

/* ---------------------------------------------------------------- Botão */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode;
}
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-2 hover:border-border-strong shadow-sm",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:brightness-110 shadow-sm",
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background,filter,border-color,color] duration-150 select-none",
        "disabled:opacity-50 disabled:pointer-events-none active:translate-y-px",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm", variants[variant], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className={cn("inline-flex size-8 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40", className)} {...rest}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------- Formulários */
// Largura: w-full por padrão; uma classe w-* sem prefixo passada pelo chamador substitui.
const widthOf = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? "" : "w-full");
const fieldBase = "min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-3 shadow-sm transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, widthOf(className), "h-9", className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, widthOf(className), "py-2 leading-relaxed", className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn(fieldBase, widthOf(className), "h-9 pr-8 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237A8596' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>{children}</select>;
});

export function Field({ label, error, hint, children, className, htmlFor, required }: {
  label: string; error?: string; hint?: string; children: ReactNode; className?: string; htmlFor?: string; required?: boolean;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-fg-2">{label}{required && <span className="text-danger"> *</span>}</label>
      {children}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------- Badges */
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-2 ring-border",
  accent: "bg-accent-soft text-accent ring-accent/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/20",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
};
export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-2xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}{children}
    </span>
  );
}

/* ---------------------------------------------------------------- Card */
export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn("rounded-lg border border-border bg-surface shadow-sm", padded && "p-4 sm:p-5", className)}>{children}</section>;
}
export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- Avatar */
export function Avatar({ name, size = 24, className }: { name?: string | null; size?: number; className?: string }) {
  const hue = [...(name ?? "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span title={name ?? undefined} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ring-2 ring-surface", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: `oklch(0.55 0.11 ${hue})` }}>{initials(name)}</span>
  );
}

/* ------------------------------------------------------------- Estados */
export function Spinner({ label = "Carregando" }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-fg-3"><Loader2 className="size-4 animate-spin" aria-hidden />{label}…</div>;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center animate-in">
      <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-3">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-fg-3">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-6 py-8 text-center">
      <AlertTriangle className="size-5 text-danger" aria-hidden />
      <p className="text-sm font-medium text-fg">Não foi possível carregar</p>
      <p className="max-w-md text-xs text-fg-2">{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && <Button size="sm" onClick={onRetry} className="mt-2">Tentar novamente</Button>}
    </div>
  );
}

/* ---------------------------------------------------------------- Modal */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg";
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-[2px] animate-in" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id}
        className={cn("relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-border bg-surface shadow-lg animate-pop sm:rounded-xl",
          size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div><h2 id={id} className="text-base font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}</div>
          <IconButton label="Fechar" data-close onClick={onClose}><X className="size-4" /></IconButton>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>, document.body);
}

/** Confirmação para ações destrutivas. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Excluir", loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description: string; confirmLabel?: string; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="text-sm text-fg-2">{description}</p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Toast */
type ToastItem = { id: number; tone: "success" | "error" | "info"; message: string };
const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-3 text-sm shadow-md animate-pop">
            {t.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : t.tone === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------- Abas */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border scrollbar-thin">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cn("relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
            value === it.value ? "border-accent font-medium text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
          {it.label}{it.count != null && <span className="ml-1.5 text-2xs text-fg-3 tabular">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- Segmentado */
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; icon?: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {items.map((it) => (
        <button key={it.value} onClick={() => onChange(it.value)} aria-pressed={value === it.value}
          className={cn("inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-all",
            value === it.value ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-3 hover:text-fg")}>
          {it.icon}{it.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- Cabeçalho */
export function PageHeader({ title, description, actions, meta }: { title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between animate-in">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-3">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Progresso */
export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}
