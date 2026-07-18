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
  empujarEstadoModal("modal-crear-cuenta");
}

function cerrarModalCrearCuenta() {
  cerrarModalConHistorial("modal-crear-cuenta");
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
  navegacionMovilPreparada = false;
  salidaConfirmada = false;
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
  ocultarSplash();
});

// --- PANTALLA DE BIENVENIDA (animación de entrada) ---
const horaInicioSplash = Date.now();
function ocultarSplash() {
  const splash = document.getElementById("pantalla-splash");
  if (!splash) return;
  const transcurrido = Date.now() - horaInicioSplash;
  const espera = Math.max(0, 550 - transcurrido); // muestra el splash mínimo 550ms para que no "parpadee"
  setTimeout(() => {
    splash.classList.add("splash-salida");
    setTimeout(() => splash.remove(), 500);
  }, espera);
}

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

// --- NAVEGACIÓN CON EL BOTÓN "ATRÁS" (Android / navegador móvil) ---
// El botón atrás ya no cierra la app de una: primero cierra la ventana/modal
// que esté abierta, luego regresa a la sección anterior dentro de la app,
// y solo al llegar al inicio sin nada abierto pregunta si se quiere salir.
let salidaConfirmada = false;
let navegacionMovilPreparada = false;
let estadoNavActual = { seccion: "inicio", modal: null };

function prepararNavegacionMovil() {
  if (navegacionMovilPreparada) return;
  estadoNavActual = { seccion: "inicio", modal: null };
  window.history.replaceState(estadoNavActual, "");
  navegacionMovilPreparada = true;

  window.addEventListener("popstate", async (evento) => {
    const estado = evento.state;

    if (!estado) {
      // Ya no queda ningún paso de la app en el historial: confirmar salida real
      if (salidaConfirmada) return;
      const salir = await mostrarConfirmacion("¿Quieres salir de la aplicación?");
      if (salir) {
        salidaConfirmada = true;
        window.history.back();
      } else {
        window.history.pushState(estadoNavActual, "");
      }
      return;
    }

    // Si veníamos con un modal abierto y el estado al que volvimos no lo trae, se cierra
    if (estadoNavActual.modal && estadoNavActual.modal !== estado.modal) {
      document.getElementById(estadoNavActual.modal)?.classList.add("oculto");
    }
    // Si el estado al que volvimos corresponde a otra sección, se muestra esa sección
    if (estado.seccion && estado.seccion !== estadoNavActual.seccion) {
      mostrarSeccion(estado.seccion, true);
    }
    estadoNavActual = estado;
  });
}

// Registra en el historial la apertura de un modal de pantalla completa
// (detalle de cliente, nuevo cliente, búsqueda, recibo, crear cuenta) para
// que el botón atrás lo cierre en vez de salir de la app.
function empujarEstadoModal(idModal) {
  if (!navegacionMovilPreparada) return;
  estadoNavActual = { seccion: estadoNavActual.seccion, modal: idModal };
  window.history.pushState(estadoNavActual, "");
}

// Cierra un modal registrado con empujarEstadoModal, manteniendo el
// historial sincronizado (sin dejar "pasos fantasma" para el botón atrás).
function cerrarModalConHistorial(idModal) {
  document.getElementById(idModal)?.classList.add("oculto");
  if (navegacionMovilPreparada && estadoNavActual.modal === idModal) {
    estadoNavActual = { seccion: estadoNavActual.seccion, modal: null };
    window.history.replaceState(estadoNavActual, "");
  }
}
