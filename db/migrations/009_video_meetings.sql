-- B1: video meeting links. Allow a 'video' service location mode and store the provider-minted
-- join link (Google Meet / MS Teams) on the booking so reminders can include it.
alter table bh_services drop constraint if exists bh_services_location_mode_check;
alter table bh_services add constraint bh_services_location_mode_check
  check (location_mode in ('phone','address','business','video'));

alter table bh_bookings add column if not exists meeting_url text;

-- Widen the provisioning RPC guard to accept 'video'.
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
  if p_location_mode not in ('phone','address','business','video') then raise exception 'bad location %', p_location_mode; end if;
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
