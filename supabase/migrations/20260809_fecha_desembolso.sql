-- ============================================================================
-- SEPARAR "FECHA DE DESEMBOLSO" DE "FECHA DE PRIMERA CUOTA"
-- ============================================================================
-- Hasta ahora, la caja diaria usaba fecha_inicio (la fecha de la PRIMERA
-- CUOTA, que en el formulario viene puesta en "mañana" por defecto) para
-- decidir en qué día restar el efectivo prestado. Eso hacía que un préstamo
-- entregado HOY apareciera restado en la caja de MAÑANA, sin que nadie lo
-- notara — parecía que la caja de hoy "no cambiaba".
--
-- Esta migración agrega una columna nueva, fecha_desembolso, que representa
-- el día en que REALMENTE sale el efectivo de la mano del cobrador. De aquí
-- en adelante la app la usa para todo lo relacionado con caja y reportes de
-- efectivo prestado, dejando fecha_inicio únicamente para el cronograma de
-- cuotas (cuándo debe pagar el cliente).
--
-- Para los préstamos que ya existen no hay forma de saber con certeza qué
-- día salió el efectivo, así que se usa fecha_inicio como mejor estimado
-- (que es exactamente lo que la caja ya venía asumiendo hasta hoy) — esto
-- no cambia ningún cálculo de caja ya hecho en el pasado.
-- ============================================================================

alter table public.prestamos
  add column if not exists fecha_desembolso date;

update public.prestamos
set fecha_desembolso = fecha_inicio
where fecha_desembolso is null;

alter table public.prestamos
  alter column fecha_desembolso set default current_date,
  alter column fecha_desembolso set not null;

-- La refinanciación siempre desembolsa el mismo día en que se hace (ya
-- manda fecha_inicio = hoy desde la app), así que solo hace falta que la
-- función también guarde ese mismo día como fecha_desembolso.
create or replace function public.refinanciar_prestamo(p_prestamo_id bigint, p_monto_adicional numeric, p_numero_cuotas integer, p_interes_porcentaje numeric, p_fecha_inicio date default current_date, p_fecha_desembolso date default current_date)
returns void language plpgsql security invoker set search_path = public as $$
declare v_anterior public.prestamos; v_pagado numeric; v_saldo numeric; v_monto numeric;
begin
  if auth.uid() is null or p_monto_adicional < 0 or p_numero_cuotas <= 0 or p_interes_porcentaje < 0 then raise exception 'Datos inválidos'; end if;
  select * into v_anterior from public.prestamos where id = p_prestamo_id and user_id = auth.uid() for update;
  if not found or v_anterior.estado <> 'activo' then raise exception 'Préstamo activo no encontrado'; end if;
  select coalesce(sum(monto_pagado), 0) into v_pagado from public.pagos where prestamo_id = p_prestamo_id;
  v_saldo := greatest(v_anterior.monto_prestado * (1 + v_anterior.interes_porcentaje / 100) - v_pagado, 0);
  v_monto := round(v_saldo + p_monto_adicional, 0);
  if v_monto <= 0 then raise exception 'No hay saldo para refinanciar'; end if;
  update public.prestamos set estado = 'refinanciado' where id = p_prestamo_id;
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, fecha_desembolso, estado, prestamo_anterior_id, user_id, interes_mora_habilitado, interes_mora_porcentaje)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, p_fecha_desembolso, 'activo', p_prestamo_id, auth.uid(), v_anterior.interes_mora_habilitado, v_anterior.interes_mora_porcentaje);
end;
$$;

grant execute on function public.refinanciar_prestamo(bigint, numeric, integer, numeric, date, date) to authenticated;
