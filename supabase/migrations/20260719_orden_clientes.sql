-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
-- Agrega un campo de orden manual para que cada cobrador organice sus clientes
-- dentro de una ruta según su recorrido real (no alfabético).

alter table public.clientes add column if not exists orden integer;
create index if not exists clientes_ruta_orden_idx on public.clientes (ruta_id, orden);

-- No requiere cambios de RLS: "clientes" ya usa la política existente de
-- user_id = auth.uid() para select/insert/update/delete.
