-- ============================================================================
-- MORA CON DÍAS DE GRACIA POR PRÉSTAMO
-- ============================================================================
-- Antes el "Recargo por mora estimado" aparecía apenas el cliente quedaba
-- debiendo cualquier monto, sin importar hace cuánto. Ahora cada préstamo
-- puede tener sus propios "días de plazo": el recargo (10% por defecto sobre
-- lo que debe, configurable) solo se calcula y se muestra después de que el
-- atraso supere esos días. Sigue sin cobrarse solo: el cobrador ve el aviso
-- y decide si lo aplica con el botón "Aplicar recargo al saldo" — eso no
-- cambió, solo CUÁNDO aparece el aviso.

alter table public.prestamos add column if not exists interes_mora_dias_gracia integer not null default 0 check (interes_mora_dias_gracia >= 0);

-- El refinanciamiento debe seguir copiando la configuración de mora del
-- crédito anterior (habilitada, %, y ahora también los días de gracia).
-- Se borra primero por si en tu base de datos existía una versión de esta
-- función con un tipo de retorno distinto (de antes de estas migraciones):
-- Postgres no permite cambiarlo con CREATE OR REPLACE, solo agregar/quitar
-- columnas del mismo tipo de retorno.
drop function if exists public.refinanciar_prestamo(bigint, numeric, integer, numeric, date);
create or replace function public.refinanciar_prestamo(p_prestamo_id bigint, p_monto_adicional numeric, p_numero_cuotas integer, p_interes_porcentaje numeric, p_fecha_inicio date default current_date)
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
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, prestamo_anterior_id, user_id, interes_mora_habilitado, interes_mora_porcentaje, interes_mora_dias_gracia)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, 'activo', p_prestamo_id, auth.uid(), v_anterior.interes_mora_habilitado, v_anterior.interes_mora_porcentaje, v_anterior.interes_mora_dias_gracia);
end;
$$;

grant execute on function public.refinanciar_prestamo(bigint, numeric, integer, numeric, date) to authenticated;
