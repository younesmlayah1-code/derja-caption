import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Lock, Loader2, LogOut, ArrowRight, Clock3 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getMyAccess } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { type ReactNode } from "react";

export function AccessGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ["my-access", session?.user.id],
    queryFn: () => getMyAccess(),
    enabled: !!session,
  });

  if (loading || (session && accessLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-border bg-card/40 p-6 text-center backdrop-blur">
          <Lock className="mx-auto h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Sign in to continue</h1>
          <p className="text-sm text-muted-foreground">
            Create an account or log in to use Derja Caption.
          </p>
          <Link
            to="/login"
            className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  const expired = (access as { expired?: boolean } | undefined)?.expired;
  if (!access?.active || access.plan === "free") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-card/40 p-6 text-center backdrop-blur">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            {expired ? <Clock3 className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">
              {expired ? "Your plan has expired" : "Subscription required"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Account <b>{access?.email}</b>{" "}
              {expired
                ? "no longer has access. Please renew a plan to keep using Derja Caption."
                : "is on the Free plan. Pick a plan to unlock Derja Caption."}
            </p>
          </div>
          <Link
            to="/account"
            hash="plans"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {expired ? "Renew plan" : "View plans"} <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/login" });
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
