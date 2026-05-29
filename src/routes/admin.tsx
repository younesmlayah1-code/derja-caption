import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, LogOut, Trash2, KeyRound, Save, Eraser } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  adminDeleteUser,
  adminListSecrets,
  adminListUsers,
  adminUpdateSecret,
  adminUpdateUser,
  ensureAdminBootstrap,
  getMyAccess,
  type ManagedSecretKey,
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
  const [email, setEmail] = useState("admin@derja.app");
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

  const update = useMutation({
    mutationFn: (vars: { userId: string; plan?: "free" | "pro"; active?: boolean }) =>
      adminUpdateUser({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const del = useMutation({
    mutationFn: (userId: string) => adminDeleteUser({ data: { userId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Admin panel</h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
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
                <th className="px-3 py-2">Joined</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.plan}
                      onChange={(e) =>
                        update.mutate({
                          userId: u.id,
                          plan: e.target.value as "free" | "pro",
                        })
                      }
                      className="rounded-md border border-border bg-background px-2 py-1"
                    >
                      <option value="free">free</option>
                      <option value="pro">pro</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={u.active}
                        onChange={(e) =>
                          update.mutate({ userId: u.id, active: e.target.checked })
                        }
                      />
                      {u.active ? "active" : "inactive"}
                    </label>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Delete ${u.email}?`)) del.mutate(u.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-destructive-foreground hover:bg-accent"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
