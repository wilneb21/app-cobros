# Aplicación de la migración

1. En Supabase abre **SQL Editor** y ejecuta el contenido de `supabase/migrations/20260717_seguridad_y_operaciones.sql`.
2. Luego ejecuta `supabase/migrations/20260718_reportes_avanzados.sql` (agrega la función `cartera_activa_en_fecha`, usada por el gráfico de tendencia de cartera en Reportes).
3. Después ejecuta `supabase/migrations/20260719_orden_clientes.sql` (agrega la columna `orden` en `clientes`, usada para organizar manualmente el orden de visita dentro de una ruta y armar el mapa de la jornada).
4. Si falla el índice `pagos_un_pago_por_dia`, primero identifica los duplicados:

```sql
select prestamo_id, fecha_pago, count(*)
from pagos
group by prestamo_id, fecha_pago
having count(*) > 1;
```

Conserva el registro correcto y elimina o consolida los demás antes de volver a ejecutar la migración.

3. Confirma que RLS está activado en `rutas`, `clientes`, `prestamos`, `pagos`, `gastos` y `metas`. Cada tabla debe permitir únicamente filas cuyo `user_id` sea `auth.uid()` para leer, insertar, modificar y borrar.
4. Prueba con dos cuentas diferentes: ninguna debe poder leer ni modificar datos de la otra.

La aplicación no usa la `service_role key`; la clave pública del navegador es segura únicamente si RLS está bien configurado.
