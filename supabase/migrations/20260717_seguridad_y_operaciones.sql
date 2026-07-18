-- Ejecutar una sola vez en Supabase SQL Editor. No borra información existente.

create unique index if not exists pagos_un_pago_por_dia on public.pagos (prestamo_id, fecha_pago);
create index if not exists pagos_prestamo_fecha_idx on public.pagos (prestamo_id, fecha_pago desc);
create index if not exists prestamos_cliente_estado_idx on public.prestamos (cliente_id, estado);
create index if not exists gastos_fecha_idx on public.gastos (fecha desc);

alter table public.pagos add constraint pagos_estado_valido check (estado in ('pago', 'parcial', 'no_pago'));
alter table public.pagos add constraint pagos_monto_no_negativo check (monto_pagado >= 0);
alter table public.prestamos add constraint prestamos_monto_positivo check (monto_prestado > 0);
alter table public.prestamos add constraint prestamos_cuotas_positivas check (numero_cuotas > 0);
alter table public.gastos add constraint gastos_monto_positivo check (monto > 0);

create table if not exists public.caja_diaria (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  base_inicial numeric not null default 0 check (base_inicial >= 0),
  efectivo_final numeric check (efectivo_final >= 0),
  creado_en timestamptz not null default now(),
  unique (user_id, fecha)
);
alter table public.caja_diaria enable row level security;
drop policy if exists "Usuarios gestionan su caja diaria" on public.caja_diaria;
create policy "Usuarios gestionan su caja diaria" on public.caja_diaria for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.pagos_auditoria (
  id bigint generated always as identity primary key,
  pago_id bigint not null,
  accion text not null check (accion in ('INSERT', 'UPDATE')),
  valor_anterior jsonb,
  valor_nuevo jsonb not null,
  realizado_por uuid not null,
  creado_en timestamptz not null default now()
);
alter table public.pagos_auditoria enable row level security;
drop policy if exists "Usuarios ven su auditoria de pagos" on public.pagos_auditoria;
create policy "Usuarios ven su auditoria de pagos" on public.pagos_auditoria for select using (realizado_por = auth.uid());

create or replace function public.auditar_pago() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pagos_auditoria (pago_id, accion, valor_anterior, valor_nuevo, realizado_por)
  values (new.id, tg_op, case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new), auth.uid());
  return new;
end;
$$;
drop trigger if exists pagos_auditoria_trigger on public.pagos;
create trigger pagos_auditoria_trigger after insert or update on public.pagos
for each row execute function public.auditar_pago();

-- Registro adicional para cambios sensibles fuera de los pagos.
create table if not exists public.operaciones_auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id bigint not null,
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  valor_anterior jsonb,
  valor_nuevo jsonb,
  realizado_por uuid not null,
  creado_en timestamptz not null default now()
);
alter table public.operaciones_auditoria enable row level security;
drop policy if exists "Usuarios ven su auditoria operativa" on public.operaciones_auditoria;
create policy "Usuarios ven su auditoria operativa" on public.operaciones_auditoria for select using (realizado_por = auth.uid());

create or replace function public.auditar_operacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_fila jsonb; v_id bigint;
begin
  v_fila := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id := (v_fila->>'id')::bigint;
  insert into public.operaciones_auditoria (tabla, registro_id, accion, valor_anterior, valor_nuevo, realizado_por)
  values (tg_table_name, v_id, tg_op, case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end, auth.uid());
  return coalesce(new, old);
end;
$$;

drop trigger if exists prestamos_auditoria_trigger on public.prestamos;
create trigger prestamos_auditoria_trigger after insert or update or delete on public.prestamos
for each row execute function public.auditar_operacion();
drop trigger if exists gastos_auditoria_trigger on public.gastos;
create trigger gastos_auditoria_trigger after insert or update or delete on public.gastos
for each row execute function public.auditar_operacion();

create or replace function public.registrar_pago(p_prestamo_id bigint, p_monto_pagado numeric, p_estado text, p_fecha_pago date default current_date)
returns void language plpgsql security invoker set search_path = public as $$
declare v_prestamo public.prestamos; v_total numeric;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_estado not in ('pago', 'parcial', 'no_pago') or p_monto_pagado < 0 or (p_estado <> 'no_pago' and p_monto_pagado <= 0) then raise exception 'Pago inválido'; end if;
  select * into v_prestamo from public.prestamos where id = p_prestamo_id and user_id = auth.uid() for update;
  if not found or v_prestamo.estado <> 'activo' then raise exception 'Préstamo activo no encontrado'; end if;
  insert into public.pagos (prestamo_id, fecha_pago, monto_pagado, estado, user_id)
  values (p_prestamo_id, p_fecha_pago, p_monto_pagado, p_estado, auth.uid())
  on conflict (prestamo_id, fecha_pago) do update set monto_pagado = excluded.monto_pagado, estado = excluded.estado;
  select coalesce(sum(monto_pagado), 0) into v_total from public.pagos where prestamo_id = p_prestamo_id;
  if v_total >= v_prestamo.monto_prestado * (1 + v_prestamo.interes_porcentaje / 100) then update public.prestamos set estado = 'pagado' where id = p_prestamo_id; end if;
end;
$$;

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
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, prestamo_anterior_id, user_id, interes_mora_habilitado, interes_mora_porcentaje)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, 'activo', p_prestamo_id, auth.uid(), v_anterior.interes_mora_habilitado, v_anterior.interes_mora_porcentaje);
end;
$$;

grant execute on function public.registrar_pago(bigint, numeric, text, date) to authenticated;
grant execute on function public.refinanciar_prestamo(bigint, numeric, integer, numeric, date) to authenticated;
