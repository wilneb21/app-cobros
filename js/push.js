// --- NOTIFICACIONES PUSH REALES ---
// A diferencia del recordatorio local (que solo funciona con la app abierta),
// esto usa el Push API del navegador: una vez activado, el celular puede
// recibir el aviso de "cuotas que vencen mañana" aunque la app esté cerrada.
// Cómo funciona:
//   1. El cobrador activa esto desde Configuración → se pide permiso de
//      notificaciones y se crea una "suscripción" push del navegador.
//   2. Esa suscripción se guarda en Supabase (tabla push_subscriptions).
//   3. Una Edge Function programada (ver supabase/functions/recordatorios-push)
//      corre una vez al día, revisa qué cuotas vencen mañana por usuario, y le
//      manda el push a cada suscripción guardada.
//   4. El Service Worker (service-worker.js) recibe ese push y muestra la
//      notificación, incluso con la app cerrada.

function pushDisponibleEnDispositivo() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function convertirClaveVapid(claveBase64) {
  const relleno = "=".repeat((4 - (claveBase64.length % 4)) % 4);
  const base64 = (claveBase64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(base64);
  return Uint8Array.from([...bruto].map(c => c.charCodeAt(0)));
}

async function notificacionesPushActivas() {
  if (!pushDisponibleEnDispositivo()) return false;
  const registro = await navigator.serviceWorker.ready;
  const suscripcion = await registro.pushManager.getSubscription();
  return !!suscripcion;
}

async function actualizarFilaConfigPush() {
  const fila = document.getElementById("fila-config-push");
  if (!fila) return;
  if (!pushDisponibleEnDispositivo()) {
    fila.querySelector("small").textContent = "No disponible en este navegador/celular";
    fila.disabled = true;
    return;
  }
  const activas = await notificacionesPushActivas();
  fila.querySelector("small").textContent = activas
    ? "Activadas en este celular · toca para desactivar"
    : "Avisa cuando una cuota vence mañana, con la app cerrada";
}

async function configurarNotificacionesPush() {
  if (!requiereConexion()) return;
  if (!pushDisponibleEnDispositivo()) {
    mostrarAlerta("Este navegador o celular no soporta notificaciones push.");
    return;
  }

  if (await notificacionesPushActivas()) {
    const confirmado = await mostrarConfirmacion("¿Quieres desactivar las notificaciones push en este celular?");
    if (!confirmado) return;
    await desactivarNotificacionesPush();
    actualizarFilaConfigPush();
    mostrarAlerta("🔕 Notificaciones push desactivadas en este celular.");
    return;
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    mostrarAlerta("No diste permiso de notificaciones, así que no podré avisarte. Puedes activarlo luego desde los ajustes del navegador.");
    return;
  }

  try {
    const registro = await navigator.serviceWorker.ready;
    const suscripcion = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: convertirClaveVapid(VAPID_PUBLIC_KEY)
    });
    const json = suscripcion.toJSON();
    const user = await obtenerUsuarioActual();

    const { error } = await supabaseClient.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth
    }, { onConflict: "endpoint" });
    if (error) throw error;

    await supabaseClient.from("preferencias_usuario")
      .upsert({ user_id: user.id, pin_activado_alguna_vez: pinEstaActivo() }, { onConflict: "user_id" });

    actualizarFilaConfigPush();
    mostrarAlerta("🔔 Notificaciones push activadas. Te avisaré cuando una cuota venza mañana.");
  } catch (e) {
    mostrarAlerta("No fue posible activar las notificaciones push en este celular.");
  }
}

async function desactivarNotificacionesPush() {
  try {
    const registro = await navigator.serviceWorker.ready;
    const suscripcion = await registro.pushManager.getSubscription();
    if (!suscripcion) return;
    const endpoint = suscripcion.endpoint;
    await suscripcion.unsubscribe();
    await supabaseClient.from("push_subscriptions").delete().eq("endpoint", endpoint);
  } catch (e) {
    // Si falla el borrado remoto no es grave: la Edge Function limpia solita
    // las suscripciones vencidas la próxima vez que le falle el envío.
  }
}
