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
