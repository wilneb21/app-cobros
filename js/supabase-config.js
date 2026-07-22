// ⚠️ Verifica que sean tus valores reales
const SUPABASE_URL = "https://sgaispueisunccflbahk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Tr-FIcJTBAt9ebTKrf1HXw_-PVzSvjn";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Clave pública VAPID para notificaciones push (ver js/push.js). La privada
// NUNCA va en el frontend — vive solo como secreto en la Edge Function.
// ⚠️ Genera tu propio par de llaves para producción (ver SUPABASE_SETUP.md).
const VAPID_PUBLIC_KEY = "BNnJdT6j_rHGlHZTJV1e3kPfEQ9LfxN-ccUfqdN1jFeqhXZwIj2vAkzONBCBsHPw1eaAwz79VXq0RXpjJrg7KNk";

// --- TRADUCTOR DE ERRORES ---
// Supabase/Postgres siempre devuelven sus mensajes de error en inglés. Esta
// función los traduce a algo que un cobrador (sin conocimientos técnicos)
// entienda, en español. El mensaje original queda en la consola por si
// soporte técnico lo necesita, pero nunca se le muestra al usuario en inglés.
function requiereConexion() {
  if (!navigator.onLine) {
    mostrarAlerta("📴 Necesitas conexión a internet para hacer esto. Los pagos sí se guardan sin señal, pero crear o editar clientes, préstamos, rutas y gastos necesita estar conectado.");
    return false;
  }
  return true;
}

function traducirErrorSupabase(error) {
  console.error("Error original:", error);
  const mensaje = (error?.message || String(error || "")).toLowerCase();

  if (!navigator.onLine || mensaje.includes("failed to fetch") || mensaje.includes("network") || mensaje.includes("load failed")) {
    return "No hay conexión a internet. Verifica tu señal e intenta de nuevo.";
  }
  if (mensaje.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (mensaje.includes("user already registered")) return "Ya existe una cuenta con ese correo.";
  if (mensaje.includes("email not confirmed")) return "Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.";
  if (mensaje.includes("unable to validate email") || mensaje.includes("invalid format")) return "El correo no tiene un formato válido.";
  if (mensaje.includes("for security purposes")) return "Por seguridad, espera un momento antes de volver a intentarlo.";
  if (mensaje.includes("password") && (mensaje.includes("character") || mensaje.includes("short"))) return "La contraseña debe tener al menos 8 caracteres.";
  if (mensaje.includes("duplicate key") || mensaje.includes("already exists")) return "Ya existe un registro con ese mismo dato.";
  if (mensaje.includes("violates foreign key")) return "No se puede completar porque hay información relacionada (por ejemplo, préstamos o pagos) que depende de esto.";
  if (mensaje.includes("null value in column") || mensaje.includes("violates not-null")) return "Falta completar un dato obligatorio.";
  if (mensaje.includes("row-level security") || mensaje.includes("permission denied")) return "No tienes permiso para hacer esta acción.";
  if (mensaje.includes("does not exist") && (mensaje.includes("relation") || mensaje.includes("column") || mensaje.includes("function"))) {
    return "Falta ejecutar una actualización de la base de datos (migración de Supabase) antes de poder usar esta función.";
  }
  if (mensaje.includes("jwt") || mensaje.includes("token")) return "Tu sesión expiró. Cierra sesión y vuelve a entrar.";
  if (mensaje.includes("timeout")) return "El servidor tardó demasiado en responder. Intenta de nuevo.";

  return "Ocurrió un error inesperado. Intenta de nuevo. Si el problema sigue, avísale a soporte técnico.";
}

function obtenerFechaLocal() {
  const formateador = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
  });
  return formateador.format(new Date());
}

function formatearMoneda(input) {
  input.addEventListener("input", () => {
    let valor = input.value.replace(/\D/g, "");
    input.value = valor ? "$" + Number(valor).toLocaleString("es-CO") : "";
  });
}

function obtenerValorNumerico(input) {
  return parseFloat(input.value.replace(/\D/g, "")) || 0;
}

// --- ORDEN COMPARTIDO: RUTAS → CLIENTES Y COBRAR ---
// El orden manual que el cobrador define en "Rutas → Ordenar clientes" (columna
// clientes.orden) es la fuente única de verdad. Esta función se usa tanto en
// la lista de Clientes como en Cobrar, para que ambas respeten ese mismo orden
// en vez de mostrar todo alfabético.
function compararClientesPorRutaYOrden(a, b) {
  const rutaA = a.rutas?.nombre || null;
  const rutaB = b.rutas?.nombre || null;
  if (rutaA !== rutaB) {
    if (rutaA === null) return 1; // "Sin ruta" siempre al final
    if (rutaB === null) return -1;
    return rutaA.localeCompare(rutaB);
  }
  const ordenA = a.orden ?? 9999;
  const ordenB = b.orden ?? 9999;
  if (ordenA !== ordenB) return ordenA - ordenB;
  return a.nombre.localeCompare(b.nombre);
}

