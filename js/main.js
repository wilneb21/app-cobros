function mostrarSeccion(nombre) {
  document.querySelectorAll(".seccion").forEach(sec => sec.classList.add("oculto"));
  document.getElementById("seccion-" + nombre).classList.remove("oculto");
  marcarNavActivo(nombre);

  if (nombre === "inicio") { cargarResumenDia(); cargarGraficoSemana(); cargarProgresoMetas(); }
  if (nombre === "prestamos") cargarClientesEnSelector();
  if (nombre === "cobrar") cargarClientesParaCobrar();
  if (nombre === "reportes") {
    cargarReporteMes();
    if (!document.getElementById("gasto-fecha").value) document.getElementById("gasto-fecha").value = obtenerFechaLocal();
  }
}

function marcarNavActivo(nombre) {
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("activo"));
  const btn = document.querySelector(`.nav-btn[data-nav="${nombre}"]`);
  if (btn) btn.classList.add("activo");
}

// Suma días de forma segura a una fecha "YYYY-MM-DD" (sin líos de UTC)
function sumarDias(fechaTexto, dias) {
  const [a, m, d] = fechaTexto.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  fecha.setDate(fecha.getDate() + dias);
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${año}-${mes}-${dia}`;
}

// --- DASHBOARD (Inicio) ---
async function cargarResumenDia() {
  mostrarCargando("resumen-dia");
  mostrarCargando("resumen-cartera");
  mostrarCargando("lista-pendientes-hoy");

  const hoy = obtenerFechaLocal();

  const { data: pagosHoy } = await supabaseClient
    .from("pagos").select("*, prestamos(cliente_id, cuota, frecuencia, estado, clientes(nombre))").eq("fecha_pago", hoy);

  const totalCobradoHoy = pagosHoy.reduce((s, p) => s + Number(p.monto_pagado), 0);
  const visitadosHoy = pagosHoy.length;

  const { data: prestamosActivos } = await supabaseClient
    .from("prestamos").select("*, clientes(nombre)").eq("estado", "activo");

  const idsConPagoHoy = pagosHoy.map(p => p.prestamo_id);
  const pendientes = prestamosActivos.filter(p => !idsConPagoHoy.includes(p.id));

  document.getElementById("resumen-dia").innerHTML = `
    <div class="resumen-caja"><span class="numero">${formatoPesos(totalCobradoHoy)}</span><span class="etiqueta">Cobrado hoy</span></div>
    <div class="resumen-caja"><span class="numero">${visitadosHoy}</span><span class="etiqueta">Visitados hoy</span></div>
    <div class="resumen-caja"><span class="numero">${pendientes.length}</span><span class="etiqueta">Pendientes hoy</span></div>
  `;

  // Cartera activa total + préstamos en mora (una sola consulta para todos los pagos, no una por préstamo)
  let carteraActiva = 0;
  let clientesEnMora = 0;

  const idsPrestamosActivos = prestamosActivos.map(p => p.id);
  const pagosPorPrestamo = {};
  if (idsPrestamosActivos.length > 0) {
    const { data: todosPagos } = await supabaseClient
      .from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", idsPrestamosActivos);
    (todosPagos || []).forEach(pg => {
      pagosPorPrestamo[pg.prestamo_id] = (pagosPorPrestamo[pg.prestamo_id] || 0) + Number(pg.monto_pagado);
    });
  }

  const hoyDate = new Date(hoy + "T00:00:00");
  for (const p of prestamosActivos) {
    const totalPagado = pagosPorPrestamo[p.id] || 0;
    const totalConInteres = Number(p.monto_prestado) + (Number(p.monto_prestado) * Number(p.interes_porcentaje) / 100);
    carteraActiva += (totalConInteres - totalPagado);

    const fechaInicio = new Date(p.fecha_inicio + "T00:00:00");
    const dias = Math.floor((hoyDate - fechaInicio) / (1000 * 60 * 60 * 24));
    let cuotasEsperadas = p.frecuencia === "diario" ? dias + 1 : Math.floor(dias / 7) + 1;
    cuotasEsperadas = Math.min(cuotasEsperadas, p.numero_cuotas);
    if (totalPagado < cuotasEsperadas * Number(p.cuota)) clientesEnMora++;
  }

  document.getElementById("resumen-cartera").innerHTML = `
    <div class="resumen-caja"><span class="numero">${formatoPesos(carteraActiva)}</span><span class="etiqueta">Cartera activa</span></div>
    <div class="resumen-caja"><span class="numero">${clientesEnMora}</span><span class="etiqueta">Préstamos en mora</span></div>
  `;

  const contenedorPendientes = document.getElementById("lista-pendientes-hoy");
  contenedorPendientes.innerHTML = pendientes.length === 0
    ? `<div class="estado-vacio">🎉 Ya visitaste a todos tus clientes activos hoy.</div>`
    : pendientes.map(p => `
        <div class="tarjeta">
          <strong>${p.clientes ? p.clientes.nombre : "Cliente"}</strong>
          <span>Cuota ${p.frecuencia}: ${formatoPesos(p.cuota)}</span>
        </div>
      `).join("");
}

async function cargarGraficoSemana() {
  mostrarCargando("grafico-semana");
  const hoy = obtenerFechaLocal(); // "YYYY-MM-DD" en hora de Bogotá, sin líos de UTC

  const dias = [];
  for (let i = 6; i >= 0; i--) dias.push(sumarDias(hoy, -i));

  const { data: pagos } = await supabaseClient
    .from("pagos").select("fecha_pago, monto_pagado").gte("fecha_pago", dias[0]);

  const totalesPorDia = {};
  dias.forEach(d => totalesPorDia[d] = 0);
  (pagos || []).forEach(p => { if (totalesPorDia[p.fecha_pago] !== undefined) totalesPorDia[p.fecha_pago] += Number(p.monto_pagado); });

  const maximo = Math.max(...Object.values(totalesPorDia), 1);
  const diasSemana = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  document.getElementById("grafico-semana").innerHTML = dias.map(d => {
    const valor = totalesPorDia[d];
    const alturaPct = Math.max((valor / maximo) * 100, 3);
    const [a, m, dd] = d.split("-").map(Number);
    const diaSemana = new Date(a, m - 1, dd).getDay();
    const esHoy = d === hoy;
    return `
      <div class="barra-dia" title="${formatoPesos(valor)}">
        <div class="barra ${esHoy ? "barra-hoy" : ""}" style="height:${alturaPct}%"></div>
        <span class="etiqueta-dia">${diasSemana[diaSemana]}</span>
      </div>`;
  }).join("");
}

// --- Indicador de carga reutilizable ---
function mostrarCargando(idContenedor) {
  const el = document.getElementById(idContenedor);
  if (el) el.innerHTML = `<div class="cargando">⏳ Cargando...</div>`;
}
// --- BÚSQUEDA GLOBAL ---
function abrirBusquedaGlobal() {
  document.getElementById("modal-busqueda").classList.remove("oculto");
  document.getElementById("input-busqueda-global").value = "";
  document.getElementById("resultados-busqueda-global").innerHTML = "";
  document.getElementById("input-busqueda-global").focus();
}

function cerrarBusquedaGlobal() {
  document.getElementById("modal-busqueda").classList.add("oculto");
}

function ejecutarBusquedaGlobal() {
  const texto = document.getElementById("input-busqueda-global").value.toLowerCase();
  const contenedor = document.getElementById("resultados-busqueda-global");

  if (!texto) { contenedor.innerHTML = ""; return; }

  const fuente = (typeof clientesCache !== "undefined" && clientesCache.length > 0) ? clientesCache : clientesCobrarCache;
  const resultados = (fuente || []).filter(c => c.nombre.toLowerCase().includes(texto));

  contenedor.innerHTML = resultados.length === 0
    ? `<div class="estado-vacio">Sin resultados para "${texto}"</div>`
    : resultados.map(c => `
        <div class="tarjeta cliente-clickable" onclick="irADetalleDesdeBusqueda(${c.id})">
          <strong>${c.nombre}</strong>
          <span>📍 ${c.rutas ? c.rutas.nombre : "sin ruta"}</span>
        </div>`).join("");
}

function irADetalleDesdeBusqueda(clienteId) {
  cerrarBusquedaGlobal();
  mostrarSeccion("clientes");
  abrirDetalleCliente(clienteId);
}

// --- MODO OSCURO ---
function toggleModoOscuro() {
  document.body.classList.toggle("modo-oscuro");
  const activo = document.body.classList.contains("modo-oscuro");
  localStorage.setItem("modoOscuro", activo ? "1" : "0");
}

(function aplicarModoOscuroGuardado() {
  if (localStorage.getItem("modoOscuro") === "1") {
    document.body.classList.add("modo-oscuro");
  }
})();

// --- METAS DE RECAUDO ---
async function obtenerMetas() {
  const { data: userData } = await supabaseClient.auth.getUser();
  const { data } = await supabaseClient.from("metas").select("*").eq("user_id", userData.user.id).maybeSingle();
  return data || { meta_diaria: 0, meta_mensual: 0 };
}

async function editarMetas() {
  const metas = await obtenerMetas();

  const diaria = await mostrarPrompt("¿Cuál es tu meta de recaudo DIARIO?", metas.meta_diaria || "0");
  if (diaria === null) return;
  const mensual = await mostrarPrompt("¿Cuál es tu meta de recaudo MENSUAL?", metas.meta_mensual || "0");
  if (mensual === null) return;

  const { data: userData } = await supabaseClient.auth.getUser();
  await supabaseClient.from("metas").upsert({
    user_id: userData.user.id,
    meta_diaria: parseFloat(diaria.replace(/\D/g, "")) || 0,
    meta_mensual: parseFloat(mensual.replace(/\D/g, "")) || 0
  });

  cargarProgresoMetas();
}

async function cargarProgresoMetas() {
  const metas = await obtenerMetas();
  const hoy = obtenerFechaLocal();

  const { data: pagosHoy } = await supabaseClient.from("pagos").select("monto_pagado").eq("fecha_pago", hoy);
  const cobradoHoy = (pagosHoy || []).reduce((s, p) => s + Number(p.monto_pagado), 0);

  const inicioMes = hoy.substring(0, 7) + "-01";
  const { data: pagosMes } = await supabaseClient.from("pagos").select("monto_pagado").gte("fecha_pago", inicioMes);
  const cobradoMes = (pagosMes || []).reduce((s, p) => s + Number(p.monto_pagado), 0);

  const contenedor = document.getElementById("metas-progreso");

  if (!metas.meta_diaria && !metas.meta_mensual) {
    contenedor.innerHTML = `<div class="estado-vacio">Aún no has definido una meta. Toca "editar" para configurarla.</div>`;
    return;
  }

  const pctDiaria = metas.meta_diaria > 0 ? Math.min((cobradoHoy / metas.meta_diaria) * 100, 100) : 0;
  const pctMensual = metas.meta_mensual > 0 ? Math.min((cobradoMes / metas.meta_mensual) * 100, 100) : 0;

  contenedor.innerHTML = `
    ${metas.meta_diaria > 0 ? `
      <div class="barra-meta">
        <div class="barra-meta-etiqueta">Meta diaria: ${formatoPesos(cobradoHoy)} / ${formatoPesos(metas.meta_diaria)} (${Math.round(pctDiaria)}%)</div>
        <div class="barra-meta-fondo"><div class="barra-meta-relleno" style="width:${pctDiaria}%"></div></div>
      </div>` : ""}
    ${metas.meta_mensual > 0 ? `
      <div class="barra-meta">
        <div class="barra-meta-etiqueta">Meta mensual: ${formatoPesos(cobradoMes)} / ${formatoPesos(metas.meta_mensual)} (${Math.round(pctMensual)}%)</div>
        <div class="barra-meta-fondo"><div class="barra-meta-relleno" style="width:${pctMensual}%"></div></div>
      </div>` : ""}
  `;
}
