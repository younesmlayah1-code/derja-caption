import { supabase } from "@/integrations/supabase/client";

/**
 * fetch() that attaches the current Supabase user's bearer token so
 * server-side `/api/*` routes can authenticate the call.
 */
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
