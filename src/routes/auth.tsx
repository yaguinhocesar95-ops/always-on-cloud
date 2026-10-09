import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useCloudUser } from "@/hooks/useCloudUser";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Ypx Bet" },
      { name: "description", content: "Entre para manter suas apostas automáticas rodando mesmo com o navegador fechado." },
      { property: "og:title", content: "Entrar — Ypx Bet" },
      { property: "og:description", content: "Entre para manter suas apostas automáticas rodando mesmo com o navegador fechado." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const user = useCloudUser();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        void navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        toast.success("Conta criada. Confirme pelo link enviado ao seu e-mail.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r && "error" in r && r.error) toast.error(String((r.error as Error).message ?? r.error));
  };

  if (user) {
    return (
      <div className="mx-auto max-w-sm space-y-4 px-4 py-16 text-center">
        <h1 className="tv-display text-2xl text-foreground">Você está conectado</h1>
        <p className="text-sm text-muted-foreground">{user.email} — suas apostas Supremo continuam sendo geradas a cada minuto, mesmo com esta página fechada.</p>
        <button className="min-h-11 w-full rounded-md border border-border px-4 text-sm text-foreground hover:bg-accent" onClick={() => void supabase.auth.signOut()}>
          Sair
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-5 px-4 py-16">
      <div className="space-y-1 text-center">
        <h1 className="tv-display text-2xl text-foreground">{mode === "in" ? "Entrar" : "Criar conta"}</h1>
        <p className="text-sm text-muted-foreground">Com login, a geração automática continua rodando mesmo com o navegador fechado.</p>
      </div>
      <button onClick={google} className="min-h-11 w-full rounded-md border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-accent">
        Continuar com Google
      </button>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
        <input type="password" required minLength={6} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
        <button disabled={busy} className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {mode === "in" ? "Entrar" : "Criar conta"}
        </button>
      </form>
      <button className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "Não tem conta? Criar agora" : "Já tem conta? Entrar"}
      </button>
    </div>
  );
}
