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
