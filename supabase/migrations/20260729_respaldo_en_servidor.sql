-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Antes, la fecha del "último respaldo descargado" se guardaba en localStorage,
-- es decir en el celular. Si el cobrador cambiaba de celular o lo formateaba,
-- la app "olvidaba" que ya había hecho respaldos y volvía a mostrar el aviso
-- de "nunca has respaldado" aunque sí lo hubiera hecho antes.
--
-- Esta migración agrega una columna en preferencias_usuario (que ya vive en
-- Supabase, no en el celular) para que ese dato sobreviva a un cambio de
-- dispositivo, igual que el resto de la información del negocio.

alter table public.preferencias_usuario add column if not exists ultimo_respaldo date;
