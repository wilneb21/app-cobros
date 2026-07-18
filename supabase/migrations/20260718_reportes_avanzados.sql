-- Ejecutar una sola vez en Supabase SQL Editor, después de la migración anterior.
-- Agrega una función para reconstruir el tamaño de la cartera activa en cualquier
-- fecha pasada, usando únicamente los datos que ya existen (sin tablas nuevas).

create or replace function public.cartera_activa_en_fecha(p_fecha date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(pr.monto_prestado * (1 + pr.interes_porcentaje / 100)), 0)
       - coalesce((
           select sum(pg.monto_pagado)
           from public.pagos pg
           join public.prestamos pr2 on pr2.id = pg.prestamo_id
           where pg.fecha_pago <= p_fecha
         ), 0)
  from public.prestamos pr
  where pr.fecha_inicio <= p_fecha;
$$;

-- security invoker: la función corre con los permisos de quien la llama, así que
-- las políticas RLS de "prestamos" y "pagos" (user_id = auth.uid()) se aplican
-- igual que si el usuario consultara las tablas directamente. Nadie puede ver
-- la cartera de otro usuario a través de esta función.

grant execute on function public.cartera_activa_en_fecha(date) to authenticated;
