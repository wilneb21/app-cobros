-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Si la tabla caja_diaria ya existía en tu proyecto ANTES de aplicar la
-- migración 20260717 (por ejemplo, la creaste manualmente en algún momento),
-- el "create table if not exists" de esa migración no hizo nada porque la
-- tabla ya estaba — y eso significa que la restricción única (user_id, fecha)
-- nunca se agregó. Sin esa restricción, el "Abrir/Cerrar caja" de la app
-- falla siempre con "No fue posible guardar la caja", porque usa un upsert
-- que depende de ella para saber si debe crear o actualizar la fila del día.
--
-- Este bloque agrega la restricción SOLO si todavía no existe; si ya está,
-- no hace nada (es seguro correrlo aunque no sea tu problema).
do $$
begin
  alter table public.caja_diaria
    add constraint caja_diaria_user_fecha_unica unique (user_id, fecha);
exception
  when duplicate_object then
    raise notice 'La restricción única (user_id, fecha) ya existía en caja_diaria — no se tocó nada.';
end $$;

-- Por si acaso, confirmamos también que RLS esté activo y con su política
-- (esto es exactamente igual a lo que ya hace 20260717; correrlo de nuevo es
-- seguro y no cambia nada si ya estaba bien).
alter table public.caja_diaria enable row level security;
drop policy if exists "Usuarios gestionan su caja diaria" on public.caja_diaria;
create policy "Usuarios gestionan su caja diaria" on public.caja_diaria for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
