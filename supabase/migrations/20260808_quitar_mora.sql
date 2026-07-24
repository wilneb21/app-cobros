-- ============================================================================
-- QUITAR LA MORA POR COMPLETO (recargo por atraso)
-- ============================================================================
-- La app ya no tiene ningún botón, campo ni pantalla de mora — este cambio
-- hace lo mismo del lado de la base de datos:
--
-- 1) Revierte la mora que ya estaba aplicada: resta mora_acumulada del saldo
--    de cada préstamo (queda en 0, como si nunca se hubiera aplicado) y
--    borra el historial de cargos_mora. Ningún cliente sigue debiendo mora
--    después de correr esto.
-- 2) Apaga la mora en todos los préstamos (activos, pagados, refinanciados),
--    para que ningún crédito —viejo o nuevo— vuelva a calificar para el
--    recargo, ni siquiera al refinanciar (refinanciar_prestamo copiaba esta
--    configuración del crédito anterior).
-- 3) Retira las funciones de mora (automática, manual y la más vieja de
--    "recargo"): ya no las llama nada en el código, así que no hace falta
--    dejarlas instaladas.
--
-- NO se borran la columna mora_acumulada ni la tabla cargos_mora — se dejan
-- en la base de datos, en 0 y vacía, por si algún día hace falta revisar el
-- historial de lo que se llegó a cobrar. Si en algún momento quieres
-- borrarlas del todo, dímelo y armamos esa migración aparte.
-- ============================================================================

-- --- 1) Revertir mora ya aplicada ---
update public.prestamos
set mora_acumulada = 0
where mora_acumulada > 0;

delete from public.cargos_mora;

-- --- 2) Apagar la mora para todos los préstamos ---
update public.prestamos
set interes_mora_habilitado = false,
    interes_mora_porcentaje = 0,
    interes_mora_dias_gracia = 0,
    mora_meses_aplicados = 0
where interes_mora_habilitado
   or coalesce(interes_mora_porcentaje, 0) > 0
   or coalesce(interes_mora_dias_gracia, 0) > 0
   or coalesce(mora_meses_aplicados, 0) > 0;

-- --- 3) Retirar las funciones de mora (ya sin uso en el código) ---
drop function if exists public.aplicar_mora_automatica();
drop function if exists public.aplicar_mora_manual(bigint, numeric);
drop function if exists public.aplicar_recargo_mora(bigint, numeric);
