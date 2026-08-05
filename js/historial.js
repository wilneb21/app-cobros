// --- HISTORIAL GLOBAL (pagos + préstamos entregados + gastos) ---
// Junta los tres tipos de movimiento del negocio en una sola lista
// ordenada por fecha, con buscador y filtros por período (Hoy / Semana /
// Mes / un día específico / un rango de fechas elegido) y por tipo de
// movimiento (Pagos / Préstamos / Gastos).

let historialGlobalCache = [];
let historialGlobalSaldos = {};
let historialFiltroTipoActual = "todos";

function calcularRangoHistorial(filtro) {
  const hoy = obtenerFechaLocal();
  if (filtro === "hoy") return { desde: hoy, hasta: hoy };
  if (filtro === "semana") return { desde: sumarDias(hoy, -7), hasta: hoy };
  if (filtro === "mes") return { desde: sumarDias(hoy, -30), hasta: hoy };
  if (filtro === "dia") {
    const cont = document.getElementById("historial-fecha-dia-cont");
    const input = document.getElementById("historial-fecha-dia");
    if (cont) cont.classList.remove("oculto");
    if (input && !input.value) input.value = hoy;
    return { desde: input ? input.value : hoy, hasta: input ? input.value : hoy };
  }
  if (filtro === "rango") {
    const cont = document.getElementById("historial-rango-cont");
    const desdeInput = document.getElementById("historial-rango-desde");
    const hastaInput = document.getElementById("historial-rango-hasta");
    if (cont) cont.classList.remove("oculto");
    if (desdeInput && !desdeInput.value) desdeInput.value = sumarDias(hoy, -7);
    if (hastaInput && !hastaInput.value) hastaInput.value = hoy;
    return { desde: desdeInput ? desdeInput.value : null, hasta: hastaInput ? hastaInput.value : null };
  }
  return { desde: null, hasta: null }; // "todos"
}

