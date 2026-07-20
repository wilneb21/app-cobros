-- ============================================================================
-- ACTUALIZACIÓN CONSOLIDADA — reemplaza a las 12 migraciones sueltas de abajo
-- ============================================================================
-- Antes había que copiar y pegar 12 archivos, uno por uno y en orden exacto,
-- en el SQL Editor de Supabase. Ahora es un solo paso: copia y pega TODO este
-- archivo una sola vez.
--
-- Es seguro de ejecutar aunque ya hayas aplicado antes algunas de estas 12
-- migraciones: cada 'create table'/'add column' usa 'if not exists' y cada
-- 'create policy' va precedida de 'drop policy if exists', así que no falla
-- ni duplica nada si una parte ya estaba aplicada.
--
-- IMPORTANTE — lo único que este archivo NO incluye es el esquema base del
-- proyecto (las tablas clientes, prestamos, pagos, gastos, rutas, caja_diaria
-- tal como existían ANTES de estas 12 rondas de mejoras). Ese esquema base no
-- venía incluido en este proyecto, así que no puedo reconstruirlo sin
-- inventar columnas — si vas a levantar un proyecto de Supabase desde cero,
-- dime y lo armamos juntos a partir de lo que la app espera encontrar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- De: 20260717_seguridad_y_operaciones.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- De: 20260718_reportes_avanzados.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- De: 20260719_orden_clientes.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
-- Agrega un campo de orden manual para que cada cobrador organice sus clientes
-- dentro de una ruta según su recorrido real (no alfabético).

alter table public.clientes add column if not exists orden integer;
create index if not exists clientes_ruta_orden_idx on public.clientes (ruta_id, orden);

-- No requiere cambios de RLS: "clientes" ya usa la política existente de
-- user_id = auth.uid() para select/insert/update/delete.

-- ---------------------------------------------------------------------------
-- De: 20260720_mejoras_negocio.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- De: 20260721_cedula_cliente.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
-- Agrega el número de cédula (o documento de identidad) al registro del cliente.

alter table public.clientes add column if not exists cedula text;
create index if not exists clientes_cedula_idx on public.clientes (cedula);

-- No requiere cambios de RLS: "clientes" ya usa la política existente de
-- user_id = auth.uid() para select/insert/update/delete.

-- ---------------------------------------------------------------------------
-- De: 20260722_push_y_preferencias.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.

-- Permite etiquetar (opcionalmente) cada gasto con la ruta a la que
-- pertenece. Antes todos los gastos quedaban "sueltos", sin poder saber si
-- la gasolina o el gasto de tal día fue de una ruta en particular o del
-- negocio en general. Queda NULL = "general / no aplica a una ruta".
-- Nota: la caja diaria (caja_diaria) queda intencionalmente sin este campo —
-- representa un solo efectivo físico del cobrador, no una caja por ruta.
alter table public.gastos add column if not exists ruta_id bigint references public.rutas(id) on delete set null;
create index if not exists gastos_ruta_idx on public.gastos (ruta_id);

