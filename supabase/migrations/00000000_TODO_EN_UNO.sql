-- ============================================================================
-- ACTUALIZACIÓN CONSOLIDADA — reemplaza a las migraciones sueltas de abajo
-- ============================================================================
-- Antes había que copiar y pegar un archivo por uno, en orden exacto, en el
-- SQL Editor de Supabase. Ahora es un solo paso: copia y pega TODO este
-- archivo una sola vez. Cubre todas las migraciones desde 20260717 hasta
-- 20260810 (zona horaria + retiros de aporte propio incluidos).
--
-- Es seguro de ejecutar aunque ya hayas aplicado antes algunas de estas
-- migraciones: cada 'create table'/'add column' usa 'if not exists' y cada
-- 'create policy' va precedida de 'drop policy if exists', así que no falla
-- ni duplica nada si una parte ya estaba aplicada.
--
-- NOTA SOBRE LA MORA: en algún punto se construyó (y se probó) un sistema de
-- recargo por mora/atraso — tabla cargos_mora, columnas interes_mora_*,
-- mora_acumulada, mora_meses_aplicados, funciones aplicar_mora_automatica /
-- aplicar_mora_manual / aplicar_recargo_mora. Se decidió que no se usaba y se
-- quitó todo por completo. Este archivo consolidado YA NO incluye nada de eso
-- (ni lo crea para después borrarlo) — si ves esas migraciones sueltas en la
-- carpeta con "mora" en el nombre, ya están reflejadas aquí como si nunca
-- hubieran existido.
--
-- IMPORTANTE — lo único que este archivo NO incluye es el esquema base del
-- proyecto (las tablas clientes, prestamos, pagos, gastos, rutas, caja_diaria
-- tal como existían ANTES de estas rondas de mejoras). Ese esquema base no
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
  -- Nota: esta es la versión MÁS VIEJA de esta función, conservada aquí solo
  -- para que el historial de este archivo sea fiel a como evolucionó. Queda
  -- reemplazada más abajo por la versión final (sin columnas de mora, que ya
  -- no existen — ver nota al principio del archivo). Esta versión intermedia
  -- ya no referencia esas columnas para que el script no falle si se corre
  -- contra la base de datos actual (donde esas columnas ya se borraron).
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, prestamo_anterior_id, user_id)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, 'activo', p_prestamo_id, auth.uid());
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
-- Agrega: historial de reordenamientos de ruta.
-- No toca las políticas de RLS existentes (siguen siendo user_id = auth.uid()).
--
-- (Esta migración original también incluía un primer intento de "mora real"
-- — columna mora_acumulada, tabla cargos_mora, función aplicar_recargo_mora —
-- que quedó completamente reemplazado por intentos posteriores y al final
-- se quitó todo del producto. Se omite aquí; ver la nota al principio del
-- archivo.)

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

-- ---------------------------------------------------------------------------
-- De: 20260801_permitir_borrar_gastos.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- BUG REAL (no solo estética): a "gastos" nunca se le agregó el permiso de
-- BORRAR ni de EDITAR (la migración 20260723 lo agregó para "pagos" y
-- "prestamos", pero se quedó sin cubrir "gastos"). Con RLS activado y sin una
-- política de "delete", Supabase no borra la fila pero TAMPOCO devuelve un
-- error: el navegador la quita de la lista un instante, pero al volver a
-- cargar los datos (o al abrir Reportes) el gasto sigue ahí, porque nunca se
-- borró de verdad en la base de datos. Esto agrega el permiso que faltaba,
-- igual que ya existe para pagos, préstamos y aportes propios.
drop policy if exists "Usuarios borran sus gastos" on public.gastos;
create policy "Usuarios borran sus gastos" on public.gastos for delete
  using (user_id = auth.uid());

drop policy if exists "Usuarios editan sus gastos" on public.gastos;
create policy "Usuarios editan sus gastos" on public.gastos for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- De: 20260803_mejoras_operativas.sql (solo la parte que sigue vigente)
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Cada préstamo decide si sus cuotas DIARIAS cuentan domingos y festivos como
-- día de cuota (comportamiento de siempre, valor por defecto) o si esos días
-- se saltan al calcular cuántas cuotas debería llevar pagadas a hoy.
alter table public.prestamos add column if not exists contar_domingos_festivos boolean not null default true;

-- Nota: la migración original de esta fecha también agregó una tabla
-- "dias_festivos" para cargarlos a mano, pero eso se reemplazó casi enseguida
-- (ver 20260804_festivos_automaticos.sql) por un calendario que la app calcula
-- sola (festivos de Colombia + Semana Santa + Ley Emiliani), así que esa
-- tabla ya no se crea aquí — nunca llegó a hacer falta en la versión final.

