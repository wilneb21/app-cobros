-- Ejecutar en Supabase SQL Editor, después de las 3 migraciones anteriores.
-- Agrega: mora real (aplicable con un botón, no automática/silenciosa),
-- historial de reordenamientos de ruta.
-- No toca las políticas de RLS existentes (siguen siendo user_id = auth.uid()).

-- --- 1) MORA REAL -----------------------------------------------------
-- Antes el recargo por mora solo se mostraba en pantalla como estimado.
-- Ahora, si el cobrador decide aplicarlo, se suma de verdad al saldo que
-- debe el cliente y queda guardado (auditable vía operaciones_auditoria,
-- que ya cubre updates de "prestamos").
alter table public.prestamos add column if not exists mora_acumulada numeric not null default 0 check (mora_acumulada >= 0);

-- Registro fechado de cada recargo aplicado (mora_acumulada en "prestamos" es
-- solo el total acumulado para el cálculo rápido del saldo; esta tabla es la
-- que permite reportar cuánta mora se cobró en un período específico).
create table if not exists public.cargos_mora (
  id bigint generated always as identity primary key,
  prestamo_id bigint not null references public.prestamos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  monto numeric not null check (monto > 0),
  fecha date not null default current_date,
  creado_en timestamptz not null default now()
);
alter table public.cargos_mora enable row level security;
drop policy if exists "Usuarios ven sus cargos de mora" on public.cargos_mora;
create policy "Usuarios ven sus cargos de mora" on public.cargos_mora for select using (user_id = auth.uid());
drop policy if exists "Usuarios crean sus cargos de mora" on public.cargos_mora;
create policy "Usuarios crean sus cargos de mora" on public.cargos_mora for insert with check (user_id = auth.uid());

create or replace function public.aplicar_recargo_mora(p_prestamo_id bigint, p_monto numeric)
returns void language plpgsql security invoker set search_path = public as $$
declare v_prestamo public.prestamos;
begin
  if auth.uid() is null then raise exception 'Sesión no válida'; end if;
  if p_monto <= 0 then raise exception 'El recargo debe ser mayor a cero'; end if;
  select * into v_prestamo from public.prestamos where id = p_prestamo_id and user_id = auth.uid() for update;
  if not found or v_prestamo.estado <> 'activo' then raise exception 'Préstamo activo no encontrado'; end if;
  if not v_prestamo.interes_mora_habilitado then raise exception 'Este préstamo no tiene mora habilitada'; end if;
  update public.prestamos set mora_acumulada = mora_acumulada + p_monto where id = p_prestamo_id;
  insert into public.cargos_mora (prestamo_id, user_id, monto) values (p_prestamo_id, auth.uid(), p_monto);
end;
$$;
grant execute on function public.aplicar_recargo_mora(bigint, numeric) to authenticated;

-- Nota de diseño: la mora aplicada se contabiliza como ganancia en el
-- momento en que se aplica (es un cargo, no capital propio que regresa),
-- separada de la fórmula de interés normal. Si prefieres contabilizarla
-- solo cuando el cliente efectivamente la paga, avísame y lo ajustamos.

-- --- 2) HISTORIAL DE REORDENAMIENTOS DE RUTA --------------------------
-- Guarda una copia de cada vez que el cobrador reordena una ruta, para
-- poder revisar o deshacer un cambio accidental.
create table if not exists public.historial_orden_ruta (
  id bigint generated always as identity primary key,
  ruta_id bigint not null references public.rutas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  orden jsonb not null, -- [{id, nombre, orden}, ...] tal como quedó guardado
  creado_en timestamptz not null default now()
);
alter table public.historial_orden_ruta enable row level security;
drop policy if exists "Usuarios ven su historial de orden" on public.historial_orden_ruta;
create policy "Usuarios ven su historial de orden" on public.historial_orden_ruta for select using (user_id = auth.uid());
drop policy if exists "Usuarios crean su historial de orden" on public.historial_orden_ruta;
create policy "Usuarios crean su historial de orden" on public.historial_orden_ruta for insert with check (user_id = auth.uid());
