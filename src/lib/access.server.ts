import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Server-side gate for /api/* routes: verifies the request comes from an
 * authenticated user with an active, non-expired Pro plan.
 *
 * Returns a `Response` (401/403/500) if the request must be rejected, or
 * `{ userId }` if access is granted.
 */
export async function requireActiveUser(
  request: Request,
): Promise<Response | { userId: string }> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return Response.json(
      { error: "Server auth misconfigured." },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (claimsErr || !userId) {
    return Response.json({ error: "Invalid session. Sign in again." }, { status: 401 });
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("plan, active, expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (profErr) {
    return Response.json({ error: "Could not verify subscription." }, { status: 500 });
  }
  if (!profile) {
    return Response.json({ error: "Account not found." }, { status: 403 });
  }

  const expired = !!profile.expires_at && new Date(profile.expires_at).getTime() <= Date.now();
  const isActivePro = profile.plan === "pro" && profile.active && !expired;
  if (!isActivePro) {
    return Response.json(
      {
        error: expired
          ? "Your subscription has expired. Please renew to continue."
          : "Active subscription required. Please subscribe to continue.",
        code: expired ? "expired" : "inactive",
      },
      { status: 403 },
    );
  }

  return { userId };
}