function formatoPesos(numero) {
  return "$" + Number(numero).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>\"']/g, caracter => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[caracter]);
}

// --- CÁLCULO CENTRAL DEL SALDO DE UN PRÉSTAMO ---
// Antes esta cuenta estaba copiada (con pequeñas diferencias) en 7 lugares
// distintos del código: algunas pantallas sumaban la mora aplicada al saldo
// y otras no, así que un mismo crédito con mora podía mostrar dos saldos
// distintos según en qué pantalla estuvieras. Ahora toda la app pasa por
// estas dos funciones — es la única fuente de verdad.

// Total que el cliente debe pagar por un préstamo: capital + interés (sin
// mora). Interés simple, calculado una sola vez sobre el monto prestado.
function calcularTotalConInteres(montoPrestado, interesPorcentaje) {
  return Number(montoPrestado) * (1 + (Number(interesPorcentaje) || 0) / 100);
}

// Saldo pendiente real de un préstamo: total con interés + mora ya aplicada
// (columna prestamos.mora_acumulada) menos lo que ya pagó. Nunca baja de $0.
// "prestamo" puede venir de un select("*") o de un select parcial, siempre
// que incluya monto_prestado, interes_porcentaje y (opcionalmente) mora_acumulada.
function calcularSaldoPendiente(prestamo, totalPagado) {
  const total = calcularTotalConInteres(prestamo.monto_prestado, prestamo.interes_porcentaje);
  const mora = Number(prestamo.mora_acumulada) || 0;
  return Math.max(total + mora - Number(totalPagado || 0), 0);
}

// Calcula cuánto efectivo REALMENTE salió de la caja para una lista de préstamos.
// Si un préstamo es un refinanciamiento (trae prestamo_anterior_id), el saldo que
// se traslada del crédito viejo no es billete nuevo — solo se entrega en efectivo
// la parte ADICIONAL (si el cobrador decidió prestar algo extra al renovar).
async function calcularDesembolsoReal(prestamos) {
  let total = 0;
  for (const p of prestamos || []) {
    if (!p.prestamo_anterior_id) { total += Number(p.monto_prestado); continue; }
    const { data: viejo } = await supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje, mora_acumulada").eq("id", p.prestamo_anterior_id).single();
    if (!viejo) { total += Number(p.monto_prestado); continue; }
    const { data: pagosViejo } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", p.prestamo_anterior_id).lte("fecha_pago", p.fecha_inicio);
    const pagadoViejo = (pagosViejo || []).reduce((s, pg) => s + Number(pg.monto_pagado), 0);
    const saldoViejo = calcularSaldoPendiente(viejo, pagadoViejo);
    total += Math.max(Number(p.monto_prestado) - saldoViejo, 0);
  }
  return total;
}

// --- DÍAS FESTIVOS DE COLOMBIA (calculados solos, sin que nadie los agregue) ---
// Incluye los 6 fijos, los que la Ley Emiliani corre al lunes siguiente, y
// los 4 que dependen de la Pascua (Jueves y Viernes Santo no se corren;
// Ascensión, Corpus Christi y Sagrado Corazón sí se corren al lunes).
// Se calculan una sola vez por año y quedan en memoria (funciona sin
// conexión, algo que la lista guardada en la base de datos no podía hacer).
const cacheFestivosPorAnio = {};

function calcularDomingoDePascua(anio) {
  // Algoritmo de Meeus/Jones/Butcher (calendario gregoriano)
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexado
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes, dia);
}

function formatoFechaISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sumarDiasAFecha(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
}

// Ley Emiliani: si el festivo no cae en lunes, se traslada al lunes siguiente (o se queda si ya es lunes).
function trasladarALunes(fecha) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + (8 - d.getDay()) % 7);
  return d;
}

