async function registrarUsuario() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const { error } = await supabaseClient.auth.signUp({ email, password });
  document.getElementById("mensaje-error").innerText = error
    ? "Error: " + error.message
    : "Cuenta creada. Revisa tu correo si pide confirmación, o inicia sesión.";
}

async function iniciarSesion() {
  const email = document.getElementById("email").value;
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
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
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
  document.getElementById("app-principal").classList.remove("oculto");
  cargarRutas();
  cargarClientes();
  cargarResumenDia();
  cargarGraficoSemana();
  cargarProgresoMetas();
  marcarNavActivo("inicio");
  iniciarControlInactividad();
}

supabaseClient.auth.getSession().then(({ data: { session } }) => {
  if (session) mostrarAppPrincipal();
});

// --- Cierre de sesión automático por inactividad (30 minutos) ---
let temporizadorInactividad;
function iniciarControlInactividad() {
  const reiniciar = () => {
    clearTimeout(temporizadorInactividad);
    temporizadorInactividad = setTimeout(() => {
      cerrarSesion();
      mostrarAlerta("Tu sesión se cerró por inactividad.");
    }, 30 * 60 * 1000); // 30 minutos
  };
  ["click", "keydown", "touchstart"].forEach(evento => document.addEventListener(evento, reiniciar));
  reiniciar();
}

function detenerControlInactividad() {
  clearTimeout(temporizadorInactividad);
}