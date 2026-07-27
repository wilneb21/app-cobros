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

