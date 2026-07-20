formatearMoneda(document.getElementById("gasto-monto"));

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
  cargarGastosDelPeriodo();
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
          <span>${g.fecha}</span><span>${escaparHtml(g.concepto)}${g.rutas ? ` · 📍 ${escaparHtml(g.rutas.nombre)}` : ""}</span>
          <span>${formatoPesos(g.monto)}</span>
          <span class="btn-borrar-gasto" onclick="eliminarGasto(${g.id})">🗑️</span>
        </div>`).join("");

  return gastos.reduce((s, g) => s + Number(g.monto), 0);
}

async function eliminarGasto(gastoId) {
  if (!requiereConexion()) return;
  const confirmado = await mostrarConfirmacion("¿Eliminar este gasto?");
  if (!confirmado) return;
  const { error } = await supabaseClient.from("gastos").delete().eq("id", gastoId);
  if (error) { mostrarAlerta("No fue posible eliminar el gasto."); return; }
  cargarGastosDelPeriodo();
}
