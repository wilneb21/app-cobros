// --- BÚSQUEDA GLOBAL DE CLIENTES ---
// El buscador que se abre con la lupa del encabezado.

// --- BÚSQUEDA GLOBAL ---
function abrirBusquedaGlobal() {
  document.getElementById("modal-busqueda").classList.remove("oculto");
  document.getElementById("input-busqueda-global").value = "";
  document.getElementById("resultados-busqueda-global").innerHTML = "";
  document.getElementById("input-busqueda-global").focus();
  empujarEstadoModal("modal-busqueda");
}

function cerrarBusquedaGlobal() {
  cerrarModalConHistorial("modal-busqueda");
}

function ejecutarBusquedaGlobal() {
  const texto = document.getElementById("input-busqueda-global").value.toLowerCase();
  const contenedor = document.getElementById("resultados-busqueda-global");

  if (!texto) { contenedor.innerHTML = ""; return; }

  const fuente = (typeof clientesCache !== "undefined" && clientesCache.length > 0) ? clientesCache : clientesCobrarCache;
  const resultados = (fuente || []).filter(c => c.nombre.toLowerCase().includes(texto));

  contenedor.innerHTML = resultados.length === 0
    ? `<div class="estado-vacio">Sin resultados para "${escaparHtml(texto)}"</div>`
    : resultados.map(c => `
        <div class="tarjeta cliente-clickable" onclick="irADetalleDesdeBusqueda(${c.id})">
          <strong>${escaparHtml(c.nombre)}</strong>
          <span>📍 ${escaparHtml(c.rutas ? c.rutas.nombre : "sin ruta")}</span>
        </div>`).join("");
}

function irADetalleDesdeBusqueda(clienteId) {
  cerrarBusquedaGlobal();
  mostrarSeccion("clientes");
  abrirDetalleCliente(clienteId);
}

