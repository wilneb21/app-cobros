-- IMPORTANTE — léelo antes de correr esto en Supabase:
--
-- La función aplicar_mora_automatica() (migración 20260803) cuenta los
-- "meses de atraso" de un préstamo desde su fecha_inicio original, no desde
-- el día que se instaló esta función. Eso significa que, si tienes créditos
-- que YA llevaban 2, 3, 5 meses atrasados desde antes de este cambio, la
-- primera vez que la app corra la mora automática (al abrir Inicio),
-- intentaría cobrarles de un solo golpe TODOS esos meses acumulados —
-- probablemente no es lo que quieres para la cartera que ya tenías.
--
-- Esta migración "pone en cero" ese arranque: para los créditos activos que
-- ya existían, deja registrado que ya se les "aplicaron" los meses que ya
-- iban corridos hasta HOY (sin sumarles ningún recargo), para que la mora
-- automática empiece a contar y a sumar solo HACIA ADELANTE, mes a mes,
-- desde ahora. No toca mora_acumulada — no borra ni agrega ningún recargo
-- que ya tuvieran; solo evita el golpe retroactivo del primer cálculo.
--
-- Ejecuta esto UNA SOLA VEZ, idealmente el mismo día que instalas la
-- migración 20260803 y ANTES de abrir la app (para que no alcance a
-- correr la mora automática con el conteo en 0). Si ya la abriste y ya se
-- aplicó una mora retroactiva que no querías, avísame y te paso la consulta
-- para revertir esos cargos puntuales de cargos_mora.
update public.prestamos
set mora_meses_aplicados = greatest(
  (extract(year from age(current_date, fecha_inicio + (coalesce(interes_mora_dias_gracia, 0) || ' days')::interval)) * 12
   + extract(month from age(current_date, fecha_inicio + (coalesce(interes_mora_dias_gracia, 0) || ' days')::interval)))::integer + 1,
  0)
where estado = 'activo'
  and interes_mora_habilitado
  and interes_mora_porcentaje > 0
  and mora_meses_aplicados = 0
  and current_date >= fecha_inicio + (coalesce(interes_mora_dias_gracia, 0) || ' days')::interval;
