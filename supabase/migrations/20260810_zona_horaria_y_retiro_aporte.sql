-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- PARTE 1 — ZONA HORARIA DE COLOMBIA
-- ---------------------------------------------------------------------------
-- Supabase corre la base de datos en UTC por defecto. La app YA calcula bien
-- "hoy" en el navegador (obtenerFechaLocal() usa America/Bogota), pero varias
-- funciones y columnas del lado del servidor usan current_date/now() como
-- valor por defecto (registrar_pago, refinanciar_prestamo, cargos_mora,
-- fecha_desembolso, etc.). Como Bogotá es UTC-5, a las 7pm en Colombia ya es
-- medianoche en UTC — por eso un préstamo creado después de las 7pm podía
-- terminar fechado "mañana" en vez de "hoy".
--
-- Esto pone en hora de Colombia toda la base de datos: current_date, now() y
-- cualquier default que dependa de ellos quedan alineados con lo que ve el
-- cobrador en la app, sin importar la hora a la que registre algo.
alter database postgres set timezone to 'America/Bogota';

-- PARTE 2 — RETIRAR UN APORTE PROPIO SIN BORRARLO
-- ---------------------------------------------------------------------------
-- Hasta ahora "aportes_capital" solo aceptaba montos positivos, y editar o
-- borrar un aporte solo se podía el mismo día que se registró. Pero es común
-- que el cobrador meta plata propia hoy y AL OTRO DÍA quiera sacarla de la
-- caja de nuevo — eso no es "corregir un error de hoy", es un movimiento
-- nuevo que debe quedar registrado aparte, sin tocar ni borrar el aporte
-- original (para no perder el historial de por qué se metió esa plata).
--
-- La solución: permitir montos NEGATIVOS en la misma tabla. Un retiro se
-- guarda como un aporte con monto negativo, fechado el día en que se retira.
-- Como el efectivo esperado ya se calcula sumando todos los aportes del día
-- (base + cobros + aportes − gastos − prestado), un retiro negativo se resta
-- solo, sin tocar nada más.
alter table public.aportes_capital drop constraint if exists aportes_capital_monto_check;
alter table public.aportes_capital add constraint aportes_capital_monto_check check (monto <> 0);
