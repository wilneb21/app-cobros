-- ============================================================================
-- RONDA 2026-07-22: mora automática mensual, domingos/festivos opcionales en
-- cuotas diarias, pagos múltiples el mismo día (con confirmación), y
-- corrección al cierre automático de un préstamo (ahora sí cuenta la mora).
-- ============================================================================

-- --- 1) DÍAS FESTIVOS (para "no contar domingos y festivos" en cuotas diarias) ---
create table if not exists public.dias_festivos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  nota text,
  creado_en timestamptz not null default now(),
  unique (user_id, fecha)
);
alter table public.dias_festivos enable row level security;
drop policy if exists "Usuarios gestionan sus dias festivos" on public.dias_festivos;
create policy "Usuarios gestionan sus dias festivos" on public.dias_festivos for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Cada préstamo decide si sus cuotas DIARIAS cuentan domingos y festivos como
-- día de cuota (comportamiento de siempre, valor por defecto) o si esos días
-- se saltan al calcular cuántas cuotas debería llevar pagadas a hoy.
alter table public.prestamos add column if not exists contar_domingos_festivos boolean not null default true;

-- --- 2) MORA AUTOMÁTICA MENSUAL (reemplaza el botón manual "Aplicar recargo") ---
-- Cuenta cuántos "meses de mora" ya se le aplicaron a cada préstamo, para no
-- volver a aplicar el mismo mes dos veces.
alter table public.prestamos add column if not exists mora_meses_aplicados integer not null default 0;