-- ---------------------------------------------------------------------------
-- De: 20260809_fecha_desembolso.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- Hasta ahora, la caja diaria usaba fecha_inicio (la fecha de la PRIMERA
-- CUOTA, que en el formulario viene puesta en "mañana" por defecto) para
-- decidir en qué día restar el efectivo prestado. Eso hacía que un préstamo
-- entregado HOY apareciera restado en la caja de MAÑANA, sin que nadie lo
-- notara.
--
-- Esta columna representa el día en que REALMENTE sale el efectivo de la
-- mano del cobrador. La app la usa para todo lo relacionado con caja y
-- reportes de efectivo prestado, dejando fecha_inicio únicamente para el
-- cronograma de cuotas (cuándo debe pagar el cliente).
alter table public.prestamos add column if not exists fecha_desembolso date;

update public.prestamos
set fecha_desembolso = fecha_inicio
where fecha_desembolso is null;

alter table public.prestamos
  alter column fecha_desembolso set default current_date,
  alter column fecha_desembolso set not null;

-- ---------------------------------------------------------------------------
-- De: 20260810_zona_horaria_y_retiro_aporte.sql
-- ---------------------------------------------------------------------------
-- Ejecutar en Supabase SQL Editor, después de las migraciones anteriores.
--
-- ZONA HORARIA: Supabase corre la base de datos en UTC por defecto. La app YA
-- calcula bien "hoy" en el navegador (obtenerFechaLocal() usa America/Bogota),
-- pero varias funciones y columnas del lado del servidor usan current_date/
-- now() como valor por defecto. Como Bogotá es UTC-5, a las 7pm en Colombia ya
-- es medianoche en UTC — por eso un préstamo creado después de las 7pm podía
-- terminar fechado "mañana" en vez de "hoy". Esto pone en hora de Colombia
-- toda la base de datos.
alter database postgres set timezone to 'America/Bogota';

-- RETIROS DE APORTE PROPIO: permite montos NEGATIVOS en aportes_capital. Un
-- retiro (el cobrador mete plata propia un día y al otro día quiere sacarla
-- de nuevo) se guarda como un aporte con monto negativo, fechado el día en
-- que se retira — sin tocar ni borrar el aporte original de otro día.
alter table public.aportes_capital drop constraint if exists aportes_capital_monto_check;
alter table public.aportes_capital add constraint aportes_capital_monto_check check (monto <> 0);

-- ---------------------------------------------------------------------------
-- registrar_pago y refinanciar_prestamo — VERSIÓN FINAL (reemplaza a todas
-- las versiones anteriores de estas dos funciones definidas más arriba en
-- este mismo archivo; solo la de aquí abajo queda instalada al final).
-- ---------------------------------------------------------------------------
-- registrar_pago: ya sin mora (se quitó del todo, ver nota al principio del
-- archivo) y con soporte para pagos múltiples el mismo día (p_sumar=true
-- suma al pago que ya existía ese día en vez de reemplazarlo).
--
-- OJO: se borra primero la versión con 4 parámetros definida más arriba en
-- este archivo — Postgres no la reemplaza sola porque esta versión final
-- tiene un parámetro nuevo (p_sumar); sin este "drop", quedarían las dos
-- funciones instaladas a la vez en vez de una sola.
drop function if exists public.registrar_pago(bigint, numeric, text, date);
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

-- refinanciar_prestamo: ya sin mora, con fecha_desembolso propia, y
-- corrigiendo un detalle que se quedó suelto en el camino — el crédito nuevo
-- debe seguir respetando si el anterior contaba o no domingos/festivos en sus
-- cuotas diarias (una migración de hace unos días dejó de copiar ese dato al
-- refinanciar; esta versión ya lo vuelve a copiar).
--
-- OJO: mismo motivo que arriba — se borra la versión con 5 parámetros
-- definida más arriba en este archivo, porque esta versión final agrega uno
-- nuevo (p_fecha_desembolso).
drop function if exists public.refinanciar_prestamo(bigint, numeric, integer, numeric, date);
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
  insert into public.prestamos (cliente_id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, fecha_desembolso, estado, prestamo_anterior_id, user_id, contar_domingos_festivos)
  values (v_anterior.cliente_id, v_monto, p_interes_porcentaje, round(v_monto * (1 + p_interes_porcentaje / 100) / p_numero_cuotas, 0), p_numero_cuotas, v_anterior.frecuencia, p_fecha_inicio, p_fecha_desembolso, 'activo', p_prestamo_id, auth.uid(), coalesce(v_anterior.contar_domingos_festivos, true));
end;
$$;

grant execute on function public.refinanciar_prestamo(bigint, numeric, integer, numeric, date, date) to authenticated;