import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Crown, Infinity as InfinityIcon, Clock3 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getMyAccess } from "@/lib/auth.functions";

export function daysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** Compact pill that shows the user's plan and time remaining. */
export function PlanStatus({ className = "" }: { className?: string }) {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["my-access", session?.user.id],
    queryFn: () => getMyAccess(),
    enabled: !!session,
    staleTime: 60_000,
  });
  if (!session || !data) return null;

  const isPro = data.plan === "pro" && data.active;
  const days = daysRemaining(data.expiresAt);
  const unlimited = isPro && !data.expiresAt;
  const lowDays = days !== null && days <= 3;

  const tone = isPro
    ? lowDays
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : "border-primary/40 bg-primary/10 text-primary"
    : "border-destructive/40 bg-destructive/10 text-destructive-foreground";

  return (
    <Link
      to="/account"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-90 ${tone} ${className}`}
    >
      {isPro ? <Crown className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
      <span className="uppercase tracking-wide">
        {isPro ? "Pro" : "Free"}
      </span>
      <span className="opacity-70">·</span>
      {isPro ? (
        unlimited ? (
          <span className="inline-flex items-center gap-1">
            <InfinityIcon className="h-3 w-3" /> Unlimited
          </span>
        ) : (
          <span>{days} day{days === 1 ? "" : "s"} left</span>
        )
      ) : (
        <span>Inactive</span>
      )}
    </Link>
  );
}
