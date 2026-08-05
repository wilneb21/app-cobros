// --- PREFERENCIAS DE LA APP (modo oscuro y funciones avanzadas) ---
// Ajustes simples que se guardan en este celular (localStorage).

// --- MODO OSCURO ---
// Tarjeta con el correo de la cuenta que inició sesión, arriba de Configuración.
async function pintarPerfilConfig() {
  const contenedor = document.getElementById("perfil-config");
  if (!contenedor) return;
  try {
    const user = await obtenerUsuarioActual();
    const correo = user.email || "Tu cuenta";
    contenedor.innerHTML = `
      <div class="perfil-config">
        <span class="avatar-perfil-config">${correo.charAt(0).toUpperCase()}</span>
        <div><strong>${escaparHtml(correo)}</strong><small>Cuenta principal</small></div>
      </div>`;
  } catch { /* si la sesión expiró, obtenerUsuarioActual ya redirige al login */ }
}

function toggleModoOscuro() {
  document.body.classList.toggle("modo-oscuro");
  const activo = document.body.classList.contains("modo-oscuro");
  localStorage.setItem("modoOscuro", activo ? "1" : "0");
  actualizarEtiquetaModoOscuro(activo);
}

function actualizarEtiquetaModoOscuro(activo) {
  const boton = document.getElementById("btn-modo-oscuro");
  if (!boton) return;
  boton.setAttribute("aria-pressed", String(activo));
  boton.setAttribute("aria-label", activo ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
}

(function aplicarModoOscuroGuardado() {
  if (localStorage.getItem("modoOscuro") === "1") {
    document.body.classList.add("modo-oscuro");
  }
})();
document.addEventListener("DOMContentLoaded", () => actualizarEtiquetaModoOscuro(document.body.classList.contains("modo-oscuro")));

// --- FUNCIONES AVANZADAS ---
// Ranking de cumplimiento y sugerencia de cupo quedan siempre activadas y
// visibles (ya no hay toggle en Configuración para ocultarlas).
function funcionesAvanzadasActivas() {
  return true;
}

function aplicarVisibilidadFuncionesAvanzadas() {
  document.querySelectorAll(".funcion-avanzada").forEach(el => el.classList.remove("oculto"));
}

document.addEventListener("DOMContentLoaded", aplicarVisibilidadFuncionesAvanzadas);

// --- TIPO DE REPORTE POR DEFECTO ---
// Reportes siempre abría en "mensual". Esto permite elegir con qué tipo de
// reporte prefieres que abra cada vez (diario, semanal, mensual, anual o
// rango) — se guarda en este celular (localStorage), igual que el modo
// oscuro, porque es una preferencia de cómo prefieres VER la pantalla, no
// un dato del negocio.
function obtenerTipoReporteDefecto() {
  return localStorage.getItem("reporteTipoDefecto") || "mes";
}

function guardarTipoReporteDefecto(tipo) {
  localStorage.setItem("reporteTipoDefecto", tipo);
}

// Se llama al abrir la sección Reportes. Si el tipo guardado es distinto al
// que ya está seleccionado, lo aplica (y dispara la carga del reporte a
// través de cambiarTipoReporte). Devuelve true si tuvo que aplicar un
// cambio, para que quien llama sepa si ya se encargó de cargar el reporte.
function aplicarTipoReporteDefecto() {
  const tipo = obtenerTipoReporteDefecto();
  const select = document.getElementById("reporte-tipo");
  if (select && select.value !== tipo) {
    select.value = tipo;
    cambiarTipoReporte();
    return true;
  }
  return false;
}

// Pinta el selector de Configuración con el valor actual guardado.
function pintarTipoReporteDefecto() {
  const select = document.getElementById("config-reporte-tipo-defecto");
  if (select) select.value = obtenerTipoReporteDefecto();
}