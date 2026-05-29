import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Shield,
  LogOut,
  Trash2,
  KeyRound,
  Save,
  Eraser,
  Lock,
  Tag,
  Plus,
  X,
  Home,
  ArrowLeft,
  Infinity as InfinityIcon,
  CheckCircle2,
  CircleSlash,
  CalendarClock,
  Mail,
  FlaskConical,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  adminDeleteUser,
  adminListSecrets,
  adminListUsers,
  adminResetUserPassword,
  adminUpdatePlans,
  adminUpdateSecret,
  adminUpdateUser,
  ensureAdminBootstrap,
  getMyAccess,
  getPlans,
  type ManagedSecretKey,
  type PlanItem,
} from "@/lib/auth.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Derja Caption" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { session, loading } = useAuth();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapErr, setBootstrapErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    ensureAdminBootstrap()
      .then(() => !cancel && setBootstrapped(true))
      .catch((e) => !cancel && setBootstrapErr((e as Error).message));
    return () => {
      cancel = true;
    };
  }, []);

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ["my-access", session?.user.id],
    queryFn: () => getMyAccess(),
    enabled: !!session,
  });

  if (loading || !bootstrapped) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        {bootstrapErr ? (
          <p className="text-sm text-destructive-foreground">{bootstrapErr}</p>
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </main>
    );
  }

  if (!session) return <AdminLogin />;
  if (accessLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (!access?.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm space-y-3 text-center">
          <Shield className="mx-auto h-6 w-6 text-destructive-foreground" />
          <h1 className="text-lg font-semibold">Not an admin account</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {access?.email}. Log out and sign in with the admin email.
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </main>
    );
  }

  return <AdminPanel />;
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card/40 p-6 backdrop-blur"
      >
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Admin sign in</h1>
        </div>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Admin email"
          className="w-full rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-background/80 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {err && <p className="text-xs text-destructive-foreground">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
        <Link
          to="/login"
          className="mx-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to user login
        </Link>
      </form>
    </main>
  );
}

