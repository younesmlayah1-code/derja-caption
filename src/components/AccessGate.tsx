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
    const plans = [
      { label: "1 Month", duration: "1 month" },
      { label: "3 Months", duration: "3 months", badge: "Popular" },
      { label: "6 Months", duration: "6 months" },
      { label: "12 Months", duration: "12 months", badge: "Best value" },
      { label: "Unlimited", duration: "lifetime" },
    ];
    const waNumber = "21692799284";
    const buildWaUrl = (planLabel: string) => {
      const msg = `Hi! I'd like to subscribe to the ${planLabel} plan for Derja Caption.\nAccount: ${access?.email ?? ""}`;
      return `https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`;
    };

    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-border bg-card/40 p-6 text-center backdrop-blur">
          <Lock className="mx-auto h-6 w-6 text-primary" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Choose your plan</h1>
            <p className="text-sm text-muted-foreground">
              Account <b>{access?.email}</b> is on the Free plan. Pick a plan and contact us on WhatsApp to activate.
            </p>
          </div>
          <div className="space-y-2 text-left">
            {plans.map((p) => (
              <a
                key={p.label}
                href={buildWaUrl(p.label)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3 text-sm hover:bg-accent transition"
              >
                <div>
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">Access for {p.duration}</div>
                </div>
                <div className="flex items-center gap-2">
                  {p.badge && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {p.badge}
                    </span>
                  )}
                  <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                    Subscribe
                  </span>
                </div>
              </a>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Redirects to WhatsApp +216 92 799 284
          </p>
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
