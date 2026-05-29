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
  const buildWaUrl = (planLabel: string, price: string) => {
    const msg = `Hi! I'd like to ${
      isPro ? "renew/upgrade" : "subscribe"
    } to the ${planLabel} plan (${price}) for Derja Caption.\nAccount: ${data?.email ?? ""}`;
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
      <section id="plans" className="mt-6 scroll-mt-6">
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
              href={buildWaUrl(p.label, p.price)}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 p-4 transition hover:border-primary/60 hover:bg-card/70"
            >
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-medium">{p.label}</div>
                  {p.badge && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {p.badge}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{p.duration}</div>
                <div className="mt-1 text-lg font-bold tracking-tight text-foreground">
                  {p.price}
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </span>
            </a>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          Subscribe button opens WhatsApp +216 92 799 284
        </p>
      </section>

      {/* Personal details */}
      <ProfileSettings currentEmail={data?.email ?? ""} />
    </main>
  );
}

function ProfileSettings({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState(currentEmail);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const saveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMsg(null);
    if (!email || email === currentEmail) return;
    setEmailBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw error;
      setEmailMsg({
        kind: "ok",
        text: "Check your new email inbox to confirm the change.",
      });
    } catch (err) {
      setEmailMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setEmailBusy(false);
    }
  };

  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.length < 6) {
      setPwMsg({ kind: "err", text: "Password must be at least 6 characters." });
      return;
    }
    if (pw !== pw2) {
      setPwMsg({ kind: "err", text: "Passwords don't match." });
      return;
    }
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setPwMsg({ kind: "ok", text: "Password updated." });
      setPw("");
      setPw2("");
    } catch (err) {
      setPwMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Personal details</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <form
          onSubmit={saveEmail}
          className="space-y-3 rounded-2xl border border-border bg-card/40 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Mail className="h-4 w-4 text-primary" /> Change email
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border bg-background/80 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={emailBusy || !email || email === currentEmail}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {emailBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save email
          </button>
          {emailMsg && (
            <p
              className={`flex items-start gap-1.5 text-[11px] ${
                emailMsg.kind === "ok" ? "text-primary" : "text-destructive-foreground"
              }`}
            >
              {emailMsg.kind === "ok" && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
              {emailMsg.text}
            </p>
          )}
        </form>

        <form
          onSubmit={savePw}
          className="space-y-3 rounded-2xl border border-border bg-card/40 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="h-4 w-4 text-primary" /> Change password
          </div>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            className="w-full rounded-xl border border-border bg-background/80 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-xl border border-border bg-background/80 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={pwBusy || !pw}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {pwBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Update password
          </button>
          {pwMsg && (
            <p
              className={`flex items-start gap-1.5 text-[11px] ${
                pwMsg.kind === "ok" ? "text-primary" : "text-destructive-foreground"
              }`}
            >
              {pwMsg.kind === "ok" && <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />}
              {pwMsg.text}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
