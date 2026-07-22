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
