formatearMoneda(document.getElementById("gasto-monto"));

async function crearGasto(event) {
  event.preventDefault();
  const concepto = document.getElementById("gasto-concepto").value.trim();
  const monto = obtenerValorNumerico(document.getElementById("gasto-monto"));
  const fecha = document.getElementById("gasto-fecha").value;
  if (!concepto || !fecha || !validarMontoPositivo(monto, "El gasto")) return;
  const user = await obtenerUsuarioActual();

  const { error } = await supabaseClient.from("gastos").insert({
    concepto, monto, fecha, user_id: user.id
  });

  if (error) { mostrarAlerta("Error al registrar gasto: " + error.message); return; }

  document.getElementById("gasto-concepto").value = "";
  document.getElementById("gasto-monto").value = "";
  document.getElementById("gasto-fecha").value = "";
  cargarGastosDelPeriodo();
}

async function cargarGastosDelPeriodo(inicio, fin) {
  let query = supabaseClient.from("gastos").select("*").order("fecha", { ascending: false });
  if (inicio && fin) query = query.gte("fecha", inicio).lt("fecha", fin);

  const { data: gastos, error } = await query;
  if (error) { mostrarAlerta("No fue posible cargar los gastos."); return 0; }

  const contenedor = document.getElementById("lista-gastos");
  contenedor.innerHTML = gastos.length === 0
    ? `<div class="estado-vacio">Sin gastos registrados en este período.</div>`
    : gastos.map(g => `
        <div class="fila-historial">
          <span>${g.fecha}</span><span>${escaparHtml(g.concepto)}</span>
          <span>${formatoPesos(g.monto)}</span>
          <span class="btn-borrar-gasto" onclick="eliminarGasto(${g.id})">🗑️</span>
        </div>`).join("");

  return gastos.reduce((s, g) => s + Number(g.monto), 0);
}

async function eliminarGasto(gastoId) {
  const confirmado = await mostrarConfirmacion("¿Eliminar este gasto?");
  if (!confirmado) return;
  const { error } = await supabaseClient.from("gastos").delete().eq("id", gastoId);
  if (error) { mostrarAlerta("No fue posible eliminar el gasto."); return; }
  cargarGastosDelPeriodo();
}
