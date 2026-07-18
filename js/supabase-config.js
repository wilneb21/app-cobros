// ⚠️ Verifica que sean tus valores reales
const SUPABASE_URL = "https://sgaispueisunccflbahk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Tr-FIcJTBAt9ebTKrf1HXw_-PVzSvjn";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function formatoPesos(numero) {
  return "$" + Number(numero).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>\"']/g, caracter => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[caracter]);
}

// Calcula cuánto efectivo REALMENTE salió de la caja para una lista de préstamos.
// Si un préstamo es un refinanciamiento (trae prestamo_anterior_id), el saldo que
// se traslada del crédito viejo no es billete nuevo — solo se entrega en efectivo
// la parte ADICIONAL (si el cobrador decidió prestar algo extra al renovar).
async function calcularDesembolsoReal(prestamos) {
  let total = 0;
  for (const p of prestamos || []) {
    if (!p.prestamo_anterior_id) { total += Number(p.monto_prestado); continue; }
    const { data: viejo } = await supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje").eq("id", p.prestamo_anterior_id).single();
    if (!viejo) { total += Number(p.monto_prestado); continue; }
    const { data: pagosViejo } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", p.prestamo_anterior_id).lte("fecha_pago", p.fecha_inicio);
    const pagadoViejo = (pagosViejo || []).reduce((s, pg) => s + Number(pg.monto_pagado), 0);
    const saldoViejo = Math.max(Number(viejo.monto_prestado) * (1 + Number(viejo.interes_porcentaje) / 100) - pagadoViejo, 0);
    total += Math.max(Number(p.monto_prestado) - saldoViejo, 0);
  }
  return total;
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