function obtenerFestivosColombia(anio) {
  if (cacheFestivosPorAnio[anio]) return cacheFestivosPorAnio[anio];

  const pascua = calcularDomingoDePascua(anio);
  const fijos = [
    new Date(anio, 0, 1),   // Año Nuevo
    new Date(anio, 4, 1),   // Día del Trabajo
    new Date(anio, 6, 20),  // Día de la Independencia
    new Date(anio, 7, 7),   // Batalla de Boyacá
    new Date(anio, 11, 8),  // Inmaculada Concepción
    new Date(anio, 11, 25), // Navidad
  ];
  const trasladables = [
    new Date(anio, 0, 6),   // Reyes Magos
    new Date(anio, 2, 19),  // San José
    new Date(anio, 5, 29),  // San Pedro y San Pablo
    new Date(anio, 7, 15),  // Asunción de la Virgen
    new Date(anio, 9, 12),  // Día de la Raza
    new Date(anio, 10, 1),  // Todos los Santos
    new Date(anio, 10, 11), // Independencia de Cartagena
  ].map(trasladarALunes);
  const semanaSanta = [
    sumarDiasAFecha(pascua, -3), // Jueves Santo (no se traslada)
    sumarDiasAFecha(pascua, -2), // Viernes Santo (no se traslada)
  ];
  const basadosEnPascuaTrasladables = [
    trasladarALunes(sumarDiasAFecha(pascua, 39)), // Ascensión del Señor
    trasladarALunes(sumarDiasAFecha(pascua, 60)), // Corpus Christi
    trasladarALunes(sumarDiasAFecha(pascua, 68)), // Sagrado Corazón de Jesús
  ];

  const set = new Set([...fijos, ...trasladables, ...semanaSanta, ...basadosEnPascuaTrasladables].map(formatoFechaISO));
  cacheFestivosPorAnio[anio] = set;
  return set;
}

function esFestivoColombia(fechaTexto) {
  const anio = Number(fechaTexto.slice(0, 4));
  return obtenerFestivosColombia(anio).has(fechaTexto);
}

function esDomingo(fechaTexto) {
  const [a, m, d] = fechaTexto.split("-").map(Number);
  return new Date(a, m - 1, d).getDay() === 0;
}

// --- CUÁNTAS CUOTAS DEBERÍA LLEVAR PAGADAS UN PRÉSTAMO A UNA FECHA DADA ---
// Antes esta cuenta (duplicada en 3 archivos) era simplemente "días
// transcurridos + 1" para cuotas diarias. Ahora, si el préstamo tiene
// contar_domingos_festivos = false, los domingos y los días que estén en la
// lista de festivos del usuario NO cuentan como día de cuota — para negocios
// que no cobran esos días. Las cuotas semanales no cambian.
async function calcularCuotasEsperadas(prestamo, fechaHoy) {
  const diasTranscurridos = Math.floor((new Date(fechaHoy + "T00:00:00") - new Date(prestamo.fecha_inicio + "T00:00:00")) / (1000 * 60 * 60 * 24));
  if (prestamo.frecuencia !== "diario") {
    return Math.min(Math.floor(diasTranscurridos / 7) + 1, prestamo.numero_cuotas);
  }
  if (prestamo.contar_domingos_festivos !== false) {
    return Math.min(diasTranscurridos + 1, prestamo.numero_cuotas);
  }
  let cuotas = 0;
  let cursor = prestamo.fecha_inicio;
  while (cursor <= fechaHoy && cuotas < prestamo.numero_cuotas) {
    if (!esDomingo(cursor) && !esFestivoColombia(cursor)) cuotas++;
    cursor = sumarDias(cursor, 1);
  }
  return cuotas;
}

// --- MORA AUTOMÁTICA ---
// Se dispara una sola vez por sesión (al abrir Inicio), para no llamar la
// función de Supabase en cada pantalla. Si la migración 20260803 todavía no
// está instalada, falla en silencio (no interrumpe el uso normal de la app).
let moraAutomaticaEjecutada = false;
async function asegurarMoraAutomatica() {
  if (moraAutomaticaEjecutada) return;
  moraAutomaticaEjecutada = true;
  try { await supabaseClient.rpc("aplicar_mora_automatica"); } catch { /* silencioso: probablemente falta la migración */ }
}

// Escapa un texto para poder insertarlo de forma segura dentro de un atributo
// onclick="funcion('...')": protege comillas simples/backslashes (para el JS)
// y además comillas dobles/otros caracteres HTML (para el atributo).
function escaparAtributoJs(valor) {
  const escapadoJs = String(valor ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return escaparHtml(escapadoJs);
}

// Arma una URL de Google Maps que visita varias direcciones en el orden dado.
// Con 1 sola dirección abre una búsqueda simple; con 2 o más arma una ruta con paradas.
function construirUrlMapaClientes(direcciones) {
  const validas = (direcciones || []).filter(d => d && d.trim()).map(d => encodeURIComponent(d.trim()));
  if (validas.length === 0) return null;
  if (validas.length === 1) return `https://www.google.com/maps/search/?api=1&query=${validas[0]}`;
  const destino = validas[validas.length - 1];
  const paradas = validas.slice(0, -1).join("|");
  return `https://www.google.com/maps/dir/?api=1&destination=${destino}&waypoints=${paradas}&travelmode=driving`;
}

function validarMontoPositivo(monto, etiqueta = "El monto") {
  if (!Number.isFinite(monto) || monto <= 0) {
    mostrarAlerta(`${etiqueta} debe ser mayor que cero.`);
    return false;
  }
  return true;
}

async function obtenerUsuarioActual() {
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (error || !user) {
    await cerrarSesion();
    throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
  }
  return user;
}
