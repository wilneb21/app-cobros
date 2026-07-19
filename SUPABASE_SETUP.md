# Aplicación de la migración

1. En Supabase abre **SQL Editor** y ejecuta el contenido de `supabase/migrations/20260717_seguridad_y_operaciones.sql`.
2. Luego ejecuta `supabase/migrations/20260718_reportes_avanzados.sql` (agrega la función `cartera_activa_en_fecha`, usada por el gráfico de tendencia de cartera en Reportes).
3. Después ejecuta `supabase/migrations/20260719_orden_clientes.sql` (agrega la columna `orden` en `clientes`, usada para organizar manualmente el orden de visita dentro de una ruta y armar el mapa de la jornada).
4. Después ejecuta `supabase/migrations/20260720_mejoras_negocio.sql` (agrega mora real aplicable con un botón, con su historial fechado en `cargos_mora`, y la tabla `historial_orden_ruta` para ver los últimos reordenamientos de cada ruta).
5. Si falla el índice `pagos_un_pago_por_dia`, primero identifica los duplicados:

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

## Corregir los correos de confirmación y recuperación (para que no caigan en una página de error)

Cuando alguien crea una cuenta o pide recuperar su contraseña, Supabase manda un correo con un enlace. Ese enlace solo funciona si la URL de tu app está autorizada en el panel de Supabase — si no, cae en una página de error aunque el código esté bien.

1. Entra a tu proyecto en [supabase.com](https://supabase.com) → **Authentication → URL Configuration**.
2. En **Site URL** pon la URL real donde está publicada tu app (ej: `https://tuusuario.github.io/app-cobros/` o tu dominio propio). Nada de `localhost`.
3. En **Redirect URLs** agrega esa misma URL (puedes usar `https://tuusuario.github.io/app-cobros/*` con asterisco para cubrir subrutas).
4. Guarda los cambios.

Si tu app vive en varias URLs (por ejemplo local para pruebas y la publicada), agrega todas las que uses en la lista de **Redirect URLs**.

## Activar notificaciones push reales (cuotas que vencen mañana, con la app cerrada)

Esto tiene 3 partes: la base de datos, la Edge Function que manda los push, y programarla para que corra sola todos los días.

### 1. Base de datos
Ejecuta `supabase/migrations/20260722_push_y_preferencias.sql` en el SQL Editor (crea `push_subscriptions` y `preferencias_usuario`, ambas con RLS).

### 2. Llaves VAPID (para que el navegador confíe en tus notificaciones)
Ya dejé un par de llaves de ejemplo funcionando en `js/supabase-config.js` (`VAPID_PUBLIC_KEY`) para que puedas probar de una vez. **Para producción, genera tu propio par** con:

```bash
npx web-push generate-vapid-keys
```

Si generas unas nuevas, reemplaza `VAPID_PUBLIC_KEY` en `js/supabase-config.js` por la que te dé ese comando.

### 3. Configura los secretos de la Edge Function
En el Dashboard de Supabase → **Edge Functions → Secrets** (o con la CLI):

```bash
supabase secrets set VAPID_PUBLIC_KEY="tu_clave_publica"
supabase secrets set VAPID_PRIVATE_KEY="tu_clave_privada"
supabase secrets set VAPID_SUBJECT="mailto:tucorreo@dominio.com"
supabase secrets set CRON_SECRET="inventa-una-clave-larga-y-secreta"
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen automáticamente en toda Edge Function, no hace falta configurarlos.

### 4. Despliega la función
```bash
supabase functions deploy recordatorios-push --no-verify-jwt
```
(`--no-verify-jwt` porque quien la llama es un cron interno, no un usuario logueado; la función igual está protegida por el `CRON_SECRET` del paso anterior.)

### 5. Prográmala para que corra sola cada día
En el SQL Editor (reemplaza `TU_PROJECT_REF` y el secreto por los tuyos reales):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'recordatorios-push-diario',
  '0 22 * * *', -- 5:00 p.m. hora de Bogotá (UTC-5) — ajusta la hora a tu gusto
  $$
  select net.http_post(
    url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/recordatorios-push',
    headers := jsonb_build_object('x-cron-secret', 'inventa-una-clave-larga-y-secreta'),
    body := '{}'::jsonb
  );
  $$
);
```

Con eso, todos los días a la hora que elijas, la función revisa qué cuotas vencen mañana y les manda el push a los celulares que hayan activado "Notificaciones push" en Configuración dentro de la app.

**Para probar sin esperar al cron:** puedes invocar la función manualmente desde la terminal:
```bash
curl -X POST 'https://TU_PROJECT_REF.supabase.co/functions/v1/recordatorios-push' \
  -H "x-cron-secret: inventa-una-clave-larga-y-secreta"
```

