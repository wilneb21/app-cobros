# Qué cambió en esta ronda de simplificación

## ⚠️ Antes de abrir la app: 1 migración nueva que correr

Solo hay **una** migración nueva (las otras 12 ya las tenías aplicadas):

- Ve a Supabase → **SQL Editor** y ejecuta el contenido de
  `supabase/migrations/20260729_respaldo_en_servidor.sql`.
- Agrega una sola columna (`ultimo_respaldo`) a `preferencias_usuario`, para
  que el aviso de "cuándo fue tu último respaldo" viva en Supabase y no se
  pierda si cambias de celular.

De aquí en adelante, en vez de ejecutar migraciones sueltas una por una, usa
`supabase/migrations/00000000_TODO_EN_UNO.sql`: es la consolidación de las 13
migraciones existentes en un solo archivo, seguro de ejecutar aunque ya tengas
algunas aplicadas (no duplica ni falla).

## Bugs corregidos (no solo estética)

1. El saldo de "Cuentas por cobrar" no incluía la mora aplicada, y sí la
   incluía en "Cobrar" — ahora ambos usan la misma función y siempre coinciden.
2. El CSV de "Cartera" tampoco incluía la mora — corregido igual.
3. Un préstamo con mora aplicada podía marcarse como "pagado" sin haber
   cubierto esa mora — corregido.
4. La fórmula de "monto + interés", que estaba copiada en 7 lugares distintos
   del código, ahora vive en una sola función (`calcularTotalConInteres` /
   `calcularSaldoPendiente` en `js/supabase-config.js`).

## Simplificación de pantallas

- **Inicio**: se quitaron los botones de "acciones rápidas" (redundantes con
  el menú inferior); ganancia, gráficos y agenda de vencimientos quedan
  colapsados detrás de "Ver más estadísticas".
- **Tarjeta de cobro**: solo muestra estado + cuota; saldo total, mora y racha
  quedan en "Más opciones".
- **Reportes**: los totales del período y el registro de gastos quedan
  visibles; cartera por semana, rendimiento por ruta, refinanciamientos y
  exportaciones quedan en dos bloques que se abren a pedido.
- **Configuración**: separada en "Uso diario" (modo oscuro, PIN, push) y
  "Configuración del negocio" (cuadre de caja, funciones avanzadas).
- **Funciones avanzadas** (mora manual, ranking de cumplimiento): ahora están
  ocultas por defecto. Se activan desde Configuración → "Funciones avanzadas".
- **Sugerencia de cupo**: solo aparece cuando el cliente no tiene crédito
  activo (antes aparecía siempre).

## Código

- `main.js` (827 líneas, mezclaba 8 responsabilidades) se dividió en 5
  archivos: `navegacion.js`, `inicio.js`, `busqueda.js`, `preferencias.js`,
  `caja.js`. `index.html` ya está actualizado para cargarlos en el mismo orden.
- Se verificó que no queden funciones duplicadas ni referencias rotas entre
  HTML y JS.

## Lo que queda como limitación conocida (no se resolvió en esta ronda)

- La cola de pagos sin conexión sigue siendo local al celular: si un pago
  queda atascado y cambias de dispositivo antes de resolverlo, se pierde sin
  aviso. Arreglarlo de raíz requiere que la cola viva en el servidor, lo cual
  es un cambio de arquitectura más grande — avísame si quieres que lo
  encaremos aparte.
- El reordenamiento de clientes dentro de una ruta no detecta si dos
  celulares lo editan al mismo tiempo. Solo importa si más de un cobrador usa
  la app a la vez; si es tu caso, dímelo y lo resolvemos.
