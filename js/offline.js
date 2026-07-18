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

function agregarPagoACola(item) {
  const cola = obtenerColaOffline();
  cola.push(item);
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
  el.classList.remove("oculto");
  el.textContent = `⏳ ${cola.length} por sincronizar`;
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

async function sincronizarColaOffline(silencioso) {
  if (!navigator.onLine) return;
  const cola = obtenerColaOffline();
  if (cola.length === 0) return;

  const restantes = [];
  let sincronizados = 0;
  for (const item of cola) {
    try {
      const { error } = await supabaseClient.rpc("registrar_pago", {
        p_prestamo_id: item.prestamoId,
        p_monto_pagado: item.monto,
        p_estado: item.estado,
        p_fecha_pago: item.fecha
      });
      if (error) restantes.push(item);
      else sincronizados++;
    } catch {
      restantes.push(item);
    }
  }

  guardarColaOffline(restantes);

  if (sincronizados > 0 && !silencioso) {
    mostrarAlerta(`✅ Se sincronizaron ${sincronizados} pago${sincronizados > 1 ? "s" : ""} que estaban pendientes de conexión.`);
    if (typeof cargarResumenDia === "function") cargarResumenDia();
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
