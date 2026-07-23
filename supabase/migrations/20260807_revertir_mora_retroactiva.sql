-- ============================================================================
-- REVERTIR TODA LA MORA AUTOMÁTICA MAL APLICADA (no solo la de hoy)
--
-- La migración 20260806_mora_manual.sql solo revirtió los cargos con
-- fecha = current_date. Pero el error de aplicar_mora_automatica() (no
-- respetaba "no contar domingos y festivos") llevaba corriendo desde antes,
-- así que puede haber cargos de días anteriores con el mismo problema.
--
-- Este bloque revierte TODOS los cargos de cargos_mora que pertenezcan a
-- préstamos diarios con contar_domingos_festivos = false — el criterio
-- exacto del error, sin importar la fecha del cargo ni de qué cuenta/negocio
-- sea el préstamo. Los préstamos que sí cuentan domingos y festivos
-- normalmente no se tocan: para esos, aplicar_mora_automatica() siempre
-- contó los días bien.
-- ============================================================================
do $$
declare
  v_cargo record;
begin
  for v_cargo in
    select cm.*
    from public.cargos_mora cm
    join public.prestamos p on p.id = cm.prestamo_id
    where p.frecuencia = 'diario' and p.contar_domingos_festivos = false
  loop
    update public.prestamos
      set mora_acumulada = greatest(coalesce(mora_acumulada, 0) - v_cargo.monto, 0)
      where id = v_cargo.prestamo_id;
  end loop;

  delete from public.cargos_mora cm
  using public.prestamos p
  where p.id = cm.prestamo_id
    and p.frecuencia = 'diario' and p.contar_domingos_festivos = false;
end $$;
