import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LogOut, MailCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Logo, Wordmark } from "@/components/brand/Wordmark";
import { Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/domain";
import { appUrl, supabase, supabaseConfigMissing } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

/* Layout das telas de acesso, na linguagem da identidade ANDRA&GO:
   capa em Azul Intenção com granulação, o nome em grande e a voz itálica. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="bg-intent relative hidden overflow-hidden p-10 text-paper lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70"><Wordmark className="text-[13px]" os={false} /><span>Sistema do estúdio</span></div>
        <Logo variant="stacked" tone="dark" className="w-[min(78%,620px)] text-paper" />
        <div>
          <div aria-hidden className="relative mb-6 h-px bg-white/30"><span className="absolute left-0 -top-px h-[3px] w-6 bg-white" /></div>
          <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-sm text-white/80">Estúdio Criativo</p>
            <p className="voice mt-3 text-2xl leading-snug text-amp">Ideias com intenção.<br />Marcas com identidade.</p>
          </div>
          <p className="text-[11px] text-white/60">© {new Date().getFullYear()} ANDRA&amp;GO OS</p>
          </div>
        </div>
      </aside>
      <main className="flex items-center justify-center bg-surface px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm animate-in">
          <div className="mb-10 lg:hidden"><Wordmark tone="light" className="text-xl" /></div>
          <h1 className="text-[28px] font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-fg-3">{subtitle}</p>}
          {supabaseConfigMissing && (
            <p role="alert" className="mt-4 rounded-md border border-warning/30 bg-warning-soft p-3 text-xs text-fg-2">
              O Supabase ainda não foi configurado. Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env</code>.
            </p>
          )}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-xs text-fg-3">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{message}</p>;
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { inputRef?: React.Ref<HTMLInputElement> }) {
  const [show, setShow] = useState(false);
  const { inputRef, ...rest } = props;
  return (
    <div className="relative">
      <Input ref={inputRef} type={show ? "text" : "password"} className="pr-10" {...rest} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-fg-3 hover:text-fg">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- Login */
const loginSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe sua senha."),
});

export function LoginPage({ redirect }: { redirect?: string }) {
  const nav = useNavigate();
  const { status, context } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (status === "ready" && context) nav({ to: redirect && /^\/(?!\/)/.test(redirect) && !redirect.startsWith("/login") ? redirect : "/", replace: true });
  }, [status, context, redirect, nav]);

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
    if (error) { setError(errorMessage(error)); return; }
    await supabase.rpc("log_auth_event", { p_action: "login" });
  });

  return (
    <AuthLayout title="Entrar" subtitle="Use o e-mail e a senha da sua conta.">
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
        </Field>
        <Field label="Senha" htmlFor="password" error={errors.password?.message}>
          <PasswordInputRegistered id="password" autoComplete="current-password" invalid={!!errors.password} reg={register("password")} />
        </Field>
        <div className="-mt-1 flex justify-end"><Link to="/recuperar-senha" className="text-xs text-accent hover:underline">Esqueci minha senha</Link></div>
        <FormError message={error} />
        <Button type="submit" variant="primary" loading={isSubmitting} disabled={supabaseConfigMissing} className="w-full">Entrar</Button>
      </form>
      <p className="mt-6 border-t border-border pt-4 text-center text-xs text-fg-3">
        Primeiro acesso do administrador? <Link to="/criar-senha" className="text-accent hover:underline">Criar minha senha</Link>
        <span className="mt-1 block">Não há cadastro público. Os demais usuários são convidados pelo administrador.</span>
      </p>
    </AuthLayout>
  );
}

// Adapta o register do RHF ao PasswordInput com botão de mostrar/ocultar.
function PasswordInputRegistered({ reg, invalid, ...rest }: { reg: ReturnType<ReturnType<typeof useForm>["register"]>; invalid?: boolean; id: string; autoComplete: string }) {
  const { ref, ...r } = reg;
  return <PasswordInput inputRef={ref} aria-invalid={invalid} {...r} {...rest} />;
}

