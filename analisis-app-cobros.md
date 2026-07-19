# Análisis de App Cobros

Este documento explica cómo funciona la app hoy, qué implementé en esta ronda, una corrección a mi análisis anterior, y qué queda pendiente y por qué.

## -1. Ronda nueva (2026-07-19): cédula del cliente y orden compartido

| Idea | Dónde quedó |
|---|---|
| 🪪 Cédula del cliente | Nuevo campo en "Nuevo cliente" y en la pestaña Info del detalle. Se guarda en `clientes.cedula` (columna nueva, migración `20260721_cedula_cliente.sql`). Se muestra en la tarjeta de la lista, se puede usar para buscar clientes, se avisa si ya existe otro cliente con la misma cédula, y aparece en el estado de cuenta exportado. |
| 🔀 Orden compartido entre Rutas, Clientes y Cobrar | Antes, el orden manual que definías en "Rutas → Ordenar clientes" solo se veía reflejado al abrir el mapa de la ruta. Ahora la lista de **Clientes** y la de **Cobrar** también respetan ese mismo orden: se agrupan por ruta (con un encabezado 📍) y, dentro de cada ruta, los clientes salen en el orden exacto que definiste — no alfabético. |

**Importante:** necesitas correr la migración nueva `supabase/migrations/20260721_cedula_cliente.sql` en el SQL Editor de Supabase para que el campo de cédula funcione (si no la corres, la app fallará al crear/editar clientes porque la columna no existirá).


## 0. Ronda nueva (2026-07-18): candado, caja, WhatsApp, cupo y rutas

De la lista de ideas que hablamos, ya existían implementadas (no hizo falta tocarlas): **modo oscuro**, **copia de seguridad exportable (.json)** y el botón manual de WhatsApp en el perfil del cliente. Lo que sí agregué en esta ronda:

| Idea | Dónde quedó |
|---|---|
| 🔒 Bloqueo con PIN (+ huella/Face ID opcional) | Nuevo `js/bloqueo.js`. Se activa desde Configuración → "Bloqueo con PIN". El PIN se guarda hasheado (SHA-256) **solo en ese celular** (`localStorage`), nunca en Supabase. Si el celular lo soporta, se ofrece además usar huella/Face ID como acceso rápido (WebAuthn local, sin servidor). Se vuelve a pedir si la app estuvo en segundo plano más de 20 segundos. "Olvidé mi PIN" solo permite cerrar sesión y volver a entrar con correo/contraseña — no hay forma de recuperarlo, por diseño. |
| 🧮 Cierre de caja con conteo físico | Se aprovechó la caja diaria que ya existía: ahora, después de "Cerrar caja" (que ya pedía el efectivo contado), se muestra el **descuadre**: cuadrada ✅, sobrante 🔵 o faltante 🔴, comparando lo esperado contra lo que realmente contaste. |
| 💬 Recordatorio por WhatsApp antes del vencimiento | En "Agenda de vencimientos" (Inicio), las cuotas que vencen **mañana** muestran un botón "💬 Recordar" que abre WhatsApp con un mensaje ya redactado, listo para enviar. |
| 💡 Sugerencia de cupo | En el detalle de cada cliente (pestaña Info), si ya tiene al menos un crédito totalmente pagado, se sugiere un monto para el próximo préstamo según su % de cumplimiento histórico y su nivel de riesgo. Es solo una guía, no bloquea nada. |
| 📊 Comparar rendimiento entre rutas | Nuevo bloque "Rendimiento por ruta" en Reportes: para el mismo período que estás viendo, muestra cuánto se cobró y el % de cumplimiento de cada ruta, para ver cuál paga mejor y cuál tiene más mora. |

**Nota sobre el PIN/huella:** es una capa de seguridad *local* del celular (evita que alguien tome el celular desbloqueado y entre directo a la app). La seguridad real de los datos sigue siendo el login de Supabase + RLS, que no cambia.

No se necesita ninguna migración nueva de Supabase para esta ronda — todo se construyó sobre tablas y columnas que ya existían.

