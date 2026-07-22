formatearMoneda(document.getElementById("gasto-monto"));

// --- MODAL "REGISTRAR GASTO" (junto a la caja diaria en Inicio) ---
function abrirModalGastos() {
  if (!document.getElementById("gasto-fecha").value) document.getElementById("gasto-fecha").value = obtenerFechaLocal();
  cargarRutasEnSelectorGasto();
  document.getElementById("modal-gastos").classList.remove("oculto");
  empujarEstadoModal("modal-gastos");
}

function cerrarModalGastos() {
  cerrarModalConHistorial("modal-gastos");
}

// --- MODAL "HISTORIAL DE GASTOS" ---
// Se abre por separado (no queda siempre visible) para no saturar la
// pantalla; al abrirse trae TODO el historial (sin filtro de fechas).
function abrirHistorialGastos() {
  document.getElementById("modal-historial-gastos").classList.remove("oculto");
  empujarEstadoModal("modal-historial-gastos");
  cargarGastosDelPeriodo();
}

function cerrarHistorialGastos() {
  cerrarModalConHistorial("modal-historial-gastos");
}

async function cargarRutasEnSelectorGasto() {
  const select = document.getElementById("gasto-ruta");
  if (!select || select.dataset.cargado) return;
  const { data: rutas, error } = await supabaseClient.from("rutas").select("id, nombre").order("nombre");
  if (error) return;
  select.innerHTML = '<option value="">General (no aplica a una ruta)</option>'
    + rutas.map(r => `<option value="${r.id}">${escaparHtml(r.nombre)}</option>`).join("");
  select.dataset.cargado = "1";
}

async function crearGasto(event) {
  event.preventDefault();
  if (!requiereConexion()) return;
  const concepto = document.getElementById("gasto-concepto").value.trim();
  const monto = obtenerValorNumerico(document.getElementById("gasto-monto"));
  const fecha = document.getElementById("gasto-fecha").value;
  const rutaId = document.getElementById("gasto-ruta").value;
  if (!concepto || !fecha || !validarMontoPositivo(monto, "El gasto")) return;
  const user = await obtenerUsuarioActual();

  const { error } = await supabaseClient.from("gastos").insert({
    concepto, monto, fecha, ruta_id: rutaId || null, user_id: user.id
  });

  if (error) { mostrarAlerta("Error al registrar gasto: " + traducirErrorSupabase(error)); return; }

  document.getElementById("gasto-concepto").value = "";
  document.getElementById("gasto-monto").value = "";
  document.getElementById("gasto-fecha").value = obtenerFechaLocal();
  document.getElementById("gasto-ruta").value = "";
  // Si el historial está abierto, se refresca; y como un gasto cambia el
  // cálculo de la caja diaria, esa tarjeta de Inicio también se actualiza.
  cargarGastosDelPeriodo();
  if (typeof cargarCajaDiaria === "function") cargarCajaDiaria();
}

async function cargarGastosDelPeriodo(inicio, fin) {
  let query = supabaseClient.from("gastos").select("*, rutas(nombre)").order("fecha", { ascending: false });
  if (inicio && fin) query = query.gte("fecha", inicio).lt("fecha", fin);

  const { data: gastos, error } = await query;
  if (error) { mostrarAlerta("No fue posible cargar los gastos."); return 0; }

  const contenedor = document.getElementById("lista-gastos");
  contenedor.innerHTML = gastos.length === 0
    ? `<div class="estado-vacio">Sin gastos registrados en este período.</div>`
    : gastos.map(g => `
        <div class="fila-historial">
          <span>${formatoFecha(g.fecha)}</span><span>${escaparHtml(g.concepto)}${g.rutas ? ` · 📍 ${escaparHtml(g.rutas.nombre)}` : ""}</span>
          <span>${formatoPesos(g.monto)}</span>
          <span class="btn-borrar-gasto" role="button" tabindex="0" aria-label="Eliminar gasto" onclick="eliminarGasto(${g.id})">🗑️</span>
        </div>`).join("");

  return gastos.reduce((s, g) => s + Number(g.monto), 0);
}

async function eliminarGasto(gastoId) {
  if (!requiereConexion()) return;
  const confirmado = await mostrarConfirmacion("¿Eliminar este gasto? Esto lo borra por completo (no solo de esta lista) y no se puede deshacer.");
  if (!confirmado) return;
  // .select() después de delete() no es solo cosmético: si RLS bloquea el
  // borrado (por ejemplo, falta la política de "delete" en la tabla), Supabase
  // no devuelve ningún error — simplemente no borra nada — así que sin este
  // chequeo la app diría "eliminado" aunque el gasto siguiera intacto en la
  // base de datos y volviera a aparecer en Reportes.
  const { data, error } = await supabaseClient.from("gastos").delete().eq("id", gastoId).select("id");
  if (error) { mostrarAlerta("No fue posible eliminar el gasto: " + traducirErrorSupabase(error)); return; }
  if (!data || data.length === 0) {
    mostrarAlerta("El gasto no se pudo eliminar (no tienes permiso para borrarlo). Aplica la migración 20260801_permitir_borrar_gastos.sql en Supabase y vuelve a intentar.");
    return;
  }
  cargarGastosDelPeriodo();
  if (typeof cargarCajaDiaria === "function") cargarCajaDiaria();
}
