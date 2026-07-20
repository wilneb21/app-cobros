-- Ejecutar en Supabase SQL Editor.
--
-- El error "Could not find the 'base_inicial' column of 'caja_diaria' in the
-- schema cache" confirma que la tabla caja_diaria YA EXISTÍA en tu proyecto
-- antes de correr la migración 20260717 (con otra estructura, o vacía), así
-- que "create table if not exists" no le agregó las columnas que la app
-- necesita. Este bloque las agrega solo si faltan, sin borrar nada de lo que
-- ya tengas en esa tabla.

alter table public.caja_diaria add column if not exists base_inicial numeric not null default 0;
alter table public.caja_diaria add column if not exists efectivo_final numeric;
alter table public.caja_diaria add column if not exists fecha date;
alter table public.caja_diaria add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.caja_diaria add column if not exists creado_en timestamptz not null default now();

-- Restricciones básicas: solo se agregan si todavía no existen (si ya
-- estaban, esto simplemente avisa y sigue, no falla).
do $$
begin
  alter table public.caja_diaria add constraint caja_diaria_base_no_negativa check (base_inicial >= 0);
exception when duplicate_object then
  raise notice 'La restricción de base_inicial >= 0 ya existía.';
end $$;

do $$
begin
  alter table public.caja_diaria add constraint caja_diaria_final_no_negativo check (efectivo_final >= 0);
exception when duplicate_object then
  raise notice 'La restricción de efectivo_final >= 0 ya existía.';
end $$;

do $$
begin
  alter table public.caja_diaria add constraint caja_diaria_user_fecha_unica unique (user_id, fecha);
exception when duplicate_object then
  raise notice 'La restricción única (user_id, fecha) ya existía.';
end $$;

alter table public.caja_diaria enable row level security;
drop policy if exists "Usuarios gestionan su caja diaria" on public.caja_diaria;
create policy "Usuarios gestionan su caja diaria" on public.caja_diaria for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Le avisa a Supabase que refresque YA su caché de columnas/tablas, para no
-- tener que esperar a que lo haga sola (puede tardar hasta 1 minuto).
notify pgrst, 'reload schema';
