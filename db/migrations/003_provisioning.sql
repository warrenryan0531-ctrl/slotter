-- Slotter v2 · E3 — no-SQL provisioning. Guarded SECURITY DEFINER RPCs so owners/admins can
-- manage services, intake questions, staff, and (admin) tenants from the UI. Additive.

-- Upsert a service (insert when p_id is null, else update). Tenant-scoped, guarded.
create or replace function bh_upsert_service(
  p_tenant_id uuid, p_id uuid, p_name text, p_description text, p_duration_min int,
  p_buffer_before_min int, p_buffer_after_min int, p_price_cents int, p_kind text, p_location_mode text,
  p_booking_mode text, p_deposit_cents int, p_requires_payment boolean,
  p_is_group boolean, p_capacity int, p_active boolean, p_sort int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if p_kind not in ('call','appointment','onsite') then raise exception 'bad kind %', p_kind; end if;
  if p_location_mode not in ('phone','address','business') then raise exception 'bad location %', p_location_mode; end if;
  if p_booking_mode not in ('instant','request') then raise exception 'bad booking_mode %', p_booking_mode; end if;
  if p_duration_min <= 0 then raise exception 'duration must be > 0'; end if;
  if p_id is null then
    insert into bh_services (tenant_id, name, description, duration_min, buffer_before_min, buffer_after_min,
      price_cents, kind, location_mode, booking_mode, deposit_cents, requires_payment, is_group, capacity, active, sort)
    values (p_tenant_id, p_name, p_description, p_duration_min, p_buffer_before_min, p_buffer_after_min,
      p_price_cents, p_kind, p_location_mode, p_booking_mode, p_deposit_cents, coalesce(p_requires_payment,false),
      coalesce(p_is_group,false), greatest(coalesce(p_capacity,1),1), coalesce(p_active,true), coalesce(p_sort,0))
    returning id into v_id;
  else
    update bh_services set name=p_name, description=p_description, duration_min=p_duration_min,
      buffer_before_min=p_buffer_before_min, buffer_after_min=p_buffer_after_min, price_cents=p_price_cents,
      kind=p_kind, location_mode=p_location_mode, booking_mode=p_booking_mode, deposit_cents=p_deposit_cents,
      requires_payment=coalesce(p_requires_payment,false), is_group=coalesce(p_is_group,false),
      capacity=greatest(coalesce(p_capacity,1),1), active=coalesce(p_active,true), sort=coalesce(p_sort,0)
    where id=p_id and tenant_id=p_tenant_id returning id into v_id;
    if v_id is null then raise exception 'service not found for tenant'; end if;
  end if;
  return v_id;
end $$;

create or replace function bh_delete_service(p_tenant_id uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  delete from bh_services where id=p_id and tenant_id=p_tenant_id;
  return found;
end $$;

-- Intake questions: upsert + delete, verified to belong to a service in this tenant.
create or replace function bh_upsert_intake_question(
  p_tenant_id uuid, p_id uuid, p_service_id uuid, p_label text, p_type text, p_options jsonb, p_required boolean, p_sort int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if not exists (select 1 from bh_services where id=p_service_id and tenant_id=p_tenant_id) then raise exception 'service not in tenant'; end if;
  if p_type not in ('text','textarea','select','phone','address') then raise exception 'bad type %', p_type; end if;
  if p_id is null then
    insert into bh_intake_questions (service_id, label, type, options, required, sort)
    values (p_service_id, p_label, p_type, p_options, coalesce(p_required,false), coalesce(p_sort,0)) returning id into v_id;
  else
    update bh_intake_questions set label=p_label, type=p_type, options=p_options, required=coalesce(p_required,false), sort=coalesce(p_sort,0)
    where id=p_id and service_id=p_service_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function bh_delete_intake_question(p_tenant_id uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  delete from bh_intake_questions q using bh_services s
   where q.id=p_id and q.service_id=s.id and s.tenant_id=p_tenant_id;
  return found;
end $$;

-- Staff: upsert + (soft) deactivate; assign a staff set to a service.
create or replace function bh_upsert_staff(
  p_tenant_id uuid, p_id uuid, p_name text, p_email text, p_is_owner boolean, p_active boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if p_id is null then
    insert into bh_staff (tenant_id, name, email, is_owner, active)
    values (p_tenant_id, p_name, p_email, coalesce(p_is_owner,false), coalesce(p_active,true)) returning id into v_id;
  else
    update bh_staff set name=p_name, email=p_email, is_owner=coalesce(p_is_owner,false), active=coalesce(p_active,true)
    where id=p_id and tenant_id=p_tenant_id returning id into v_id;
    if v_id is null then raise exception 'staff not found for tenant'; end if;
  end if;
  return v_id;
end $$;

create or replace function bh_assign_service_staff(p_tenant_id uuid, p_service_id uuid, p_staff_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  if not exists (select 1 from bh_services where id=p_service_id and tenant_id=p_tenant_id) then raise exception 'service not in tenant'; end if;
  delete from bh_service_staff where service_id=p_service_id;
  insert into bh_service_staff (service_id, staff_id)
    select p_service_id, s.id from bh_staff s where s.tenant_id=p_tenant_id and s.id = any(p_staff_ids);
end $$;

-- Admin: create a tenant (agency edition). Slug uniqueness enforced by the table.
create or replace function bh_create_tenant(p_slug text, p_name text, p_tz text, p_owner_name text, p_owner_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_sid uuid;
begin
  perform bh_guard();
  insert into bh_tenants (slug, name, tz, ics_token)
    values (lower(trim(p_slug)), p_name, coalesce(p_tz,'America/New_York'), gen_random_uuid()::text)
    returning id into v_tid;
  insert into bh_staff (tenant_id, name, email, is_owner)
    values (v_tid, coalesce(p_owner_name,'Owner'), lower(trim(p_owner_email)), true) returning id into v_sid;
  -- default Mon–Fri 9–5 so the owner can book immediately
  insert into bh_availability_rules (staff_id, weekday, start_min, end_min)
    select v_sid, wd, 540, 1020 from generate_series(1,5) wd;
  return v_tid;
end $$;
