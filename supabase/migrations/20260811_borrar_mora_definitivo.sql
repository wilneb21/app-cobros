-- Ejecutar en Supabase SQL Editor, después de 20260808_quitar_mora.sql.
--
-- La migración 20260808 apagó la mora (funciones y datos en 0) pero dejó la
-- tabla cargos_mora y las columnas de prestamos por si hacía falta revisar
-- el historial más adelante. Ya se confirmó que no se usa para nada, así
-- que aquí se borra todo del todo:
--
-- 1) Se borra la tabla cargos_mora completa (con su índice y políticas).
-- 2) Se quitan de "prestamos" las columnas de mora: interes_mora_habilitado,
--    interes_mora_porcentaje, interes_mora_dias_gracia, mora_meses_aplicados,
--    mora_acumulada.
-- 3) Como registrar_pago() y refinanciar_prestamo() todavía mencionaban esas
--    columnas (para sumar mora_acumulada al saldo y para copiar la
--    configuración de mora al refinanciar), se vuelven a crear sin esa parte
--    — si no, esta migración rompería esas dos funciones.
-- ============================================================================

drop table if exists public.cargos_mora;

alter table public.prestamos
  drop column if exists interes_mora_habilitado,
  drop column if exists interes_mora_porcentaje,
  drop column if exists interes_mora_dias_gracia,
  drop column if exists mora_meses_aplicados,
  drop column if exists mora_acumulada;

create or replace function public.registrar_pago(p_prestamo_id bigint, p_monto_pagado numeric, p_estado text, p_fecha_pago date default current_date, p_sumar boolean default false)
returns void language plpgsql security invoker set search_path = public as $$
declare v_prestamo public.prestamos; v_total numeric; v_existente public.pagos; v_monto_final numeric; v_estado_final text;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_estado not in ('pago', 'parcial', 'no_pago') or p_monto_pagado < 0 or (p_estado <> 'no_pago' and p_monto_pagado <= 0) then raise exception 'Pago inválido'; end if;
  select * into v_prestamo from public.prestamos where id = p_prestamo_id and user_id = auth.uid() for update;
  if not found or v_prestamo.estado <> 'activo' then raise exception 'Préstamo activo no encontrado'; end if;

  select * into v_existente from public.pagos where prestamo_id = p_prestamo_id and fecha_pago = p_fecha_pago;

  if p_sumar and found then
    v_monto_final := v_existente.monto_pagado + p_monto_pagado;
    v_estado_final := case when p_estado = 'pago' or v_existente.estado = 'pago' then 'pago' else p_estado end;
  else
    v_monto_final := p_monto_pagado;
    v_estado_final := p_estado;
  end if;

  insert into public.pagos (prestamo_id, fecha_pago, monto_pagado, estado, user_id)
  values (p_prestamo_id, p_fecha_pago, v_monto_final, v_estado_final, auth.uid())
  on conflict (prestamo_id, fecha_pago) do update set monto_pagado = excluded.monto_pagado, estado = excluded.estado;

  select coalesce(sum(monto_pagado), 0) into v_total from public.pagos where prestamo_id = p_prestamo_id;
  if v_total >= (v_prestamo.monto_prestado * (1 + v_prestamo.interes_porcentaje / 100)) then
    update public.prestamos set estado = 'pagado' where id = p_prestamo_id;
  end if;
end;
$$;

grant execute on function public.registrar_pago(bigint, numeric, text, date, boolean) to authenticated;

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
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, fecha_desembolso, estado, prestamo_anterior_id, user_id)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, p_fecha_desembolso, 'activo', p_prestamo_id, auth.uid());
end;
$$;

grant execute on function public.refinanciar_prestamo(bigint, numeric, integer, numeric, date, date) to authenticated;
