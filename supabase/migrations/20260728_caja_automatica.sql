-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Agrega la preferencia "cuadre automático de caja": cuando está activada,
-- la app ya no te pide contar el efectivo físico ni tocar "Abrir caja" cada
-- mañana — calcula sola la base del día (base de ayer + cobros + aportes -
-- gastos - prestado) y sigue así, día tras día, sin intervención. Ver
-- js/main.js (cargarCajaDiaria) para el detalle.
alter table public.preferencias_usuario add column if not exists caja_automatica boolean not null default false;
