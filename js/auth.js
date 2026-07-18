async function registrarUsuario() {
  const email = document.getElementById("crear-email").value.trim();
  const password = document.getElementById("crear-password").value;
  const confirmar = document.getElementById("crear-password-confirmar").value;
  if (!email || password.length < 8) {
    document.getElementById("mensaje-crear-cuenta").innerText = "Usa un correo válido y una contraseña de al menos 8 caracteres.";
    return;
  }
  if (password !== confirmar) {
    document.getElementById("mensaje-crear-cuenta").innerText = "Las contraseñas no coinciden.";
    return;
  }
  const { error } = await supabaseClient.auth.signUp({ email, password });
  document.getElementById("mensaje-crear-cuenta").innerText = error
    ? "Error: " + error.message
    : "Cuenta creada. Revisa tu correo si pide confirmación, o inicia sesión.";
}

function abrirModalCrearCuenta() {
  document.getElementById("modal-crear-cuenta").classList.remove("oculto");
  document.getElementById("crear-email").focus();
}

function cerrarModalCrearCuenta() {
  document.getElementById("modal-crear-cuenta").classList.add("oculto");
  document.getElementById("mensaje-crear-cuenta").textContent = "";
}

async function iniciarSesion() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById("mensaje-error").innerText = "Error: " + error.message;
  } else {
    mostrarAppPrincipal();
  }
}

async function recuperarContrasena() {
  const email = await mostrarPrompt("Escribe tu correo para enviarte el enlace de recuperación:");
  if (!email) return;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}`
  });
  if (error) {
    mostrarAlerta("Error: " + error.message);
  } else {
    mostrarAlerta("Te enviamos un correo con instrucciones para recuperar tu contraseña.");
  }
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  document.getElementById("app-principal").classList.add("oculto");
  document.getElementById("login-screen").classList.remove("oculto");
  detenerControlInactividad();
}

function mostrarAppPrincipal() {
  document.getElementById("login-screen").classList.add("oculto");
  const app = document.getElementById("app-principal");
  app.classList.remove("oculto");
  app.classList.remove("app-entrada");
  requestAnimationFrame(() => app.classList.add("app-entrada"));
  cargarRutas();
  cargarClientes();
  cargarResumenDia();
  cargarGraficoSemana();
  cargarProgresoMetas();
  cargarTendenciaCobro();
  cargarAgendaVencimientos();
  prepararInicio();
  prepararNavegacionMovil();
  marcarNavActivo("inicio");
  iniciarControlInactividad();
}

supabaseClient.auth.getSession().then(({ data: { session } }) => {
  if (session) mostrarAppPrincipal();
});

// --- Cierre de sesión automático por inactividad (30 minutos) ---
let temporizadorInactividad;
let controlInactividadActivo = false;
const eventosInactividad = ["click", "keydown", "touchstart"];
const reiniciarInactividad = () => {
  clearTimeout(temporizadorInactividad);
  temporizadorInactividad = setTimeout(() => {
    cerrarSesion();
    mostrarAlerta("Tu sesión se cerró por inactividad.");
  }, 30 * 60 * 1000);
};
function iniciarControlInactividad() {
  if (!controlInactividadActivo) {
    eventosInactividad.forEach(evento => document.addEventListener(evento, reiniciarInactividad));
    controlInactividadActivo = true;
  }
  reiniciarInactividad();
}

function detenerControlInactividad() {
  clearTimeout(temporizadorInactividad);
  if (controlInactividadActivo) {
    eventosInactividad.forEach(evento => document.removeEventListener(evento, reiniciarInactividad));
    controlInactividadActivo = false;
  }
}

let salidaConfirmada = false;
let navegacionMovilPreparada = false;
function prepararNavegacionMovil() {
  if (navegacionMovilPreparada) return;
  window.history.pushState({ appCobros: true }, "");
  window.addEventListener("popstate", async () => {
    if (!document.getElementById("app-principal").classList.contains("oculto") && !salidaConfirmada) {
      const salir = await mostrarConfirmacion("¿Quieres salir de la aplicación?");
      if (salir) {
        salidaConfirmada = true;
        window.history.back();
      } else {
        window.history.pushState({ appCobros: true }, "");
      }
    }
  });
  navegacionMovilPreparada = true;
}
