import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { UserCog, RefreshCw, Infinity as InfinityIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getMyAccess } from "@/lib/auth.functions";

export function daysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** Header actions: account management + renew, with a tiny status line. */
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

  let statusText: React.ReactNode;
  if (!isPro) statusText = <span className="text-destructive-foreground">Free · inactive</span>;
  else if (unlimited)
    statusText = (
      <span className="inline-flex items-center gap-1 text-primary">
        <InfinityIcon className="h-3 w-3" /> Unlimited
      </span>
    );
  else
    statusText = (
      <span className={lowDays ? "text-amber-400" : "text-primary"}>
        {days} day{days === 1 ? "" : "s"} left
      </span>
    );

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        <Link
          to="/account"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <UserCog className="h-3.5 w-3.5" />
          Account
        </Link>
        <Link
          to="/account"
          hash="plans"
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Renew
        </Link>
      </div>
      <div className="text-[10px] uppercase tracking-wider">{statusText}</div>
    </div>
  );
}
