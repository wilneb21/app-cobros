// --- PREFERENCIAS DE LA APP (modo oscuro y funciones avanzadas) ---
// Ajustes simples que se guardan en este celular (localStorage).

// --- MODO OSCURO ---
function toggleModoOscuro() {
  document.body.classList.toggle("modo-oscuro");
  const activo = document.body.classList.contains("modo-oscuro");
  localStorage.setItem("modoOscuro", activo ? "1" : "0");
}

(function aplicarModoOscuroGuardado() {
  if (localStorage.getItem("modoOscuro") === "1") {
    document.body.classList.add("modo-oscuro");
  }
})();

// --- FUNCIONES AVANZADAS ---
// Ranking de cumplimiento, mora manual y sugerencia de cupo quedan siempre
// activadas y visibles (ya no hay toggle en Configuración para ocultarlas).
function funcionesAvanzadasActivas() {
  return true;
}

function aplicarVisibilidadFuncionesAvanzadas() {
  document.querySelectorAll(".funcion-avanzada").forEach(el => el.classList.remove("oculto"));
}

document.addEventListener("DOMContentLoaded", aplicarVisibilidadFuncionesAvanzadas);

