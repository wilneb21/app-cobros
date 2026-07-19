// --- BLOQUEO CON PIN / HUELLA (candado local del celular) ---
// Esto NO reemplaza el login de Supabase: la sesión sigue siendo la que da
// acceso real a los datos. Este candado es una capa extra para que, si alguien
// toma el celular ya desbloqueado y con la sesión abierta, no pueda entrar
// directo a ver los datos de tus clientes sin conocer tu PIN (o tu huella/Face ID).
// El PIN se guarda SOLO en este celular (hasheado, nunca en texto plano y nunca
// en Supabase), por eso "olvidé mi PIN" no se puede recuperar: la única salida
// es cerrar sesión y volver a entrar con tu correo y contraseña.

let bloqueoDesbloqueadoEstaSesion = false;
let momentoAppOculta = null;

async function hashTexto(texto) {
  const datos = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function pinEstaActivo() {
  return !!localStorage.getItem("pinHash");
}

function biometriaEstaActiva() {
  return !!localStorage.getItem("credencialBiometricaId");
}

async function biometriaDisponibleEnDispositivo() {
  return typeof PublicKeyCredential !== "undefined" &&
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable &&
    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

// --- CONFIGURAR PIN (desde Configuración) ---
async function configurarPin() {
  if (pinEstaActivo()) {
    const confirmado = await mostrarConfirmacion("¿Quieres desactivar el bloqueo con PIN de este celular?");
    if (!confirmado) return;
    const actual = await mostrarPrompt("Para desactivarlo, escribe tu PIN actual:");
    if (actual === null) return;
    if (await hashTexto(actual) !== localStorage.getItem("pinHash")) { mostrarAlerta("PIN incorrecto."); return; }
    localStorage.removeItem("pinHash");
    localStorage.removeItem("credencialBiometricaId");
    actualizarFilaConfigBloqueo();
    mostrarAlerta("🔓 Bloqueo con PIN desactivado en este celular.");
    return;
  }

  const nuevo = await mostrarPrompt("Crea un PIN de 4 a 6 dígitos para abrir la app en este celular:");
  if (nuevo === null) return;
  if (!/^\d{4,6}$/.test(nuevo)) { mostrarAlerta("El PIN debe tener entre 4 y 6 números."); return; }
  const confirmar = await mostrarPrompt("Confirma el mismo PIN:");
  if (confirmar === null) return;
  if (nuevo !== confirmar) { mostrarAlerta("Los PIN no coinciden. Intenta de nuevo."); return; }

  localStorage.setItem("pinHash", await hashTexto(nuevo));
  actualizarFilaConfigBloqueo();
  mostrarAlerta("🔒 Listo. Desde ahora la app pedirá este PIN cada vez que la abras en este celular.");

  try {
    const user = await obtenerUsuarioActual();
    await supabaseClient.from("preferencias_usuario")
      .upsert({ user_id: user.id, pin_activado_alguna_vez: true }, { onConflict: "user_id" });
  } catch (e) { /* no bloquea el flujo si falla el guardado remoto */ }

  if (await biometriaDisponibleEnDispositivo()) {
    const quiereHuella = await mostrarConfirmacion("Este celular tiene huella o Face ID disponible. ¿Quieres poder usarla también para desbloquear más rápido (en vez de escribir el PIN cada vez)?");
    if (quiereHuella) await activarBiometria();
  }
}

async function activarBiometria() {
  try {
    const credencial = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "App de Cobros" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "cobrador", displayName: "Cobrador" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000
      }
    });
    if (!credencial) throw new Error("no se creó la credencial");
    localStorage.setItem("credencialBiometricaId", credencial.id);
    mostrarAlerta("✅ Huella/Face ID activada como acceso rápido. El PIN sigue funcionando como respaldo.");
  } catch (e) {
    mostrarAlerta("No fue posible activar la huella/Face ID en este celular. El PIN sigue funcionando normalmente.");
  }
}

function actualizarFilaConfigBloqueo() {
  const fila = document.getElementById("fila-config-pin");
  if (!fila) return;
  fila.querySelector("small").textContent = pinEstaActivo()
    ? "Activado en este celular · toca para desactivar"
    : "Pide un PIN cada vez que abras la app";
}

