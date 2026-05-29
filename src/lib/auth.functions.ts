import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ADMIN_EMAIL = "admin@derja.app";
const ADMIN_PASSWORD = "Youyou2010@1";

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("email, plan, active").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    return {
      userId,
      email: profile?.email ?? "",
      plan: (profile?.plan as "free" | "pro") ?? "free",
      active: !!profile?.active,
      isAdmin,
    };
  });

export const ensureAdminBootstrap = createServerFn({ method: "POST" }).handler(async () => {
  // Idempotent: ensure admin user exists + has admin role.
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw new Error(listErr.message);
  let adminUser = list.users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL);
  if (!adminUser) {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (createErr) throw new Error(createErr.message);
    adminUser = created.user!;
  }
  // Ensure profile (trigger should have created it, but be safe).
  await supabaseAdmin
    .from("profiles")
    .upsert({ id: adminUser.id, email: ADMIN_EMAIL, plan: "pro", active: true }, { onConflict: "id" });
  // Ensure admin role.
  await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: adminUser.id, role: "admin" }, { onConflict: "user_id,role" });
  return { email: ADMIN_EMAIL };
});

async function assertAdmin(supabase: typeof supabaseAdmin, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin only");
}

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(supabaseAdmin, context.userId);
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, plan, active, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        plan: z.enum(["free", "pro"]).optional(),
        active: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(supabaseAdmin, context.userId);
    const patch: { plan?: "free" | "pro"; active?: boolean } = {};
    if (data.plan !== undefined) patch.plan = data.plan;
    if (data.active !== undefined) patch.active = data.active;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(supabaseAdmin, context.userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const MANAGED = ["GROQ_API_KEY", "LOVABLE_API_KEY", "RAPIDAPI_KEY"] as const;
type ManagedKey = (typeof MANAGED)[number];

export const adminListSecrets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(supabaseAdmin, context.userId);
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key, value, updated_at")
      .in("key", MANAGED as unknown as string[]);
    const rows = (data ?? []) as { key: string; value: string; updated_at: string }[];
    const map = new Map(rows.map((r) => [r.key, r]));
    return MANAGED.map((k) => {
      const r = map.get(k);
      const overrideValue = r?.value ?? "";
      const envSet = !!(process.env[k] && process.env[k]!.trim());
      return {
        key: k,
        hasOverride: !!overrideValue,
        masked: overrideValue ? mask(overrideValue) : envSet ? "(using env value)" : "(not set)",
        updatedAt: r?.updated_at ?? null,
        envSet,
      };
    });
  });

export const adminUpdateSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        key: z.enum(MANAGED),
        value: z.string().max(24576),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(supabaseAdmin, context.userId);
    const trimmed = data.value.trim();
    if (!trimmed) {
      // empty = clear override -> fallback to env
      const { error } = await supabaseAdmin.from("app_settings").delete().eq("key", data.key);
      if (error) throw new Error(error.message);
      return { ok: true, cleared: true };
    }
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: data.key, value: trimmed }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function mask(v: string): string {
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(Math.max(4, v.length - 8))}${v.slice(-4)}`;
}

export type ManagedSecretKey = ManagedKey;
