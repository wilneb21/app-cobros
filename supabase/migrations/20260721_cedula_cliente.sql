-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
-- Agrega el número de cédula (o documento de identidad) al registro del cliente.

alter table public.clientes add column if not exists cedula text;
create index if not exists clientes_cedula_idx on public.clientes (cedula);

-- No requiere cambios de RLS: "clientes" ya usa la política existente de
-- user_id = auth.uid() para select/insert/update/delete.