/* ----------------------------------------------- Recuperação de senha */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ email: z.string().trim().email("Informe um e-mail válido.") });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl("/redefinir-senha") });
    if (error && !/rate/i.test(error.message)) { setError(errorMessage(error)); return; }
    setSent(true); // mesma resposta exista ou não a conta (não revela e-mails cadastrados)
  });
  if (sent) {
    return (
      <AuthLayout title="Verifique seu e-mail" footer={<Link to="/login" className="text-accent hover:underline">Voltar para o login</Link>}>
        <div className="flex gap-3 rounded-lg border border-border bg-surface-2 p-4 text-sm text-fg-2">
          <MailCheck className="size-5 shrink-0 text-accent" />
          Se houver uma conta com este e-mail, você vai receber um link para criar uma nova senha. O link expira em 1 hora.
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha."
      footer={<Link to="/login" className="text-accent hover:underline">Voltar para o login</Link>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="E-mail" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" loading={isSubmitting} className="w-full">Enviar link</Button>
      </form>
    </AuthLayout>
  );
}

/* ---------------------------------- Definir / redefinir senha (e convite) */
const passwordSchema = z.object({
  full_name: z.string().trim().optional(),
  password: z.string().min(10, "Use pelo menos 10 caracteres.")
    .regex(/[A-Za-z]/, "Inclua ao menos uma letra.").regex(/\d/, "Inclua ao menos um número."),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não conferem." });

export function SetPasswordPage({ mode }: { mode: "reset" | "invite" }) {
  const nav = useNavigate();
  const { session, status, refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: v.password, data: v.full_name ? { full_name: v.full_name } : undefined });
    if (error) { setError(errorMessage(error)); return; }
    if (mode === "invite") {
      if (v.full_name) await supabase.from("profiles").update({ full_name: v.full_name }).eq("id", session!.user.id);
      const { error: e2 } = await supabase.rpc("accept_invitation");
      if (e2) { setError(errorMessage(e2)); return; }
    }
    await supabase.rpc("log_auth_event", { p_action: "password_changed" });
    await refresh();
    nav({ to: "/", replace: true });
  });

  if (status === "loading") return <AuthLayout title="Carregando…"><span /></AuthLayout>;
  if (!session) {
    return (
      <AuthLayout title="Link inválido ou expirado" subtitle="Peça um novo link para continuar."
        footer={<Link to="/login" className="text-accent hover:underline">Ir para o login</Link>}>
        <Link to="/recuperar-senha"><Button variant="primary" className="w-full">Solicitar novo link</Button></Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title={mode === "invite" ? "Boas-vindas! Crie sua senha" : "Nova senha"}
      subtitle={mode === "invite" ? `Você foi convidado(a) com o e-mail ${session.user.email}.` : "Escolha uma nova senha para sua conta."}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {mode === "invite" && (
          <Field label="Seu nome" htmlFor="full_name"><Input id="full_name" autoComplete="name" {...register("full_name")} /></Field>
        )}
        <Field label="Senha" htmlFor="password" error={errors.password?.message} hint="Mínimo de 10 caracteres, com letras e números.">
          <PasswordInputRegistered id="password" autoComplete="new-password" invalid={!!errors.password} reg={register("password")} />
        </Field>
        <Field label="Confirmar senha" htmlFor="confirm" error={errors.confirm?.message}>
          <PasswordInputRegistered id="confirm" autoComplete="new-password" invalid={!!errors.confirm} reg={register("confirm")} />
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" loading={isSubmitting} className="w-full">{mode === "invite" ? "Criar senha e entrar" : "Salvar nova senha"}</Button>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------- Primeiro acesso do administrador (senha) */
export function CreatePasswordRequestPage() {
  const [sent, setSent] = useState(false);
  const schema = z.object({ email: z.string().trim().email("Informe um e-mail válido.") });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const [error, setError] = useState<string | null>(null);
  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await supabase.functions.invoke("first-access", { body: { email } });
    if (error) { setError("Não foi possível enviar agora. Tente novamente em instantes."); return; }
    setSent(true);
  });
  if (sent) {
    return (
      <AuthLayout title="Verifique seu e-mail" footer={<Link to="/login" className="text-accent hover:underline">Voltar para o login</Link>}>
        <div className="flex gap-3 rounded-lg border border-border bg-surface-2 p-4 text-sm text-fg-2">
          <MailCheck className="size-5 shrink-0 text-accent" />
          Se este e-mail estiver autorizado como administrador, você vai receber um link para criar a senha. Depois de criá-la, você configura o estúdio.
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Criar minha senha" subtitle="Primeiro acesso do administrador da plataforma."
      footer={<Link to="/login" className="text-accent hover:underline">Já tenho senha</Link>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="E-mail do administrador" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" loading={isSubmitting} disabled={supabaseConfigMissing} className="w-full">Enviar link para criar a senha</Button>
        <p className="text-xs text-fg-3">Por segurança, a senha é criada a partir de um link enviado ao seu e-mail. Isso confirma que o e-mail é seu.</p>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------ Primeiro acesso */
// Exibida para quem entrou mas ainda não pertence a um estúdio (o administrador
// inicial criado pelo script de bootstrap). Contas de cliente nunca chegam aqui.
const orgSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do estúdio.").max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,60}$/, "Use letras minúsculas, números e hífen."),
});
export function FirstAccessPage() {
  const { refresh, context, signOut } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<z.infer<typeof orgSchema>>({ resolver: zodResolver(orgSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.rpc("create_organization", { p_name: v.name, p_slug: v.slug });
    if (error) { setError(errorMessage(error)); return; }
    await refresh();
    nav({ to: "/", replace: true });
  });
  if (context?.pending_invites) {
    return (
      <AuthLayout title="Convite pendente" subtitle="Você tem um convite aguardando confirmação.">
        <Button variant="primary" className="w-full" onClick={async () => { await supabase.rpc("accept_invitation"); await refresh(); nav({ to: "/", replace: true }); }}>Aceitar convite</Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Configure seu estúdio" subtitle="Primeiro acesso: crie o espaço de trabalho. Você será o administrador."
      footer={<button onClick={signOut} className="text-accent hover:underline">Sair</button>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <Field label="Nome do estúdio" htmlFor="name" error={errors.name?.message}>
          <Input id="name" {...register("name", { onChange: (e) => setValue("slug", e.target.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)) })} />
        </Field>
        <Field label="Endereço interno" htmlFor="slug" error={errors.slug?.message} hint="Identificador único do estúdio.">
          <Input id="slug" {...register("slug")} />
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="primary" loading={isSubmitting} className="w-full">Criar estúdio</Button>
      </form>
    </AuthLayout>
  );
}

/* ----------------------------------------------- Encerramento de sessão */
export function SignedOutPage() {
  const { signOut, session } = useAuth();
  const [done, setDone] = useState(!session);
  useEffect(() => { if (session) signOut().then(() => setDone(true)); }, [session, signOut]);
  return (
    <AuthLayout title={done ? "Sessão encerrada" : "Saindo…"} subtitle={done ? "Você saiu com segurança. Até logo!" : undefined}>
      {done && <Link to="/login"><Button variant="primary" className="w-full" icon={<LogOut className="size-4 rotate-180" />}>Entrar novamente</Button></Link>}
    </AuthLayout>
  );
}