-- Aplica (sola, sin que nadie toque nada) el recargo por mora de todos los
-- préstamos activos del usuario que ya llevan uno o más MESES completos de
-- atraso desde que se venció su plazo de gracia. Por cada mes nuevo que le
-- correspondía y no se le había aplicado, se suma otro recargo del % del
-- préstamo sobre lo que en ese momento tenía vencido (lo que "quedó
-- debiendo"), igual a como se llevaba a mano en papel: si este mes debe 60 y
-- la mora es 10%, queda en 66; si el mes que viene sigue debiendo esos mismos
-- 60, se le suma otro 10% (6 más) y queda en 72, y así sucesivamente.
create or replace function public.aplicar_mora_automatica()
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_prestamo record;
  v_pagado numeric;
  v_dias_transcurridos integer;
  v_cuotas_esperadas integer;
  v_monto_esperado numeric;
  v_deuda_vencida numeric;
  v_fecha_base date;
  v_meses_correspondientes integer;
  v_meses_nuevos integer;
  v_monto_mora numeric;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;

  for v_prestamo in
    select * from public.prestamos
    where user_id = auth.uid() and estado = 'activo'
      and interes_mora_habilitado and interes_mora_porcentaje > 0
    for update
  loop
    select coalesce(sum(monto_pagado), 0) into v_pagado from public.pagos where prestamo_id = v_prestamo.id;

    v_dias_transcurridos := current_date - v_prestamo.fecha_inicio;
    if v_prestamo.frecuencia = 'diario' then
      v_cuotas_esperadas := v_dias_transcurridos + 1;
    else
      v_cuotas_esperadas := (v_dias_transcurridos / 7) + 1;
    end if;
    v_cuotas_esperadas := least(v_cuotas_esperadas, v_prestamo.numero_cuotas);
    v_monto_esperado := v_cuotas_esperadas * v_prestamo.cuota;
    v_deuda_vencida := greatest(v_monto_esperado - v_pagado, 0);

    if v_deuda_vencida <= 0 then
      continue; -- al día: no hay nada que recargar este mes
    end if;

    v_fecha_base := v_prestamo.fecha_inicio + (coalesce(v_prestamo.interes_mora_dias_gracia, 0) || ' days')::interval;
    if current_date < v_fecha_base then
      continue; -- todavía dentro del plazo de gracia
    end if;

    v_meses_correspondientes := (extract(year from age(current_date, v_fecha_base)) * 12
      + extract(month from age(current_date, v_fecha_base)))::integer + 1;
    v_meses_nuevos := v_meses_correspondientes - coalesce(v_prestamo.mora_meses_aplicados, 0);

    if v_meses_nuevos > 0 then
      v_monto_mora := round(v_deuda_vencida * (v_prestamo.interes_mora_porcentaje / 100)) * v_meses_nuevos;
      update public.prestamos
        set mora_acumulada = coalesce(mora_acumulada, 0) + v_monto_mora,
            mora_meses_aplicados = v_meses_correspondientes
        where id = v_prestamo.id;
      insert into public.cargos_mora (prestamo_id, monto, fecha, user_id)
        values (v_prestamo.id, v_monto_mora, current_date, auth.uid());
    end if;
  end loop;
end;
$$;

grant execute on function public.aplicar_mora_automatica() to authenticated;

-- El refinanciamiento debe seguir copiando la configuración de mora (y ahora
-- también "contar domingos y festivos"), pero el crédito nuevo arranca su
-- conteo de meses de mora en cero.
drop function if exists public.refinanciar_prestamo(bigint, numeric, integer, numeric, date);
create or replace function public.refinanciar_prestamo(p_prestamo_id bigint, p_monto_adicional numeric, p_numero_cuotas integer, p_interes_porcentaje numeric, p_fecha_inicio date default current_date)
returns void language plpgsql security invoker set search_path = public as $$
declare v_anterior public.prestamos; v_pagado numeric; v_saldo numeric; v_monto numeric;
begin
  if auth.uid() is null or p_monto_adicional < 0 or p_numero_cuotas <= 0 or p_interes_porcentaje < 0 then raise exception 'Datos inválidos'; end if;
  select * into v_anterior from public.prestamos where id = p_prestamo_id and user_id = auth.uid() for update;
  if not found or v_anterior.estado <> 'activo' then raise exception 'Préstamo activo no encontrado'; end if;
  select coalesce(sum(monto_pagado), 0) into v_pagado from public.pagos where prestamo_id = p_prestamo_id;
  v_saldo := greatest(v_anterior.monto_prestado * (1 + v_anterior.interes_porcentaje / 100) + coalesce(v_anterior.mora_acumulada, 0) - v_pagado, 0);
  v_monto := round(v_saldo + p_monto_adicional, 0);
  if v_monto <= 0 then raise exception 'No hay saldo para refinanciar'; end if;
  update public.prestamos set estado = 'refinanciado' where id = p_prestamo_id;
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, prestamo_anterior_id, user_id, interes_mora_habilitado, interes_mora_porcentaje, interes_mora_dias_gracia, contar_domingos_festivos)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, 'activo', p_prestamo_id, auth.uid(), v_anterior.interes_mora_habilitado, v_anterior.interes_mora_porcentaje, v_anterior.interes_mora_dias_gracia, coalesce(v_anterior.contar_domingos_festivos, true));
end;
$$;

grant execute on function public.refinanciar_prestamo(bigint, numeric, integer, numeric, date) to authenticated;

-- --- 3) REGISTRAR PAGO: cierre correcto (contando la mora) + pagos múltiples el mismo día ---
-- Antes, un préstamo se marcaba "pagado" apenas lo cobrado llegaba al total
-- capital+interés, SIN mirar si además tenía mora pendiente por cobrar — así
-- que un crédito con mora podía cerrarse solo, "regalando" esa mora. Ahora
-- compara contra el saldo total real (capital + interés + mora aplicada).
-- Además, p_sumar=true permite registrar un pago ADICIONAL sumado al que ya
-- existía ese día (para cuando el cliente paga más de una vez en el mismo
-- día), en vez de reemplazar el valor anterior. El cobrador siempre confirma
-- esto antes desde la app.
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
  if v_total >= (v_prestamo.monto_prestado * (1 + v_prestamo.interes_porcentaje / 100) + coalesce(v_prestamo.mora_acumulada, 0)) then
    update public.prestamos set estado = 'pagado' where id = p_prestamo_id;
  end if;
end;
$$;

grant execute on function public.registrar_pago(bigint, numeric, text, date, boolean) to authenticated;