## 1. Cómo funciona la app, paso a paso

**Clientes.** Se dan de alta con nombre, teléfono, dirección y un nivel de riesgo (🟢 bueno / 🟡 regular / 🔴 riesgoso). Cada cliente pertenece a una ruta, y dentro de una ruta el cobrador puede fijar un **orden manual** para que la lista siga el recorrido real. Cada vez que se guarda un nuevo orden queda un registro fechado en `historial_orden_ruta`, visible con el botón "🕓 Ver últimos cambios" dentro del editor de orden — así se puede revisar si alguien cambió el recorrido por accidente. Nuevo: un **ranking de cumplimiento** (🏆, dentro de la pestaña Clientes) ordena a los clientes por % de pagos completos sobre el total de registros de pago, para decidir a quién es más fácil volver a prestarle.

**Préstamos.** Al crear uno se define monto, interés %, número de cuotas, frecuencia y fecha de inicio. La cuota se calcula como `(monto + monto·interés/100) / cuotas`. Opcionalmente se activa un recargo por mora (%).

**Cobro diario.** Se registra "Pagó", "Parcial" o "No pagó". Sin señal, el pago se guarda en el celular y se reintenta solo cada 60 segundos **hasta 5 veces**; si sigue fallando después de eso (nuevo), deja de reintentar solo y el indicador cambia a "⚠️ no se pudo enviar — toca para reintentar", para no perder el envío en un bucle infinito silencioso cuando el problema no es la señal sino un dato inválido. Crear un **cliente o préstamo nuevo** ahora avisa claramente que necesita conexión (antes simplemente fallaba sin explicación si el cobrador lo intentaba sin señal).

**Mora — ahora es real, no solo informativa (cambio principal de esta ronda).** Antes el recargo por mora era solo un número mostrado en pantalla, nunca se cobraba de verdad. Ahora, junto al estimado, hay un botón **"Aplicar recargo al saldo"**: al tocarlo (requiere conexión, porque es un cargo de dinero real) el monto se suma de verdad al saldo pendiente del préstamo y queda guardado con fecha en la tabla `cargos_mora`. Esto es una acción manual del cobrador, no automática — decidí no aplicarla sola en segundo plano para evitar cobrar de más por un error de cálculo sin que nadie lo revise antes. La mora aplicada también se refleja en Reportes ("Mora cobrada") y en la tarjeta de Ganancia de Inicio.
  - *Simplificación a tener en cuenta:* la mora se contabiliza como ganancia en el momento en que se **aplica** (se carga al saldo), no en el momento en que el cliente efectivamente la termina pagando. Para la mayoría de negocios esto es aceptable, pero si prefieres contarla solo cuando se cobra de verdad, se puede ajustar.

**Refinanciamiento, gastos y caja diaria.** Sin cambios — funcionan como antes.

**Ganancia por intereses (tarjeta de Inicio).** Selector Diaria/Semanal/Mensual con la ganancia bruta del período (intereses + mora aplicada, sin restar gastos), la ganancia acumulada desde el primer pago, y la variación de cartera activa (↗/↘) contra el inicio del período.

**Reportes.** Por día, semana, mes o año, con comparación contra el período anterior. Nuevo: botón **"⬇️ Exportar este reporte a CSV"** que descarga los totales del período (desembolso, cobrado, gastos, flujo, ganancia por intereses, mora cobrada, ganancia neta) y el detalle de pagos, para llevar registro fuera de la app en Excel/Sheets.

**Recordatorios de vencimientos (nuevo).** En Inicio, si hay cuotas vencidas u "hoy" y activas el botón "🔔 Activar recordatorios", el navegador pide permiso de notificaciones y, mientras la app esté abierta, avisa una vez al día cuántas cuotas están pendientes.

## 2. Corrección a mi análisis anterior