async function cargarHistorialGlobal(filtro = "todos") {
  // Los inputs de fecha específica/rango solo se muestran para esos dos filtros.
  const contDia = document.getElementById("historial-fecha-dia-cont");
  const contRango = document.getElementById("historial-rango-cont");
  if (filtro !== "dia" && contDia) contDia.classList.add("oculto");
  if (filtro !== "rango" && contRango) contRango.classList.add("oculto");

  const { desde, hasta } = calcularRangoHistorial(filtro);
  if (filtro === "rango" && (!desde || !hasta)) return; // esperando a que se llenen ambas fechas
  if (filtro === "rango" && desde > hasta) { mostrarAlerta('La fecha "Desde" no puede ser posterior a "Hasta".'); return; }

  mostrarCargando("lista-historial-global");

  let consultaPagos = supabaseClient.from("pagos")
    .select("id, monto_pagado, fecha_pago, estado, prestamo_id, prestamos(id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, cliente_id, clientes(nombre, cedula, telefono))")
    .order("fecha_pago", { ascending: false }).limit(100);
  let consultaPrestamos = supabaseClient.from("prestamos")
    .select("id, monto_prestado, fecha_desembolso, clientes(nombre, cedula, telefono)")
    .order("fecha_desembolso", { ascending: false }).limit(100);
  let consultaGastos = supabaseClient.from("gastos")
    .select("id, concepto, monto, fecha")
    .order("fecha", { ascending: false }).limit(100);
  let consultaAportes = supabaseClient.from("aportes_capital")
    .select("id, monto, fecha, nota")
    .order("fecha", { ascending: false }).limit(100);

  if (desde) { consultaPagos = consultaPagos.gte("fecha_pago", desde); consultaPrestamos = consultaPrestamos.gte("fecha_desembolso", desde); consultaGastos = consultaGastos.gte("fecha", desde); consultaAportes = consultaAportes.gte("fecha", desde); }
  if (hasta) { consultaPagos = consultaPagos.lte("fecha_pago", hasta); consultaPrestamos = consultaPrestamos.lte("fecha_desembolso", hasta); consultaGastos = consultaGastos.lte("fecha", hasta); consultaAportes = consultaAportes.lte("fecha", hasta); }

  const [{ data: pagos, error: errorPagos }, { data: prestamos, error: errorPrestamos }, { data: gastos, error: errorGastos }, { data: aportes, error: errorAportes }] =
    await Promise.all([consultaPagos, consultaPrestamos, consultaGastos, consultaAportes]);

  if (errorPagos || errorPrestamos || errorGastos || errorAportes) {
    document.getElementById("lista-historial-global").textContent = "No fue posible cargar el historial.";
    return;
  }

  // El "Saldo" que se muestra junto a cada pago es cuánto le quedaba debiendo
  // a ese cliente justo DESPUÉS de ese pago — no el saldo de hoy. Para
  // calcularlo hay que agrupar los pagos por préstamo, ordenarlos del más
  // viejo al más nuevo, y sumar de forma acumulada.
  const porPrestamo = {};
  (pagos || []).forEach(p => { if (p.prestamos) (porPrestamo[p.prestamo_id] ||= []).push(p); });
  const saldoPorPagoId = {};
  Object.values(porPrestamo).forEach(lista => {
    const ordenados = [...lista].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
    let acumulado = 0;
    ordenados.forEach(pago => {
      acumulado += Number(pago.monto_pagado);
      saldoPorPagoId[pago.id] = calcularSaldoPendiente(pago.prestamos, acumulado);
    });
  });

  // Unifica los tres orígenes en una sola lista con forma común, marcada con
  // "tipoMov" para saber cómo pintar cada fila y poder filtrar por tipo.
  const movimientos = [
    ...(pagos || []).map(p => ({ tipoMov: "pago", fecha: p.fecha_pago, ...p })),
    ...(prestamos || []).map(p => ({ tipoMov: "prestamo", fecha: p.fecha_desembolso, ...p })),
    ...(gastos || []).map(g => ({ tipoMov: "gasto", fecha: g.fecha, ...g })),
    ...(aportes || []).map(a => ({ tipoMov: Number(a.monto) >= 0 ? "aporte" : "retiro", fecha: a.fecha, ...a })),
  ].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));

  historialGlobalCache = movimientos;
  historialGlobalSaldos = saldoPorPagoId;
  pintarHistorialGlobal(aplicarFiltroTipoHistorial(movimientos));
}

function aplicarFiltroTipoHistorial(lista) {
  if (historialFiltroTipoActual === "todos") return lista;
  if (historialFiltroTipoActual === "aporteRetiro") return lista.filter(m => m.tipoMov === "aporte" || m.tipoMov === "retiro");
  return lista.filter(m => m.tipoMov === historialFiltroTipoActual);
}

function cambiarFiltroTipoHistorial(tipo) {
  historialFiltroTipoActual = tipo;
  pintarHistorialGlobal(aplicarFiltroTipoHistorial(historialGlobalCache));
}