-- Guarda la "suscripción" que el navegador/celular crea para poder recibir
-- notificaciones push reales (aunque la app esté cerrada). Cada dispositivo
-- donde el cobrador active las notificaciones agrega su propia fila.
create table if not exists public.push_subscriptions (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Usuarios ven sus suscripciones push" on public.push_subscriptions;
create policy "Usuarios ven sus suscripciones push" on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "Usuarios crean sus suscripciones push" on public.push_subscriptions;
create policy "Usuarios crean sus suscripciones push" on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "Usuarios borran sus suscripciones push" on public.push_subscriptions;
create policy "Usuarios borran sus suscripciones push" on public.push_subscriptions for delete using (user_id = auth.uid());

-- Pequeña tabla de preferencias por usuario. Por ahora solo guarda si alguna
-- vez activó el bloqueo con PIN (para poder recordárselo si un día abre la
-- app en un celular nuevo, o después de reinstalarla, y el PIN local ya no
-- está — ver js/bloqueo.js). El PIN en sí NUNCA se guarda aquí, solo el
-- indicador de "sí uso esta protección".
create table if not exists public.preferencias_usuario (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_activado_alguna_vez boolean not null default false,
  actualizado_en timestamptz not null default now()
);

alter table public.preferencias_usuario enable row level security;
drop policy if exists "Usuarios ven sus preferencias" on public.preferencias_usuario;
create policy "Usuarios ven sus preferencias" on public.preferencias_usuario for select using (user_id = auth.uid());
drop policy if exists "Usuarios crean sus preferencias" on public.preferencias_usuario;
create policy "Usuarios crean sus preferencias" on public.preferencias_usuario for insert with check (user_id = auth.uid());
drop policy if exists "Usuarios actualizan sus preferencias" on public.preferencias_usuario;
create policy "Usuarios actualizan sus preferencias" on public.preferencias_usuario for update using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- De: 20260723_administrar_cuenta.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Hasta ahora la app no permitía borrar un pago mal registrado, ni borrar un
-- cliente que ya tenía préstamos/pagos en su historial (solo archivarlo).
-- Esto agrega el permiso para que el dueño de la cuenta pueda corregir esos
-- errores él mismo — siempre limitado a SUS PROPIOS datos (nunca a los de
-- otra cuenta), igual que el resto de la app.
--
-- Nota de seguridad: esto NO activa ni desactiva RLS en ninguna tabla (eso ya
-- debe estar configurado de antes) — solo AGREGA el permiso de borrar que
-- faltaba. Si RLS ya estaba bien puesto, esto es 100% seguro de ejecutar.

drop policy if exists "Usuarios borran sus pagos" on public.pagos;
create policy "Usuarios borran sus pagos" on public.pagos for delete
using (exists (
  select 1 from public.prestamos p where p.id = pagos.prestamo_id and p.user_id = auth.uid()
));

drop policy if exists "Usuarios borran sus prestamos" on public.prestamos;
create policy "Usuarios borran sus prestamos" on public.prestamos for delete
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- De: 20260724_aportes_capital.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- A veces el cobrador mete plata de su propio bolsillo (no de la cartera del
-- negocio) para completar un préstamo, por ejemplo. Esto guarda esos aportes
-- por separado de los cobros normales, para no mezclarlos ni confundirlos en
-- los reportes — la caja diaria (js/main.js) los suma aparte al calcular el
-- efectivo esperado del día.

create table if not exists public.aportes_capital (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha date not null,
  monto numeric not null check (monto > 0),
  nota text,
  creado_en timestamptz not null default now()
);

create index if not exists aportes_capital_fecha_idx on public.aportes_capital (user_id, fecha);

alter table public.aportes_capital enable row level security;
drop policy if exists "Usuarios ven sus aportes" on public.aportes_capital;
create policy "Usuarios ven sus aportes" on public.aportes_capital for select using (user_id = auth.uid());
drop policy if exists "Usuarios crean sus aportes" on public.aportes_capital;
create policy "Usuarios crean sus aportes" on public.aportes_capital for insert with check (user_id = auth.uid());
drop policy if exists "Usuarios borran sus aportes" on public.aportes_capital;
create policy "Usuarios borran sus aportes" on public.aportes_capital for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- De: 20260725_correcciones_caja.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Corrección: la migración de aportes_capital (20260724) dejó permisos para
-- ver, crear y borrar aportes propios, pero se quedó sin el permiso de
-- ACTUALIZAR (editar el monto o la nota de un aporte ya guardado). La app
-- ahora sí permite corregir un aporte con errores (ver "✏️ Editar" en la
-- lista de la Caja diaria), así que sin esta política esa edición fallaría.
drop policy if exists "Usuarios editan sus aportes" on public.aportes_capital;
create policy "Usuarios editan sus aportes" on public.aportes_capital for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- De: 20260726_asegurar_caja_diaria.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Si la tabla caja_diaria ya existía en tu proyecto ANTES de aplicar la
-- migración 20260717 (por ejemplo, la creaste manualmente en algún momento),
-- el "create table if not exists" de esa migración no hizo nada porque la
-- tabla ya estaba — y eso significa que la restricción única (user_id, fecha)
-- nunca se agregó. Sin esa restricción, el "Abrir/Cerrar caja" de la app
-- falla siempre con "No fue posible guardar la caja", porque usa un upsert
-- que depende de ella para saber si debe crear o actualizar la fila del día.
--
-- Este bloque agrega la restricción SOLO si todavía no existe; si ya está,
-- no hace nada (es seguro correrlo aunque no sea tu problema).
do $$
begin
  alter table public.caja_diaria
    add constraint caja_diaria_user_fecha_unica unique (user_id, fecha);
exception
  when duplicate_object then
    raise notice 'La restricción única (user_id, fecha) ya existía en caja_diaria — no se tocó nada.';
end $$;

-- Por si acaso, confirmamos también que RLS esté activo y con su política
-- (esto es exactamente igual a lo que ya hace 20260717; correrlo de nuevo es
-- seguro y no cambia nada si ya estaba bien).
alter table public.caja_diaria enable row level security;
drop policy if exists "Usuarios gestionan su caja diaria" on public.caja_diaria;
create policy "Usuarios gestionan su caja diaria" on public.caja_diaria for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- De: 20260727_columnas_caja_diaria.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor.
--
-- El error "Could not find the 'base_inicial' column of 'caja_diaria' in the
-- schema cache" confirma que la tabla caja_diaria YA EXISTÍA en tu proyecto
-- antes de correr la migración 20260717 (con otra estructura, o vacía), así
-- que "create table if not exists" no le agregó las columnas que la app
-- necesita. Este bloque las agrega solo si faltan, sin borrar nada de lo que
-- ya tengas en esa tabla.

alter table public.caja_diaria add column if not exists base_inicial numeric not null default 0;
alter table public.caja_diaria add column if not exists efectivo_final numeric;
alter table public.caja_diaria add column if not exists fecha date;
alter table public.caja_diaria add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.caja_diaria add column if not exists creado_en timestamptz not null default now();

-- Restricciones básicas: solo se agregan si todavía no existen (si ya
-- estaban, esto simplemente avisa y sigue, no falla).
do $$
begin
  alter table public.caja_diaria add constraint caja_diaria_base_no_negativa check (base_inicial >= 0);
exception when duplicate_object then
  raise notice 'La restricción de base_inicial >= 0 ya existía.';
end $$;

do $$
begin
  alter table public.caja_diaria add constraint caja_diaria_final_no_negativo check (efectivo_final >= 0);
exception when duplicate_object then
  raise notice 'La restricción de efectivo_final >= 0 ya existía.';
end $$;

do $$
begin
  alter table public.caja_diaria add constraint caja_diaria_user_fecha_unica unique (user_id, fecha);
exception when duplicate_object then
  raise notice 'La restricción única (user_id, fecha) ya existía.';
end $$;

alter table public.caja_diaria enable row level security;
drop policy if exists "Usuarios gestionan su caja diaria" on public.caja_diaria;
create policy "Usuarios gestionan su caja diaria" on public.caja_diaria for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Le avisa a Supabase que refresque YA su caché de columnas/tablas, para no
-- tener que esperar a que lo haga sola (puede tardar hasta 1 minuto).
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- De: 20260728_caja_automatica.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Agrega la preferencia "cuadre automático de caja": cuando está activada,
-- la app ya no te pide contar el efectivo físico ni tocar "Abrir caja" cada
-- mañana — calcula sola la base del día (base de ayer + cobros + aportes -
-- gastos - prestado) y sigue así, día tras día, sin intervención. Ver
-- js/main.js (cargarCajaDiaria) para el detalle.
alter table public.preferencias_usuario add column if not exists caja_automatica boolean not null default false;

-- ---------------------------------------------------------------------------
-- De: 20260729_respaldo_en_servidor.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Antes, la fecha del "último respaldo descargado" se guardaba en localStorage,
-- es decir en el celular. Si el cobrador cambiaba de celular o lo formateaba,
-- la app "olvidaba" que ya había hecho respaldos y volvía a mostrar el aviso
-- de "nunca has respaldado" aunque sí lo hubiera hecho antes.
--
-- Esta migración agrega una columna en preferencias_usuario (que ya vive en
-- Supabase, no en el celular) para que ese dato sobreviva a un cambio de
-- dispositivo, igual que el resto de la información del negocio.

alter table public.preferencias_usuario add column if not exists ultimo_respaldo date;

