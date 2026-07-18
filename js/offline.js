// --- MODO OFFLINE PARA COBROS ---
// Si el celular se queda sin señal mientras el cobrador está en la calle,
// los pagos no se pierden: se guardan en el propio celular (localStorage)
// y se envían solos a Supabase en cuanto vuelve la conexión.
// Nota: esto cubre el registro de pagos sobre datos ya cargados en pantalla;
// para abrir un cliente nuevo o consultar reportes sigue haciendo falta señal.

const CLAVE_COLA_OFFLINE = "cobros_cola_offline_pagos";

function obtenerColaOffline() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_COLA_OFFLINE)) || [];
  } catch {
    return [];
  }
}

function guardarColaOffline(cola) {
  localStorage.setItem(CLAVE_COLA_OFFLINE, JSON.stringify(cola));
  actualizarIndicadorOffline();
}

const MAX_INTENTOS_SYNC = 5;

function agregarPagoACola(item) {
  const cola = obtenerColaOffline();
  cola.push({ ...item, intentos: 0 });
  guardarColaOffline(cola);
}

function actualizarIndicadorOffline() {
  const el = document.getElementById("indicador-offline");
  if (!el) return;
  const cola = obtenerColaOffline();
  if (cola.length === 0) {
    el.classList.add("oculto");
    return;
  }
  const atascados = cola.filter(item => (item.intentos || 0) >= MAX_INTENTOS_SYNC).length;
  el.classList.remove("oculto");
  el.classList.toggle("indicador-offline-error", atascados > 0);
  el.textContent = atascados > 0
    ? `⚠️ ${atascados} pago${atascados > 1 ? "s" : ""} no se pudo enviar — toca para reintentar`
    : `⏳ ${cola.length} por sincronizar`;
  el.onclick = atascados > 0 ? () => sincronizarColaOffline(false, true) : null;
}

function marcarSubtarjetaPendienteSync(prestamoId) {
  const el = document.getElementById("subtarjeta-" + prestamoId);
  if (!el) return;
  el.querySelectorAll(".btn-pago, .btn-refinanciar").forEach(btn => btn.disabled = true);
  if (!el.querySelector(".badge-pendiente-sync")) {
    const badge = document.createElement("span");
    badge.className = "badge-pendiente-sync";
    badge.textContent = "⏳ Guardado sin conexión — se enviará solo";
    el.prepend(badge);
  }
}

async function sincronizarColaOffline(silencioso, forzarAtascados) {
  if (!navigator.onLine) return;
  const cola = obtenerColaOffline();
  if (cola.length === 0) return;

  const restantes = [];
  let sincronizados = 0;
  let nuevosAtascados = 0;
  for (const item of cola) {
    const intentosPrevios = item.intentos || 0;
    // Ya agotó los reintentos automáticos: solo se reintenta si el cobrador lo pide a mano.
    if (intentosPrevios >= MAX_INTENTOS_SYNC && !forzarAtascados) { restantes.push(item); continue; }
    try {
      const { error } = await supabaseClient.rpc("registrar_pago", {
        p_prestamo_id: item.prestamoId,
        p_monto_pagado: item.monto,
        p_estado: item.estado,
        p_fecha_pago: item.fecha
      });
      if (error) {
        const intentos = intentosPrevios + 1;
        if (intentos >= MAX_INTENTOS_SYNC) nuevosAtascados++;
        restantes.push({ ...item, intentos });
      } else sincronizados++;
    } catch {
      const intentos = intentosPrevios + 1;
      if (intentos >= MAX_INTENTOS_SYNC) nuevosAtascados++;
      restantes.push({ ...item, intentos });
    }
  }

  guardarColaOffline(restantes);

  if (sincronizados > 0 && !silencioso) {
    mostrarAlerta(`✅ Se sincronizaron ${sincronizados} pago${sincronizados > 1 ? "s" : ""} que estaban pendientes de conexión.`);
    if (typeof cargarResumenDia === "function") cargarResumenDia();
  }
  if (nuevosAtascados > 0) {
    mostrarAlerta(`⚠️ ${nuevosAtascados} pago${nuevosAtascados > 1 ? "s" : ""} no se pudo enviar tras varios intentos. Revisa el indicador de "sin sincronizar" para reintentar a mano — puede ser un dato inválido, no solo falta de señal.`);
  }
}

function actualizarBannerConexion() {
  const banner = document.getElementById("banner-sin-conexion");
  if (!banner) return;
  banner.classList.toggle("oculto", navigator.onLine);
}

window.addEventListener("online", () => {
  actualizarBannerConexion();
  sincronizarColaOffline(false);
});
window.addEventListener("offline", actualizarBannerConexion);

document.addEventListener("DOMContentLoaded", () => {
  actualizarBannerConexion();
  actualizarIndicadorOffline();
  if (navigator.onLine) sincronizarColaOffline(true);
});

setInterval(() => sincronizarColaOffline(true), 60000);