function pintarHistorialGlobal(lista) {
  const contenedor = document.getElementById("lista-historial-global");
  if (!contenedor) return;
  document.getElementById("conteo-historial-global").textContent =
    `${lista.length} movimiento${lista.length === 1 ? "" : "s"}`;

  if (!lista.length) { contenedor.innerHTML = '<div class="estado-vacio">Sin movimientos en este período.</div>'; return; }

  const etiquetasPago = { pago: "PAGO", parcial: "PARCIAL", no_pago: "NO PAGÓ" };
  contenedor.innerHTML = lista.map(m => {
    if (m.tipoMov === "pago") {
      const cliente = m.prestamos?.clientes;
      const contacto = cliente?.telefono || cliente?.cedula || "";
      const saldo = historialGlobalSaldos[m.id];
      return `<div class="fila-mov">
        <span class="icono-mov ${m.estado === "no_pago" ? "mov-no-pago" : ""}">${m.estado === "no_pago" ? "⚠" : "↓"}</span>
        <div class="info-mov">
          <div class="nombre-mov">${escaparHtml(cliente?.nombre || "Cliente")}</div>
          <div class="datos-mov">${contacto ? escaparHtml(contacto) + " · " : ""}${formatoFecha(m.fecha_pago)}</div>
        </div>
        <div class="der-mov">
          <span class="badge-pago badge-pago-${m.estado}">${etiquetasPago[m.estado] || m.estado}</span>
          <span class="monto-mov ${m.estado === "no_pago" ? "monto-no-pago" : ""}">${m.estado === "no_pago" ? "" : "+"}${formatoPesos(m.monto_pagado)}</span>
          ${saldo !== undefined ? `<div class="saldo-mov">Saldo: ${formatoPesos(saldo)}</div>` : ""}
        </div>
      </div>`;
    }
    if (m.tipoMov === "prestamo") {
      const cliente = m.clientes;
      const contacto = cliente?.telefono || cliente?.cedula || "";
      return `<div class="fila-mov">
        <span class="icono-mov mov-prestamo">💵</span>
        <div class="info-mov">
          <div class="nombre-mov">${escaparHtml(cliente?.nombre || "Cliente")}</div>
          <div class="datos-mov">${contacto ? escaparHtml(contacto) + " · " : ""}${formatoFecha(m.fecha_desembolso)}</div>
        </div>
        <div class="der-mov">
          <span class="badge-pago badge-pago-prestamo">PRÉSTAMO</span>
          <span class="monto-mov monto-prestamo">-${formatoPesos(m.monto_prestado)}</span>
        </div>
      </div>`;
    }
    if (m.tipoMov === "aporte" || m.tipoMov === "retiro") {
      const esRetiro = m.tipoMov === "retiro";
      return `<div class="fila-mov">
        <span class="icono-mov ${esRetiro ? "mov-retiro" : "mov-aporte"}">${esRetiro ? "🔻" : "🔺"}</span>
        <div class="info-mov">
          <div class="nombre-mov">${esRetiro ? "Retiro de efectivo propio" : "Aporte de capital propio"}</div>
          <div class="datos-mov">${formatoFecha(m.fecha)}${m.nota ? " · " + escaparHtml(m.nota) : ""}</div>
        </div>
        <div class="der-mov">
          <span class="badge-pago ${esRetiro ? "badge-pago-retiro" : "badge-pago-aporte"}">${esRetiro ? "RETIRO" : "APORTE"}</span>
          <span class="monto-mov ${esRetiro ? "monto-retiro" : "monto-aporte"}">${esRetiro ? "" : "+"}${formatoPesos(m.monto)}</span>
        </div>
      </div>`;
    }
    // gasto
    return `<div class="fila-mov">
      <span class="icono-mov mov-gasto">📤</span>
      <div class="info-mov">
        <div class="nombre-mov">${escaparHtml(m.concepto || "Gasto")}</div>
        <div class="datos-mov">${formatoFecha(m.fecha)}</div>
      </div>
      <div class="der-mov">
        <span class="badge-pago badge-pago-gasto">GASTO</span>
        <span class="monto-mov monto-gasto">-${formatoPesos(m.monto)}</span>
      </div>
    </div>`;
  }).join("");
}

function filtrarHistorialGlobalTexto() {
  const q = document.getElementById("buscador-historial-global").value.trim().toLowerCase();
  const base = aplicarFiltroTipoHistorial(historialGlobalCache);
  if (!q) { pintarHistorialGlobal(base); return; }
  const filtrado = base.filter(m => {
    if (m.tipoMov === "gasto") return (m.concepto || "").toLowerCase().includes(q);
    if (m.tipoMov === "aporte" || m.tipoMov === "retiro") return (m.nota || "").toLowerCase().includes(q);
    const c = m.tipoMov === "pago" ? m.prestamos?.clientes : m.clientes;
    return (c?.nombre || "").toLowerCase().includes(q) || (c?.cedula || "").includes(q) || (c?.telefono || "").includes(q);
  });
  pintarHistorialGlobal(filtrado);
}

function cambiarFiltroHistorialGlobal(filtro) {
  document.getElementById("buscador-historial-global").value = "";
  cargarHistorialGlobal(filtro);
}