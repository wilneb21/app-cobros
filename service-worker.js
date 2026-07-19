// Nombre de la "versión" de caché. Súbelo (v2, v3...) cada vez que cambies archivos
// para forzar que los celulares descarguen la versión nueva.
const CACHE_NOMBRE = "app-cobros-v13";

// Archivos que se guardan para que la app cargue rápido y funcione con mala señal.
// (Los datos reales de clientes/pagos siempre vienen de Supabase, no de aquí.)
const ARCHIVOS_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./js/supabase-config.js",
  "./js/offline.js",
  "./js/ui.js",
  "./js/bloqueo.js",
  "./js/push.js",
  "./js/auth.js",
  "./js/main.js",
  "./js/rutas.js",
  "./js/clientes.js",
  "./js/prestamos.js",
  "./js/pagos.js",
  "./js/reportes.js",
  "./js/ganancia.js",
  "./js/gastos.js",
  "./manifest.json",
  "./iconos/icon-192.png",
  "./iconos/icon-512.png"
];

// Al instalar el service worker, guarda los archivos base en caché
self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NOMBRE).then((cache) => cache.addAll(ARCHIVOS_CACHE))
  );
  self.skipWaiting();
});

// Al activarse, borra cachés de versiones viejas
self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NOMBRE)
          .map((nombre) => caches.delete(nombre))
      )
    )
  );
  self.clients.claim();
});

// Estrategia: intenta traer de internet primero (para tener datos frescos);
// si no hay conexión, usa lo guardado en caché como respaldo.
self.addEventListener("fetch", (evento) => {
  // No cacheamos las llamadas a Supabase: esos datos siempre deben ser en vivo.
  if (evento.request.url.includes("supabase.co")) return;

  evento.respondWith(
    fetch(evento.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NOMBRE).then((cache) => cache.put(evento.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(evento.request))
  );
});

// --- NOTIFICACIONES PUSH ---
// Se dispara cuando llega un push real desde la Edge Function
// "recordatorios-push", aunque la app esté cerrada.
self.addEventListener("push", (evento) => {
  let datos = { title: "App de Cobros", body: "Tienes cuotas por revisar." };
  try { if (evento.data) datos = { ...datos, ...evento.data.json() }; } catch { /* usa el mensaje por defecto */ }

  evento.waitUntil(
    self.registration.showNotification(datos.title, {
      body: datos.body,
      icon: "./iconos/icon-192.png",
      badge: "./iconos/icon-192.png",
      data: { url: datos.url || "./" }
    })
  );
});

// Al tocar la notificación, abre la app (o la enfoca si ya está abierta)
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const urlDestino = evento.notification.data?.url || "./";
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((listaClientes) => {
      for (const cliente of listaClientes) {
        if ("focus" in cliente) return cliente.focus();
      }
      return self.clients.openWindow(urlDestino);
    })
  );
});
