-- ============================================================================
-- LA MORA VUELVE A SER MANUAL (adiós a la mora automática mensual de la
-- migración 20260803)
--
-- Qué pasó: aplicar_mora_automatica() (20260803) contaba los "días
-- transcurridos" de un préstamo diario como TODOS los días del calendario,
-- sin importar que el préstamo tuviera activado "no contar domingos y
-- festivos". Esa opción sí la respeta el resto de la app (la pantalla de
-- Cobrar, el saldo, etc.), así que un cliente al día según la app podía
-- de todos modos recibir un recargo de mora automático el mismo día que
-- pagaba, porque la función de mora lo seguía contando como atrasado.
--
-- La solución no es "enseñarle domingos y festivos" a esa función — es
-- quitar el piloto automático. La mora vuelve a ser una decisión manual del
-- cobrador: cuando un cliente lleva atrasado los días que tú configuraste en
-- ese préstamo (por defecto 30), aparece un botón para aplicarla, con el
-- monto ya calculado con el % que tú pusiste. Nada se cobra solo.
-- ============================================================================

-- --- 1) REVERTIR LA MORA APLICADA HOY POR EL ERROR ---
-- Solo toca los cargos de HOY (fecha = current_date): les resta su monto a
-- mora_acumulada del préstamo correspondiente y borra el registro. No toca
-- ningún cargo de mora de días anteriores.
--
-- IMPORTANTE: ejecuta esto el MISMO DÍA en que notaste el problema. Si ya
-- pasó a otro día, dime la fecha exacta (o el préstamo/cliente afectado) y
-- te paso la consulta ajustada — no la corras a ciegas con otra fecha.
do $$
declare
  v_cargo record;
begin
  for v_cargo in select * from public.cargos_mora where fecha = current_date loop
    update public.prestamos
      set mora_acumulada = greatest(coalesce(mora_acumulada, 0) - v_cargo.monto, 0)
      where id = v_cargo.prestamo_id;
  end loop;
  delete from public.cargos_mora where fecha = current_date;
end $$;

-- --- 2) NUEVA FUNCIÓN: APLICAR MORA A MANO ---
-- El cobrador la dispara desde el botón "Aplicar mora" de un crédito
-- atrasado. El monto lo calcula y confirma la app (con el % y los días que
-- tiene configurados ESE préstamo), aquí solo se valida la sesión, que el
-- préstamo sea del usuario y esté activo, y se guarda el cargo.
create or replace function public.aplicar_mora_manual(p_prestamo_id bigint, p_monto numeric)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_prestamo public.prestamos;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_monto <= 0 then raise exception 'El monto de mora debe ser mayor a 0'; end if;

  select * into v_prestamo from public.prestamos where id = p_prestamo_id and user_id = auth.uid() for update;
  if not found or v_prestamo.estado <> 'activo' then raise exception 'Préstamo activo no encontrado'; end if;

  update public.prestamos
    set mora_acumulada = coalesce(mora_acumulada, 0) + p_monto
    where id = p_prestamo_id;

  insert into public.cargos_mora (prestamo_id, monto, fecha, user_id)
    values (p_prestamo_id, p_monto, current_date, auth.uid());
end;
$$;

grant execute on function public.aplicar_mora_manual(bigint, numeric) to authenticated;

-- --- 3) aplicar_mora_automatica() queda instalada pero SIN USO ---
-- La app ya no la llama (ver js/supabase-config.js e js/inicio.js). La
-- dejamos en la base de datos sin tocar por si en algún momento quieres
-- revisar su historial de cargos_mora ya generados; no hace falta borrarla
-- para que el nuevo flujo manual funcione.
