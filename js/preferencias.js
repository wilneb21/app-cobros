// --- PREFERENCIAS DE LA APP (modo oscuro y funciones avanzadas) ---
// Ajustes simples que se guardan en este celular (localStorage).

// --- MODO OSCURO ---
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

