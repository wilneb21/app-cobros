// --- NAVEGACIÓN GENERAL DE LA APP ---
// Antes vivía mezclado dentro de main.js junto con caja, búsqueda, tema
// e Inicio. Aquí solo queda lo que mueve a la persona entre secciones y
// un par de utilidades muy pequeñas y genéricas (fechas, indicador de carga).

let periodoInicioActivo = "hoy";

function mostrarSeccion(nombre, desdeHistorial = false, opciones = {}) {
  document.querySelectorAll(".seccion").forEach(sec => sec.classList.add("oculto"));
  document.getElementById("seccion-" + nombre).classList.remove("oculto");
  marcarNavActivo(nombre);

  if (nombre === "inicio") { cargarResumenDia(); cargarGraficoSemana(); cargarCajaDiaria(obtenerFechaLocal()); cargarTendenciaCobro(); cargarAgendaVencimientos(); cargarGananciaInicio(); }
  if (nombre === "clientes") cargarClientes();
  if (nombre === "prestamos") cargarClientesEnSelector(opciones.clienteId || "");
  if (nombre === "cobrar") cargarClientesParaCobrar();
  if (nombre === "cuentas") cargarCuentasPorCobrar();
  if (nombre === "rutas") cargarRutas();
  if (nombre === "configuracion") { actualizarFilaConfigBloqueo(); actualizarFilaConfigPush(); }
  if (nombre === "reportes") {
    cargarReporteMes();
    if (!document.getElementById("gasto-fecha").value) document.getElementById("gasto-fecha").value = obtenerFechaLocal();
    cargarRutasEnSelectorGasto();
  }
  cerrarMenuPrincipal();

  // Deja registrado el cambio de sección en el historial para que el botón
  // atrás del celular navegue dentro de la app en vez de salir directamente.
  if (typeof navegacionMovilPreparada !== "undefined" && navegacionMovilPreparada && !desdeHistorial) {
    if (estadoNavActual.modal) document.getElementById(estadoNavActual.modal)?.classList.add("oculto");
    if (nombre !== estadoNavActual.seccion || estadoNavActual.modal) {
      estadoNavActual = { seccion: nombre, modal: null };
      window.history.pushState(estadoNavActual, "");
    }
  }
}

function toggleMenuPrincipal() {
  const menu = document.getElementById("menu-inferior");
  if (!menu) return;
  const abierto = menu.classList.toggle("abierto");
  document.getElementById("menu-fondo")?.classList.toggle("oculto", !abierto);
  document.querySelector(".btn-menu-principal")?.setAttribute("aria-expanded", String(abierto));
}

function cerrarMenuPrincipal() {
  const menu = document.getElementById("menu-inferior");
  if (!menu) return;
  menu.classList.remove("abierto");
  document.getElementById("menu-fondo")?.classList.add("oculto");
  document.querySelector(".btn-menu-principal")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape") cerrarMenuPrincipal();
});

function marcarNavActivo(nombre) {
  document.querySelectorAll(".nav-btn, .barra-nav-btn, .btn-accion-flotante").forEach(btn => btn.classList.remove("activo"));
  document.querySelectorAll(`[data-nav="${nombre}"]`).forEach(btn => btn.classList.add("activo"));
}

// Suma días de forma segura a una fecha "YYYY-MM-DD" (sin líos de UTC)
function sumarDias(fechaTexto, dias) {
  const [a, m, d] = fechaTexto.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  fecha.setDate(fecha.getDate() + dias);
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${año}-${mes}-${dia}`;
}

// --- Indicador de carga reutilizable ---
function mostrarCargando(idContenedor) {
  const el = document.getElementById(idContenedor);
  if (el) el.innerHTML = `<div class="cargando">⏳ Cargando...</div>`;
}

