import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MANAGED_SECRETS = [
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "LOVABLE_API_KEY",
  "RAPIDAPI_KEY",
  "SHOTSTACK_API_KEY",
] as const;
export type ManagedSecret = (typeof MANAGED_SECRETS)[number];

/** Returns the override stored in app_settings, or undefined if none set. */
async function getOverride(key: ManagedSecret): Promise<string | undefined> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const v = (data as { value?: string } | null)?.value;
  return v && v.trim() ? v.trim() : undefined;
}

/** DB override wins; falls back to process.env. */
export async function getSecret(key: ManagedSecret): Promise<string | undefined> {
  const override = await getOverride(key);
  if (override) return override;
  const env = process.env[key];
  return env && env.trim() ? env.trim() : undefined;
}
