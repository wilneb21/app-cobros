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
  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
  });
  document.getElementById("mensaje-crear-cuenta").innerText = error
    ? "Error: " + traducirErrorSupabase(error)
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
    document.getElementById("mensaje-error").innerText = "Error: " + traducirErrorSupabase(error);
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
    mostrarAlerta("Error: " + traducirErrorSupabase(error));
  } else {
    mostrarAlerta("Te enviamos un correo con instrucciones para recuperar tu contraseña.");
  }
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  document.getElementById("app-principal").classList.add("oculto");
  document.getElementById("login-screen").classList.remove("oculto");
  document.getElementById("pantalla-bloqueo")?.classList.add("oculto");
  bloqueoDesbloqueadoEstaSesion = false;
  detenerControlInactividad();
  navegacionMovilPreparada = false;
  salidaConfirmada = false;
  mostrandoDialogoSalida = false;
  colchonesExtra = 0;
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
  cargarGananciaInicio();
  prepararInicio();
  prepararNavegacionMovil();
  marcarNavActivo("inicio");
  iniciarControlInactividad();
  mostrarPantallaBloqueo();
  if (!pinEstaActivo()) verificarRecordatorioPin();
}

// --- PANTALLA DE BIENVENIDA (animación de entrada) ---
const horaInicioSplash = Date.now();
let splashYaOculto = false;
function ocultarSplash() {
  if (splashYaOculto) return;
  splashYaOculto = true;
  const splash = document.getElementById("pantalla-splash");
  if (!splash) return;
  const transcurrido = Date.now() - horaInicioSplash;
  const espera = Math.max(0, 550 - transcurrido); // muestra el splash mínimo 550ms para que no "parpadee"
  setTimeout(() => {
    splash.classList.add("splash-salida");
    setTimeout(() => splash.remove(), 500);
  }, espera);
}

// Si la conexión es lenta o falla, jamás dejamos al usuario atrapado en la
// pantalla de carga: a los 4 segundos se oculta sí o sí y aparece el login.
setTimeout(ocultarSplash, 4000);

supabaseClient.auth.getSession().then(({ data: { session } }) => {
  if (session) mostrarAppPrincipal();
  ocultarSplash();
}).catch(() => {
  ocultarSplash();
});

// Cuando el usuario da clic en el enlace del correo de "recuperar contraseña",
// Supabase inicia sesión temporalmente y avisa con este evento — antes esto no
// se manejaba, así que el enlace no llevaba a ninguna parte útil.
supabaseClient.auth.onAuthStateChange((evento) => {
  if (evento === "PASSWORD_RECOVERY") {
    ocultarSplash();
    mostrarPantallaNuevaContrasena();
  }
});

function mostrarPantallaNuevaContrasena() {
  const cont = document.getElementById("modal-generico-contenido");
  cont.innerHTML = `
    <p class="modal-mensaje">Escribe tu nueva contraseña (mínimo 8 caracteres).</p>
    <input type="password" id="nueva-clave-1" placeholder="Nueva contraseña">
    <input type="password" id="nueva-clave-2" placeholder="Confirma la nueva contraseña">
    <p id="nueva-clave-error" class="mensaje-modal"></p>
    <div class="modal-botones">
      <button class="btn-modal-confirmar" id="btn-guardar-nueva-clave" style="width:100%">Guardar nueva contraseña</button>
    </div>`;
  document.getElementById("modal-generico").classList.remove("oculto");
  document.getElementById("nueva-clave-1").focus();

  document.getElementById("btn-guardar-nueva-clave").onclick = async () => {
    const clave1 = document.getElementById("nueva-clave-1").value;
    const clave2 = document.getElementById("nueva-clave-2").value;
    const elError = document.getElementById("nueva-clave-error");
    if (clave1.length < 8) { elError.textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
    if (clave1 !== clave2) { elError.textContent = "Las contraseñas no coinciden."; return; }

    const { error } = await supabaseClient.auth.updateUser({ password: clave1 });
    if (error) { elError.textContent = "Error: " + traducirErrorSupabase(error); return; }

    cerrarModalGenerico();
    // Por seguridad (el enlace pudo abrirse en un celular compartido), cerramos
    // la sesión temporal de recuperación y pedimos entrar de nuevo ya con la clave nueva.
    await supabaseClient.auth.signOut();
    document.getElementById("app-principal").classList.add("oculto");
    document.getElementById("login-screen").classList.remove("oculto");
    mostrarAlerta("✅ Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.");
  };
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
// Si el usuario toca "atrás" varias veces rápido MIENTRAS el diálogo de salida
// sigue abierto (muy común: como no ve reacción inmediata, insiste), cada toque
// extra se cuenta aquí para reponer el "colchón" las veces necesarias y que
// ninguno de esos toques adicionales saque de la app sin preguntar.
let mostrandoDialogoSalida = false;
let colchonesExtra = 0;

function prepararNavegacionMovil() {
  if (navegacionMovilPreparada) return;
  estadoNavActual = { seccion: "inicio", modal: null };
  // OJO: debe ser pushState (no replaceState). Así queda un "colchón" en el
  // historial debajo de nuestro estado; si no, con una sola entrada el botón
  // atrás sale directo de la app sin darle chance a este código de actuar.
  window.history.pushState(estadoNavActual, "");
  navegacionMovilPreparada = true;

  window.addEventListener("popstate", async (evento) => {
    const estado = evento.state;

    if (!estado) {
      // Ya no queda ningún paso de la app en el historial: confirmar salida real
      if (salidaConfirmada) return;

      if (mostrandoDialogoSalida) {
        // Toque repetido mientras el diálogo ya estaba abierto: se repone el
        // colchón y no se abre un segundo diálogo encima del primero.
        colchonesExtra++;
        window.history.pushState(estadoNavActual, "");
        return;
      }

      mostrandoDialogoSalida = true;
      const salir = await mostrarConfirmacion("¿Quieres salir de la aplicación?");
      mostrandoDialogoSalida = false;

      if (salir) {
        salidaConfirmada = true;
        // Se deshacen también los "colchones" extra que se hayan repuesto
        // mientras el usuario dudaba, para que salir funcione en un solo intento.
        for (let i = 0; i <= colchonesExtra; i++) window.history.back();
      } else if (colchonesExtra === 0) {
        window.history.pushState(estadoNavActual, "");
      }
      colchonesExtra = 0;
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
