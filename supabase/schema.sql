-- ============================================================
-- SORTEO QR - ESQUEMA SUPABASE
-- Ejecuta este archivo completo en Supabase > SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.raffle_settings (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Sorteo',
  registration_opens_at timestamptz,
  registration_closes_at timestamptz not null,
  draw_at timestamptz not null,
  winner_entry_id uuid,
  winner_drawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_before_draw check (registration_closes_at <= draw_at)
);

create table if not exists public.raffle_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  device_id uuid not null,
  created_at timestamptz not null default now(),
  constraint raffle_name_length check (char_length(name) between 2 and 60),
  constraint raffle_name_unique unique (normalized_name),
  constraint raffle_device_unique unique (device_id)
);

alter table public.raffle_settings
  drop constraint if exists raffle_winner_fk;

alter table public.raffle_settings
  add constraint raffle_winner_fk
  foreign key (winner_entry_id)
  references public.raffle_entries(id)
  on delete set null;

-- Ninguna tabla se expone directamente al navegador.
alter table public.raffle_settings enable row level security;
alter table public.raffle_entries enable row level security;

revoke all on table public.raffle_settings from anon, authenticated;
revoke all on table public.raffle_entries from anon, authenticated;

-- ------------------------------------------------------------
-- ESTADO PÚBLICO
-- Solo devuelve datos aptos para mostrarse en la web.
-- ------------------------------------------------------------
create or replace function public.get_public_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.raffle_settings%rowtype;
  winner_name text;
  entry_count bigint;
begin
  select * into s
  from public.raffle_settings
  where id = 1;

  if not found then
    return jsonb_build_object(
      'title', 'Sorteo',
      'registration_opens_at', null,
      'registration_closes_at', null,
      'draw_at', null,
      'entries_count', 0,
      'winner_name', null
    );
  end if;

  select count(*) into entry_count
  from public.raffle_entries;

  if s.winner_entry_id is not null and now() >= s.draw_at then
    select e.name into winner_name
    from public.raffle_entries e
    where e.id = s.winner_entry_id;
  end if;

  return jsonb_build_object(
    'title', s.title,
    'registration_opens_at', s.registration_opens_at,
    'registration_closes_at', s.registration_closes_at,
    'draw_at', s.draw_at,
    'entries_count', entry_count,
    'winner_name', winner_name,
    'winner_drawn_at', s.winner_drawn_at
  );
end;
$$;

-- ------------------------------------------------------------
-- REGISTRO
-- - nombre único ignorando mayúsculas y espacios repetidos
-- - un device_id por navegador/dispositivo
-- - la hora se valida en la base de datos
-- ------------------------------------------------------------
create or replace function public.register_entry(
  p_name text,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.raffle_settings%rowtype;
  clean_name text;
  normalized text;
  new_id uuid;
begin
  select * into s
  from public.raffle_settings
  where id = 1;

  if not found then
    raise exception 'El sorteo todavía no está configurado.';
  end if;

  if s.registration_opens_at is not null and now() < s.registration_opens_at then
    raise exception 'La inscripción todavía no está abierta.';
  end if;

  if now() >= s.registration_closes_at then
    raise exception 'La inscripción ya está cerrada.';
  end if;

  if s.winner_entry_id is not null then
    raise exception 'El sorteo ya ha finalizado.';
  end if;

  clean_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');

  if char_length(clean_name) < 2 or char_length(clean_name) > 60 then
    raise exception 'El nombre debe tener entre 2 y 60 caracteres.';
  end if;

  normalized := lower(clean_name);

  if exists (
    select 1 from public.raffle_entries
    where normalized_name = normalized
  ) then
    raise exception 'Ese nombre ya está registrado.';
  end if;

  if exists (
    select 1 from public.raffle_entries
    where device_id = p_device_id
  ) then
    raise exception 'Este dispositivo ya tiene una papeleta registrada.';
  end if;

  insert into public.raffle_entries (name, normalized_name, device_id)
  values (clean_name, normalized, p_device_id)
  returning id into new_id;

  return jsonb_build_object(
    'ok', true,
    'id', new_id,
    'name', clean_name
  );

exception
  when unique_violation then
    raise exception 'Ese nombre o dispositivo ya tiene una papeleta registrada.';
end;
$$;

-- ------------------------------------------------------------
-- SORTEO
-- Puede llamarlo cualquier visitante, pero la base de datos
-- NO permite sortear antes de draw_at y solo elige una vez.
-- El FOR UPDATE evita dos ganadores si hay llamadas simultáneas.
-- ------------------------------------------------------------
create or replace function public.draw_if_due()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.raffle_settings%rowtype;
  picked_id uuid;
  picked_name text;
begin
  select * into s
  from public.raffle_settings
  where id = 1
  for update;

  if not found then
    raise exception 'El sorteo todavía no está configurado.';
  end if;

  if now() < s.draw_at then
    return jsonb_build_object('ok', false, 'status', 'too_early');
  end if;

  if s.winner_entry_id is not null then
    select name into picked_name
    from public.raffle_entries
    where id = s.winner_entry_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'already_drawn',
      'winner_name', picked_name
    );
  end if;

  select id, name
  into picked_id, picked_name
  from public.raffle_entries
  order by gen_random_uuid()
  limit 1;

  if picked_id is null then
    return jsonb_build_object('ok', false, 'status', 'no_entries');
  end if;

  update public.raffle_settings
  set winner_entry_id = picked_id,
      winner_drawn_at = now(),
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'status', 'drawn',
    'winner_name', picked_name
  );
end;
$$;

-- Solo se accede mediante estas funciones.
revoke all on function public.get_public_state() from public;
revoke all on function public.register_entry(text, uuid) from public;
revoke all on function public.draw_if_due() from public;

grant execute on function public.get_public_state() to anon, authenticated, service_role;
grant execute on function public.register_entry(text, uuid) to anon, authenticated, service_role;
grant execute on function public.draw_if_due() to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- CONFIGURACIÓN DE EJEMPLO
-- IMPORTANTE: cambia estas fechas.
-- timestamptz acepta el offset horario: +02:00 en España peninsular
-- durante horario de verano, +01:00 en horario de invierno.
-- ------------------------------------------------------------
insert into public.raffle_settings (
  id,
  title,
  registration_opens_at,
  registration_closes_at,
  draw_at
)
values (
  1,
  'Sorteo del evento',
  '2026-09-17 09:00:00+02',
  '2026-09-17 19:55:00+02',
  '2026-09-17 20:00:00+02'
)
on conflict (id) do update set
  title = excluded.title,
  registration_opens_at = excluded.registration_opens_at,
  registration_closes_at = excluded.registration_closes_at,
  draw_at = excluded.draw_at,
  winner_entry_id = null,
  winner_drawn_at = null,
  updated_at = now();

-- Para reiniciar participantes entre sorteos:
-- update public.raffle_settings set winner_entry_id = null, winner_drawn_at = null where id = 1;
-- delete from public.raffle_entries;