Dije que "corregir un pago duplicado del mismo día se sobreescribe sin dejar rastro". **Eso estaba mal** — al revisar con más cuidado `20260717_seguridad_y_operaciones.sql` encontré que ya existe una tabla `pagos_auditoria` con un trigger que guarda automáticamente el valor anterior y el nuevo en cada INSERT/UPDATE de un pago (y `operaciones_auditoria` hace lo mismo para préstamos y gastos). El historial de correcciones ya existía; no hizo falta tocar nada ahí. Disculpa el error.

## 3. Lo que implementé en esta ronda (de la lista de ideas)

| Idea | Estado |
|---|---|
| Mora real (opcional, no automática/silenciosa) | ✅ Implementada — botón "Aplicar recargo al saldo" + tabla `cargos_mora` fechada |
| Ranking de clientes por cumplimiento | ✅ Implementada |
| Exportar reportes a CSV (compatible con Excel) | ✅ Implementada |
| Historial de reordenamientos de ruta | ✅ Implementada |
| Recordatorios de vencimientos | ⚠️ Implementada la versión **local** (Notification API del navegador, solo mientras la app está abierta). Un push real que llegue con la app cerrada necesita un servicio de push con backend — ver sección 4. |
| Multiusuario/roles | ❌ No implementada esta ronda — ver sección 4, es la que más riesgo tiene si se hace mal. |
| Retorno de mejoras encontradas al revisar de nuevo el código | ✅ Ver sección 5 |

No requieres tocar nada del frontend fuera de subir los archivos nuevos/actualizados. Sí necesitas correr una migración nueva en Supabase: `supabase/migrations/20260720_mejoras_negocio.sql` (agrega `mora_acumulada` y `cargos_mora` a préstamos, y la tabla `historial_orden_ruta`). Está detallado en `SUPABASE_SETUP.md`.

## 4. Lo que no implementé y por qué

- **Multiusuario/roles (dueño + varios cobradores).** Hoy toda tu seguridad depende de que cada tabla solo deje ver/editar filas donde `user_id = auth.uid()` (RLS estricto por usuario, confirmado en tu `SUPABASE_SETUP.md`). Agregar roles significa reescribir esas políticas para que un "dueño" pueda ver los datos de varios "cobradores" — si me equivoco en una sola política, un cobrador podría terminar viendo o editando los datos de otro negocio. No quise arriesgar tu seguridad actual con un cambio de esa magnitud sin poder probarlo contra tu base real. Si quieres seguir con esto, mi sugerencia es hacerlo en un proyecto de Supabase de prueba primero, revisando cada política una por una antes de aplicarla en producción.
- **Notificaciones push reales (con la app cerrada).** Requieren un servicio de push (VAPID keys + un backend o función programada que las dispare, por ejemplo un cron en Supabase Edge Functions). Esta app es un PWA estático + Supabase, sin ese backend todavía. Implementé la alternativa que sí es posible sin infraestructura nueva: un aviso local mientras la app está abierta.

## 5. Otros hallazgos al revisar el código de nuevo

- El reintento automático de pagos offline ahora tiene un tope (5 intentos) — antes reintentaba para siempre cada 60 segundos aunque el problema fuera un dato inválido y no la señal, sin nunca avisarle al cobrador.
- Crear cliente o préstamo sin conexión ahora avisa antes de intentarlo, en vez de fallar sin explicación.
- El campo `orden` de clientes sigue siendo un entero simple sin bloqueo de escritura simultánea entre dos dispositivos (mencionado en la ronda anterior). Con el historial nuevo al menos puedes ver y detectar si alguien más lo cambió, aunque no hay un aviso automático "esto cambió mientras editabas" — si usas la app desde un solo dispositivo a la vez esto no te afecta en la práctica.

## 6. Ideas que quedan para más adelante

- Multiusuario/roles (ver sección 4).
- Push real con backend.
- Vincular cada `cargo_mora` a los pagos que efectivamente lo cubren, para contar la mora como ganancia solo cuando se cobra, no cuando se aplica.
- Exportar reportes también a PDF, además del CSV ya disponible.
