-- Ejecutar una sola vez en Supabase SQL Editor. No borra información existente.
-- Agrega el TIPO de identificación del cliente (CC, TI, CE, NIT, PAS), separado
-- del número que ya vivía en la columna "cedula". Todos los clientes que ya
-- existen quedan marcados como CC (Cédula de ciudadanía) por defecto, que es
-- el caso más común; se puede corregir cliente por cliente desde la app.

alter table public.clientes
  add column if not exists tipo_documento text not null default 'CC';

alter table public.clientes
  drop constraint if exists clientes_tipo_documento_valido;
alter table public.clientes
  add constraint clientes_tipo_documento_valido check (tipo_documento in ('CC', 'TI', 'CE', 'NIT', 'PAS'));
