# Análisis de App Cobros

Este documento explica cómo funciona la app hoy, qué implementé en esta ronda, una corrección a mi análisis anterior, y qué queda pendiente y por qué.

## -5. Ronda nueva (2026-07-21, noche): simplificar reportes

**📋 Movimientos del día (nuevo, en Inicio).** Dentro de la caja diaria, un enlace "▸ Ver movimientos de hoy" — escondido por defecto — que al tocarlo despliega cada préstamo entregado, cada cobro (con el nombre del cliente) y cada gasto de ese día, uno por uno. Los aportes propios no se repiten ahí porque ya se ven justo arriba, en su propia lista editable.

**📒 Flujo de caja día por día — ahora colapsable y con utilidad acumulada.** En Reportes, esa tabla ahora viene escondida por defecto (botón "📒 Ver flujo de caja día por día"), y se agregó una columna "Utilidad acum." que va sumando la utilidad de cada día dentro del período que se está viendo — para ver cómo se acumula la ganancia real, no solo el número suelto de cada día.

**🔢 Tarjetas de resumen reorganizadas.** Las 7 tarjetas de arriba (Desembolso nuevo, Cobrado, Gastos, Flujo de caja, Ganancia por intereses, Mora cobrada, Ganancia neta) ahora se ven en 2 niveles: "Flujo de caja" y "Ganancia neta" grandes arriba (son las 2 respuestas que más importan), y las otras 5 más pequeñas debajo, como el detalle que arma esos dos números.

**📊 3 exportaciones de Excel separadas (nuevo), en vez de un solo archivo con todo:**
- **"Resumen general"** — el histórico completo desde que arrancó la cartera hasta hoy: capital inicial, total prestado, cobrado, ganancia por intereses, mora, gastos, ganancia neta y cartera activa. Una sola hoja, para ver "cómo va todo" de un vistazo.
- **"Reporte diario"** — el día puntual que se esté viendo (o hoy, si no hay un reporte de tipo "día" abierto): base con la que inició, préstamos entregados, cobrado, gastos y con cuánto cerró, más una hoja de todos los clientes de ese día (quién pagó, quién no, y qué le falta).
- **"Reporte del período"** — para semana/mes/año/rango: el resumen de ese período más el Libro diario completo (con la utilidad acumulada nueva).

El botón anterior **"Exportar todo a Excel"** (con las 8 hojas de detalle: Clientes, Préstamos, Pagos, Gastos, Refinanciamientos, etc.) se mantuvo, pero ahora vive escondido bajo "▸ Exportación completa (avanzada, para contabilidad)", para quien de verdad necesite ese nivel de detalle sin que estorbe a quien solo quiere los 3 reportes simples de arriba.

No se necesita ninguna migración nueva de Supabase para esta ronda — todo se construyó sobre datos que ya existían (pagos, gastos, préstamos, aportes_capital).

## -4. Ronda nueva (2026-07-21): cartera inicial, libro diario en Reportes y fecha DD/MM/AAAA

**💰 Cartera/capital inicial (nuevo).** Es el monto de una sola vez con el que arrancó el negocio (distinto de la base diaria de la caja, que cambia todos los días). Se configura desde Configuración → "Cartera / capital inicial" (nuevo `js/capital.js`), queda fijo con su fecha, y se muestra como tarjeta destacada arriba de Reportes. Sirve como punto de partida del libro diario cuando el reporte incluye días anteriores a que existiera la caja automática.

**📒 Libro diario en Reportes (nuevo).** Tabla día por día con las columnas `Fecha | Base | Préstamos | Cobro | Gasto | Utilidad | Utilidad % | Cierre`, más una fila de totales del período — es el mismo formato que ya llevaba el cliente a mano (Fecha, Préstamos, Utilidad, Utilidad total/%, Cobro, Gasto, Base), agregando "Cierre" para que además sirva como flujo de caja diario. "Utilidad" es solo la parte de interés/mora que es ganancia real (no el capital que regresa); "Utilidad %" es esa utilidad sobre lo cobrado ese día. Se exporta tanto en el botón CSV del reporte como en una hoja nueva "Libro diario" dentro de "Exportar todo a Excel".

**🗓️ Reportes por rango de fechas (nuevo).** Se agregó la opción "Rango de fechas (desde/hasta)" al selector de tipo de reporte, además de día/semana/mes/año que ya existían.

**📅 Fechas en formato DD/MM/AAAA (nuevo).** Se agregó `formatoFecha()` (en `js/navegacion.js`) y se aplicó en todos los lugares donde una fecha se **muestra** en pantalla (historial de pagos, préstamos, gastos, comprobantes, caja de otro día). Esto no cambia cómo se guardan las fechas en la base de datos ni cómo funcionan los `<input type="date">` (esos siguen usando AAAA-MM-DD internamente, como debe ser).

