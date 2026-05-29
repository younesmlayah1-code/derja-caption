import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Lock, Loader2, LogOut } from "lucide-react";
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

  if (!access?.active || access.plan === "free") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-border bg-card/40 p-6 text-center backdrop-blur">
          <Lock className="mx-auto h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Subscription required</h1>
          <p className="text-sm text-muted-foreground">
            Your account ({access?.email}) is on the <b>Free</b> plan and is not active. Contact the
            admin to activate your subscription.
          </p>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login" });
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2.5 text-sm hover:bg-accent"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