// Si el usuario activó el PIN alguna vez (en cualquier celular) pero en ESTE
// celular no está activo (por ejemplo, reinstaló la app o entró desde uno
// nuevo), se lo recuerda una sola vez por día — sin ser insistente.
async function verificarRecordatorioPin() {
  if (pinEstaActivo()) return;
  const hoy = obtenerFechaLocal();
  if (localStorage.getItem("avisoPinVistoFecha") === hoy) return;

  try {
    const user = await obtenerUsuarioActual();
    const { data } = await supabaseClient.from("preferencias_usuario")
      .select("pin_activado_alguna_vez").eq("user_id", user.id).maybeSingle();
    if (!data?.pin_activado_alguna_vez) return;

    localStorage.setItem("avisoPinVistoFecha", hoy);
    const activar = await mostrarConfirmacion("🔒 En otro celular tenías activado el bloqueo con PIN, pero en este todavía no. ¿Quieres activarlo ahora para proteger los datos de tus clientes?");
    if (activar) await configurarPin();
  } catch (e) { /* si falla la consulta, simplemente no se muestra el aviso hoy */ }
}

// --- PANTALLA DE BLOQUEO ---
function mostrarPantallaBloqueo() {
  if (!pinEstaActivo()) return;
  bloqueoDesbloqueadoEstaSesion = false;
  document.getElementById("pantalla-bloqueo").classList.remove("oculto");
  document.getElementById("bloqueo-pin-input").value = "";
  document.getElementById("bloqueo-error").textContent = "";
  document.getElementById("btn-bloqueo-huella").classList.toggle("oculto", !biometriaEstaActiva());
  setTimeout(() => document.getElementById("bloqueo-pin-input").focus(), 50);
  if (biometriaEstaActiva()) intentarDesbloqueoBiometrico(true);
}

async function intentarDesbloqueoBiometrico(automatico = false) {
  try {
    const resultado = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: Uint8Array.from(atob(localStorage.getItem("credencialBiometricaId").replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)), type: "public-key" }],
        userVerification: "required",
        timeout: 30000
      }
    });
    if (resultado) desbloquearApp();
  } catch (e) {
    // Si fue automático (al abrir) y falla o el usuario cancela, simplemente se
    // queda en la pantalla de PIN, sin mostrar error para no asustar al cobrador.
    if (!automatico) document.getElementById("bloqueo-error").textContent = "No se pudo verificar la huella/Face ID. Usa tu PIN.";
  }
}

async function verificarPinBloqueo() {
  const valor = document.getElementById("bloqueo-pin-input").value;
  if (await hashTexto(valor) === localStorage.getItem("pinHash")) {
    desbloquearApp();
  } else {
    document.getElementById("bloqueo-error").textContent = "PIN incorrecto. Intenta de nuevo.";
    document.getElementById("bloqueo-pin-input").value = "";
  }
}

function desbloquearApp() {
  bloqueoDesbloqueadoEstaSesion = true;
  document.getElementById("pantalla-bloqueo").classList.add("oculto");
}

async function olvidoPinBloqueo() {
  const confirmado = await mostrarConfirmacion("Si olvidaste tu PIN, la única forma de continuar es cerrar la sesión de este celular y volver a entrar con tu correo y contraseña.<br><br>Tus datos NO se pierden — siguen guardados en Supabase.<br><br>¿Quieres cerrar sesión ahora?");
  if (!confirmado) return;
  localStorage.removeItem("pinHash");
  localStorage.removeItem("credencialBiometricaId");
  document.getElementById("pantalla-bloqueo").classList.add("oculto");
  await cerrarSesion();
}

// Vuelve a pedir el candado cuando el celular regresa de estar en segundo plano
// más de 20 segundos (pantalla apagada, cambio de app, etc.) — no cada vez que
// el cobrador solo revisa una notificación rápida.
document.addEventListener("visibilitychange", () => {
  if (!pinEstaActivo() || document.getElementById("app-principal")?.classList.contains("oculto")) return;
  if (document.hidden) {
    momentoAppOculta = Date.now();
  } else if (momentoAppOculta && Date.now() - momentoAppOculta > 20000) {
    bloqueoDesbloqueadoEstaSesion = false;
    mostrarPantallaBloqueo();
  }
});