**Nueva migración que debes correr en Supabase:** `supabase/migrations/20260731_capital_inicial.sql` — agrega `capital_inicial` y `capital_inicial_fecha` a `preferencias_usuario`, y crea la tabla `historial_capital_inicial`.


## -3. Ronda nueva (2026-07-19, noche): quitar metas, caja diaria con base automática y efectivo propio

**❌ Metas de recaudo — eliminadas por completo.** Se quitó el bloque del Inicio, el botón en Configuración, y las funciones `editarMetas`/`obtenerMetas`/`cargarProgresoMetas`. La tabla `metas` en Supabase no se borró (por si acaso), pero la app ya no la usa ni la incluye en el respaldo manual.

**💰 Caja diaria — mejorada con dos cosas:**
1. **Base automática heredada del día anterior.** Antes había que escribir a mano cada mañana con cuánto efectivo se empezaba. Ahora, al tocar "Abrir caja", la app ya trae precargado (pero editable) lo que debería quedar de ayer: si cerraste caja ayer contando el efectivo real, usa ese número; si no la cerraste, calcula lo que teóricamente debería haber quedado (base + cobros + aportes − gastos − prestado de ayer). Siempre puedes corregirlo si contaste algo distinto.
2. **Efectivo propio, separado de la cartera.** Nuevo botón "➕ Agregar efectivo propio" dentro de la caja diaria, para cuando el cobrador mete plata de su bolsillo (no del negocio) — por ejemplo, para completar un préstamo. Queda en una tabla aparte (`aportes_capital`, con fecha, monto y nota opcional), se suma al efectivo esperado del día, pero no se mezcla con los cobros reales en los reportes de ganancia.

**Nueva migración que debes correr en Supabase:**
`supabase/migrations/20260724_aportes_capital.sql` — crea la tabla `aportes_capital` con su RLS. Sin esta migración, el botón de "Agregar efectivo propio" va a fallar (con un mensaje en español explicando que falta la actualización).


## -2. Ronda nueva (2026-07-19, tarde): simplificar, push real, y seguridad/consistencia

**Simplificado / quitado:**
- El historial completo de pagos ahora muestra los últimos 20 registros con un link "Ver los N pagos anteriores" — antes cargaba todo de una vez, y con clientes viejos se volvía una lista eterna.
- Se fusionaron los botones "Parcial" y "📅 Ponerse al día" en uno solo: cuando el cliente está atrasado, el botón central de la tarjeta cambia a "Registrar pago 💰" y ya viene precargado con el total que debe (editable). Cuando está al día, sigue siendo "Parcial ⚠️" como antes. Menos botones, mismo resultado.
- Las notas del cliente ya no se muestran en las tarjetas de las listas (Clientes y Cobrar) — solo quedan visibles/editables dentro del detalle del cliente, para no ensuciar la vista general.

**🔔 Notificaciones push reales:**
- Antes solo existía el recordatorio local (notificación programada por el navegador, que solo funciona con la app abierta o recién cerrada). Ahora hay un sistema real de push: se activa en Configuración → "Notificaciones push", y una Edge Function de Supabase (`recordatorios-push`) corre una vez al día y le avisa a cada cobrador, en su celular, cuántas cuotas le vencen mañana — **aunque la app esté completamente cerrada**.
- Requiere pasos de configuración únicos en Supabase (llaves VAPID, secretos, desplegar la función y programarla con `pg_cron`). Todo está documentado paso a paso en `SUPABASE_SETUP.md`, sección "Activar notificaciones push reales". **Sin esos pasos, el botón de Configuración se activa pero nadie recibirá push real** (solo quedará la suscripción guardada, esperando a que actives la función).

**🔒 Seguridad y consistencia:**
- Si activaste el PIN en un celular y luego abres la app en otro (o reinstalaste), ahora te lo recuerda una vez al día: "en otro celular tenías el PIN activado, ¿lo activas aquí también?". El indicador (`pin_activado_alguna_vez`) se guarda en Supabase — nunca el PIN en sí.
- Los gastos ahora se pueden etiquetar opcionalmente con una ruta (selector "General" por defecto). Antes todos los gastos quedaban sueltos, sin poder saber si la gasolina de tal día fue de una ruta en particular.
- **Decisión consciente:** la caja diaria (`caja_diaria`) se queda global, sin ruta — representa el efectivo físico real que el cobrador trae en el bolsillo, que normalmente es uno solo aunque cubra varias rutas en el día. Separarla por ruta habría sido forzar una separación de dinero que, en la práctica, no suele existir así.

**Nuevas migraciones que debes correr en Supabase (en este orden, después de las anteriores):**
1. `supabase/migrations/20260722_push_y_preferencias.sql` — crea `push_subscriptions`, `preferencias_usuario`, y agrega `gastos.ruta_id`.
2. Sigue la guía de `SUPABASE_SETUP.md` para dejar funcionando la Edge Function de push (si no la configuras, todo lo demás de la app sigue funcionando igual, simplemente no llegarán notificaciones push reales).


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
