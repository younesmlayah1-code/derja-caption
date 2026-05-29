import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Crown,
  Infinity as InfinityIcon,
  Clock3,
  LogOut,
  ArrowLeft,
  MessageCircle,
  ShieldCheck,
  Loader2,
  Mail,
  KeyRound,
  Save,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getMyAccess } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { daysRemaining } from "@/components/PlanStatus";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "My account — Derja Caption" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AccountPage,
});

const PLANS = [
  { label: "1 Month", duration: "30 days of access", price: "15 TND" },
  { label: "3 Months", duration: "90 days of access", price: "40 TND", badge: "Popular" },
  { label: "6 Months", duration: "180 days of access", price: "70 TND" },
  { label: "12 Months", duration: "365 days of access", price: "120 TND", badge: "Best value" },
  { label: "Unlimited", duration: "Lifetime access", price: "250 TND" },
];

function AccountPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["my-access", session?.user.id],
    queryFn: () => getMyAccess(),
    enabled: !!session,
  });

  if (loading || (session && isLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!session) {
    navigate({ to: "/login" });
    return null;
  }

  const isPro = data?.plan === "pro" && data?.active;
  const unlimited = isPro && !data?.expiresAt;
  const days = daysRemaining(data?.expiresAt ?? null);
  const buildWaUrl = (planLabel: string) => {
    const msg = `Hi! I'd like to ${
      isPro ? "renew/upgrade" : "subscribe"
    } to the ${planLabel} plan for Derja Caption.\nAccount: ${data?.email ?? ""}`;
    return `https://wa.me/21692799284?text=${encodeURIComponent(msg)}`;
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/login" });
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>

      {/* Hero plan card */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-card/40 to-card/40 p-6">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Signed in as
              </p>
              <p className="mt-0.5 font-medium">{data?.email}</p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                isPro
                  ? "bg-primary text-primary-foreground"
                  : "bg-destructive/20 text-destructive-foreground"
              }`}
            >
              {isPro ? <Crown className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              {isPro ? "PRO" : "FREE"}
            </span>
          </div>

          <div className="mt-5">
            {isPro ? (
              unlimited ? (
                <div className="flex items-center gap-2">
                  <InfinityIcon className="h-7 w-7 text-primary" />
                  <div>
                    <div className="text-2xl font-semibold leading-none">Unlimited access</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Your subscription never expires.
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold tracking-tight">{days}</span>
                    <span className="text-sm text-muted-foreground">
                      day{days === 1 ? "" : "s"} remaining
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Expires on{" "}
                    {new Date(data!.expiresAt!).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </div>
                  {/* Progress-ish bar based on days (caps at 90 visually) */}
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-background/60">
                    <div
                      className={`h-full rounded-full ${
                        days !== null && days <= 3 ? "bg-amber-500" : "bg-primary"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(4, ((days ?? 0) / 90) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-semibold">
                  {data?.expired ? "Your plan has expired" : "No active subscription"}
                </div>
                <p className="text-sm text-muted-foreground">
                  Pick a plan below and message us on WhatsApp to activate.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isPro ? "Renew or upgrade" : "Choose a plan"}
          </h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Manual activation
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PLANS.map((p) => (
            <a
              key={p.label}
              href={buildWaUrl(p.label)}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 p-4 transition hover:border-primary/60 hover:bg-card/70"
            >
              <div>
                <div className="font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground">{p.duration}</div>
              </div>
              <div className="flex items-center gap-2">
                {p.badge && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {p.badge}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                  <MessageCircle className="h-3.5 w-3.5" />
                  WhatsApp
                </span>
              </div>
            </a>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Subscribe button opens WhatsApp +216 92 799 284
        </p>
      </section>
    </main>
  );
}
