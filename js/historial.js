// --- HISTORIAL GLOBAL DE PAGOS ---
// Antes solo existía el historial POR CLIENTE (dentro de su ficha). Esta
// pantalla junta los últimos pagos de TODOS los clientes en una sola lista,
// con buscador y filtros rápidos por fecha (Hoy / Semana / Mes).

let historialGlobalCache = [];
let historialGlobalSaldos = {};

async function cargarHistorialGlobal(filtro = "todos") {
  mostrarCargando("lista-historial-global");
  const hoy = obtenerFechaLocal();
  let desde = null;
  if (filtro === "hoy") desde = hoy;
  else if (filtro === "semana") desde = sumarDias(hoy, -7);
  else if (filtro === "mes") desde = sumarDias(hoy, -30);

  let consulta = supabaseClient.from("pagos")
    .select("id, monto_pagado, fecha_pago, estado, prestamo_id, prestamos(id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, cliente_id, clientes(nombre, cedula, telefono))")
    .order("fecha_pago", { ascending: false })
    .limit(100);
  if (desde) consulta = consulta.gte("fecha_pago", desde);

  const { data, error } = await consulta;
  if (error) {
    document.getElementById("lista-historial-global").textContent = "No fue posible cargar el historial.";
    return;
  }

  // El "Saldo" que se muestra junto a cada pago es cuánto le quedaba debiendo
  // a ese cliente justo DESPUÉS de ese pago — no el saldo de hoy. Para
  // calcularlo hay que agrupar los pagos por préstamo, ordenarlos del más
  // viejo al más nuevo, y sumar de forma acumulada.
  const porPrestamo = {};
  (data || []).forEach(p => { if (p.prestamos) (porPrestamo[p.prestamo_id] ||= []).push(p); });
  const saldoPorPagoId = {};
  Object.values(porPrestamo).forEach(pagos => {
    const ordenados = [...pagos].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
    let acumulado = 0;
    ordenados.forEach(pago => {
      acumulado += Number(pago.monto_pagado);
      saldoPorPagoId[pago.id] = calcularSaldoPendiente(pago.prestamos, acumulado);
    });
  });

  historialGlobalCache = data || [];
  historialGlobalSaldos = saldoPorPagoId;
  pintarHistorialGlobal(historialGlobalCache);
}

function pintarHistorialGlobal(lista) {
  const contenedor = document.getElementById("lista-historial-global");
  if (!contenedor) return;
  document.getElementById("conteo-historial-global").textContent =
    `${lista.length} movimiento${lista.length === 1 ? "" : "s"}${lista.length === 100 ? " · últimos 100" : ""}`;

  if (!lista.length) { contenedor.innerHTML = '<div class="estado-vacio">Sin movimientos en este período.</div>'; return; }

  const etiquetas = { pago: "PAGO", parcial: "PARCIAL", no_pago: "NO PAGÓ" };
  contenedor.innerHTML = lista.map(p => {
    const cliente = p.prestamos?.clientes;
    const contacto = cliente?.telefono || cliente?.cedula || "";
    const saldo = historialGlobalSaldos[p.id];
    return `<div class="fila-mov">
      <span class="icono-mov ${p.estado === "no_pago" ? "mov-no-pago" : ""}">${p.estado === "no_pago" ? "⚠" : "↓"}</span>
      <div class="info-mov">
        <div class="nombre-mov">${escaparHtml(cliente?.nombre || "Cliente")}</div>
        <div class="datos-mov">${contacto ? escaparHtml(contacto) + " · " : ""}${formatoFecha(p.fecha_pago)}</div>
      </div>
      <div class="der-mov">
        <span class="badge-pago badge-pago-${p.estado}">${etiquetas[p.estado] || p.estado}</span>
        <span class="monto-mov ${p.estado === "no_pago" ? "monto-no-pago" : ""}">${p.estado === "no_pago" ? "" : "+"}${formatoPesos(p.monto_pagado)}</span>
        ${saldo !== undefined ? `<div class="saldo-mov">Saldo: ${formatoPesos(saldo)}</div>` : ""}
      </div>
    </div>`;
  }).join("");
}

function filtrarHistorialGlobalTexto() {
  const q = document.getElementById("buscador-historial-global").value.trim().toLowerCase();
  if (!q) { pintarHistorialGlobal(historialGlobalCache); return; }
  const filtrado = historialGlobalCache.filter(p => {
    const c = p.prestamos?.clientes;
    return (c?.nombre || "").toLowerCase().includes(q) || (c?.cedula || "").includes(q) || (c?.telefono || "").includes(q);
  });
  pintarHistorialGlobal(filtrado);
}

function cambiarFiltroHistorialGlobal(filtro, el) {
  document.querySelectorAll("#seccion-historial .chip-hist").forEach(c => c.classList.remove("activa"));
  el.classList.add("activa");
  document.getElementById("buscador-historial-global").value = "";
  cargarHistorialGlobal(filtro);
}
