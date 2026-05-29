
-- Fix mutable search_path on touch_updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- Restrict EXECUTE on trigger-only functions
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- has_role: keep callable by authenticated (needed inline in policies), revoke from anon
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
