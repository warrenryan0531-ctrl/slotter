-- ============================================================
-- v2 · B5 — file upload on intake (added 2026-08).
-- An intake question can be type 'file'; the customer uploads a photo/PDF at booking. Files live in
-- a PRIVATE Supabase Storage bucket; the answer stored on the booking is a pointer, and the owner
-- reads it back through a short-lived signed URL. No card, no PCI, no public exposure.
-- ============================================================

-- 0) Lock the slug invariant the file-download isolation relies on: a tenant slug is the first
--    path segment of every stored object, and /api/intake/file gates on `path startsWith slug + "/"`.
--    Enforce slug charset at the DB so an admin-created slug can never contain a '/'.
alter table bh_tenants drop constraint if exists bh_tenants_slug_charset;
alter table bh_tenants add constraint bh_tenants_slug_charset check (slug ~ '^[a-z0-9-]+$');

-- 1) Allow the 'file' intake question type — both the table CHECK and the upsert RPC guard.
alter table bh_intake_questions drop constraint if exists bh_intake_questions_type_check;
alter table bh_intake_questions add constraint bh_intake_questions_type_check
  check (type in ('text','textarea','select','phone','address','file'));

create or replace function bh_upsert_intake_question(
  p_tenant_id uuid, p_id uuid, p_service_id uuid, p_label text, p_type text, p_options jsonb, p_required boolean, p_sort int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if not exists (select 1 from bh_services where id=p_service_id and tenant_id=p_tenant_id) then raise exception 'service not in tenant'; end if;
  if p_type not in ('text','textarea','select','phone','address','file') then raise exception 'bad type %', p_type; end if;
  if p_id is null then
    insert into bh_intake_questions (service_id, label, type, options, required, sort)
    values (p_service_id, p_label, p_type, p_options, coalesce(p_required,false), coalesce(p_sort,0)) returning id into v_id;
  else
    update bh_intake_questions set label=p_label, type=p_type, options=p_options, required=coalesce(p_required,false), sort=coalesce(p_sort,0)
    where id=p_id and service_id=p_service_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- 2) Private storage bucket (run via the storage admin API / MCP, shown here for the record):
--   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   values ('intake','intake', false, 10485760,
--           array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);
--
-- 3) Storage RLS — the app uses the server-only anon key (SUPABASE_ANON_KEY is NOT NEXT_PUBLIC);
--    customers/owners only ever receive scoped, time-limited signed URLs:
--   create policy "intake anon insert" on storage.objects for insert to anon with check (bucket_id = 'intake');
--   create policy "intake anon select" on storage.objects for select to anon using (bucket_id = 'intake');