function AdminPanel() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminListUsers(),
  });
  const { data: plans = [] } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => getPlans(),
  });

  const update = useMutation({
    mutationFn: (vars: {
      userId: string;
      plan?: "free" | "pro";
      active?: boolean;
      durationMonths?: number | null;
      durationDays?: number | null;
    }) => adminUpdateUser({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const del = useMutation({
    mutationFn: (userId: string) => adminDeleteUser({ data: { userId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const resetPw = useMutation({
    mutationFn: (vars: { userId: string; password: string }) =>
      adminResetUserPassword({ data: vars }),
  });

  const grantPlan = (userId: string, months: number | null) => {
    update.mutate({ userId, plan: "pro", active: true, durationMonths: months });
  };

  const grantCustomDays = (userId: string, email: string) => {
    const raw = window.prompt(`Grant Pro access to ${email} for how many days? (0 = unlimited)`);
    if (raw === null) return;
    const days = Number(raw.trim());
    if (!Number.isFinite(days) || days < 0 || days > 36500) {
      alert("Enter a number between 0 and 36500.");
      return;
    }
    update.mutate({
      userId,
      plan: "pro",
      active: true,
      durationDays: days === 0 ? null : Math.floor(days),
    });
  };

  const handleResetPw = (userId: string, email: string) => {
    const pw = window.prompt(`Set a new password for ${email} (min 6 chars):`);
    if (!pw) return;
    if (pw.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    resetPw.mutate(
      { userId, password: pw },
      {
        onSuccess: () => alert(`Password updated for ${email}.`),
        onError: (e) => alert((e as Error).message),
      },
    );
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Admin panel</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BetaAccessButton />
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <Home className="h-4 w-4" /> Home
          </Link>
          <button
            onClick={() => supabase.auth.signOut()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>


      {isLoading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Grant access</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const exp = (u as { expires_at?: string | null }).expires_at ?? null;
                const days = exp ? Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000) : null;
                const expired = days !== null && days <= 0;
                return (
                  <tr key={u.id} className="border-t border-border align-top transition hover:bg-card/30">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold uppercase text-primary">
                          {u.email.slice(0, 2)}
                        </span>
                        <div className="flex min-w-0 flex-col">
                          <span className="inline-flex items-center gap-1 truncate text-sm">
                            <Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{u.email}</span>
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Joined {new Date(u.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={u.plan}
                        onChange={(e) =>
                          update.mutate({
                            userId: u.id,
                            plan: e.target.value as "free" | "pro",
                          })
                        }
                        className={`rounded-md border px-2 py-1 text-xs font-medium ${
                          u.plan === "pro"
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground"
                        }`}
                      >
                        <option value="free">free</option>
                        <option value="pro">pro</option>
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => update.mutate({ userId: u.id, active: !u.active })}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                          u.active
                            ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                            : "bg-muted text-muted-foreground hover:bg-accent"
                        }`}
                        title={u.active ? "Click to deactivate" : "Click to activate"}
                      >
                        {u.active ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" /> active
                          </>
                        ) : (
                          <>
                            <CircleSlash className="h-3 w-3" /> inactive
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {exp ? (
                        <span
                          className={`inline-flex flex-col rounded-lg px-2 py-1 ${
                            expired
                              ? "bg-destructive/15 text-destructive-foreground"
                              : days !== null && days <= 7
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-card/60 text-muted-foreground"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {new Date(exp).toLocaleDateString()}
                          </span>
                          <span className="text-[10px]">
                            {expired ? "expired" : `${days} day${days === 1 ? "" : "s"} left`}
                          </span>
                        </span>
                      ) : u.plan === "pro" && u.active ? (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-primary/15 px-2 py-1 text-primary">
                          <InfinityIcon className="h-3 w-3" /> unlimited
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {plans.map((p, idx) => (
                          <button
                            key={`${p.label}-${idx}`}
                            onClick={() => grantPlan(u.id, p.durationMonths)}
                            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:border-primary hover:text-primary"
                            title={
                              p.durationMonths === null || p.durationMonths === 0
                                ? `${p.label} — Pro + active, no expiry`
                                : `${p.label} — Pro + active for ${p.durationMonths} month(s)`
                            }
                          >
                            {p.label}
                          </button>
                        ))}
                        {plans.length === 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            No plans configured
                          </span>
                        )}
                        <button
                          onClick={() => grantCustomDays(u.id, u.email)}
                          className="rounded-md border border-dashed border-border bg-background px-2 py-1 text-[11px] hover:border-primary hover:text-primary"
                          title="Grant Pro for a custom number of days"
                        >
                          Custom…
                        </button>

                      </div>
                    </td>

                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => handleResetPw(u.id, u.email)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary"
                          title="Set a new password for this user"
                        >
                          <Lock className="h-3 w-3" /> Reset pw
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete ${u.email}?`)) del.mutate(u.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-destructive-foreground hover:bg-accent"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PlansSection />
      <SecretsSection />
    </main>
  );
}

function PlansSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: () => getPlans(),
  });
  const [draft, setDraft] = useState<PlanItem[] | null>(null);
  useEffect(() => {
    if (data && draft === null) setDraft(data);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: (plans: PlanItem[]) => adminUpdatePlans({ data: { plans } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-plans"] });
      qc.invalidateQueries({ queryKey: ["plans"] });
    },
  });

  const update = (i: number, patch: Partial<PlanItem>) => {
    setDraft((d) => d!.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };
  const remove = (i: number) => setDraft((d) => d!.filter((_, idx) => idx !== i));
  const add = () =>
    setDraft((d) => [
      ...(d ?? []),
      { label: "New plan", duration: "30 days of access", price: "0 TND", durationMonths: 1 },
    ]);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <Tag className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Plans &amp; pricing</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Edit the plans shown on the account page. Duration months controls how long access lasts when granted (use 0 or empty for unlimited).
      </p>

      {isLoading || !draft ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          {draft.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-2xl border border-border bg-card/40 p-3 sm:grid-cols-12">
              <input
                value={p.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Label"
                className="sm:col-span-2 rounded-lg border border-border bg-background/80 px-2 py-1.5 text-sm"
              />
              <input
                value={p.duration}
                onChange={(e) => update(i, { duration: e.target.value })}
                placeholder="Duration label"
                className="sm:col-span-3 rounded-lg border border-border bg-background/80 px-2 py-1.5 text-sm"
              />
              <input
                value={p.price}
                onChange={(e) => update(i, { price: e.target.value })}
                placeholder="Price (e.g. 15 TND)"
                className="sm:col-span-2 rounded-lg border border-border bg-background/80 px-2 py-1.5 text-sm"
              />
              <input
                value={p.badge ?? ""}
                onChange={(e) => update(i, { badge: e.target.value })}
                placeholder="Badge (optional)"
                className="sm:col-span-2 rounded-lg border border-border bg-background/80 px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                min={0}
                max={120}
                value={p.durationMonths ?? ""}
                onChange={(e) =>
                  update(i, {
                    durationMonths: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Months (∞)"
                className="sm:col-span-2 rounded-lg border border-border bg-background/80 px-2 py-1.5 text-sm"
                title="Months of access. Leave empty or 0 for unlimited."
              />
              <button
                onClick={() => remove(i)}
                className="sm:col-span-1 inline-flex items-center justify-center rounded-lg border border-border px-2 py-1.5 text-xs text-destructive-foreground hover:bg-accent"
                title="Remove plan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={add}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Add plan
            </button>
            <button
              disabled={save.isPending}
              onClick={() => draft && save.mutate(draft)}
              className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save plans
            </button>
            {save.isSuccess && <span className="text-xs text-primary">Saved.</span>}
            {save.isError && (
              <span className="text-xs text-destructive-foreground">
                {(save.error as Error).message}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SecretsSection() {
  const qc = useQueryClient();
  const { data: secrets = [], isLoading } = useQuery({
    queryKey: ["admin-secrets"],
    queryFn: () => adminListSecrets(),
  });
  const update = useMutation({
    mutationFn: (vars: { key: ManagedSecretKey; value: string }) =>
      adminUpdateSecret({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-secrets"] }),
  });

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">API keys</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Override server API keys without redeploying. Leave the field empty and Save to clear an
        override and fall back to the deployment value.
      </p>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <div className="space-y-3">
          {secrets.map((s) => (
            <SecretRow
              key={s.key}
              secret={s}
              saving={update.isPending}
              onSave={(value) => update.mutate({ key: s.key as ManagedSecretKey, value })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SecretRow({
  secret,
  saving,
  onSave,
}: {
  secret: { key: string; hasOverride: boolean; masked: string; updatedAt: string | null; envSet: boolean };
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-medium">{secret.key}</div>
          <div className="text-xs text-muted-foreground">
            {secret.hasOverride ? (
              <>
                Override: <span className="font-mono">{secret.masked}</span>
                {secret.updatedAt && (
                  <> · updated {new Date(secret.updatedAt).toLocaleString()}</>
                )}
              </>
            ) : (
              <>No override · {secret.envSet ? "using deployment value" : "not set anywhere"}</>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste new API key (leave empty to clear override)"
          className="flex-1 min-w-[200px] rounded-xl border border-border bg-background/80 px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-accent"
        >
          {show ? "Hide" : "Show"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            onSave(value);
            setValue("");
          }}
          className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
        {secret.hasOverride && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              if (confirm(`Clear override for ${secret.key}?`)) onSave("");
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs hover:bg-accent"
          >
            <Eraser className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
