let periodoInicioActivo = "hoy";

function mostrarSeccion(nombre) {
  document.querySelectorAll(".seccion").forEach(sec => sec.classList.add("oculto"));
  document.getElementById("seccion-" + nombre).classList.remove("oculto");
  marcarNavActivo(nombre);

  if (nombre === "inicio") { cargarResumenDia(); cargarGraficoSemana(); cargarProgresoMetas(); cargarTendenciaCobro(); cargarAgendaVencimientos(); }
  if (nombre === "clientes") cargarClientes();
  if (nombre === "prestamos") cargarClientesEnSelector();
  if (nombre === "cobrar") cargarClientesParaCobrar();
  if (nombre === "cuentas") cargarCuentasPorCobrar();
  if (nombre === "rutas") cargarRutas();
  if (nombre === "reportes") {
    cargarReporteMes();
    if (!document.getElementById("gasto-fecha").value) document.getElementById("gasto-fecha").value = obtenerFechaLocal();
  }
  cerrarMenuPrincipal();
}

function cambiarPeriodoInicio(periodo) {
  periodoInicioActivo = periodo;
  document.querySelectorAll(".pildora-periodo").forEach(btn => btn.classList.toggle("activa", btn.dataset.periodo === periodo));
  cargarResumenDia();
}

function obtenerRangoPeriodoInicio() {
  const hoy = obtenerFechaLocal();
  if (periodoInicioActivo === "ayer") return { inicio: sumarDias(hoy, -1), fin: sumarDias(hoy, -1), etiqueta: "ayer" };
  if (periodoInicioActivo === "7dias") return { inicio: sumarDias(hoy, -6), fin: hoy, etiqueta: "últimos 7 días" };
  if (periodoInicioActivo === "mes") return { inicio: hoy.substring(0, 7) + "-01", fin: hoy, etiqueta: "este mes" };
  return { inicio: hoy, fin: hoy, etiqueta: "hoy" };
}

function toggleMenuPrincipal() {
  const menu = document.getElementById("menu-inferior");
  if (!menu) return;
  const abierto = menu.classList.toggle("abierto");
  document.getElementById("menu-fondo")?.classList.toggle("oculto", !abierto);
  document.querySelector(".btn-menu-principal")?.setAttribute("aria-expanded", String(abierto));
}

function cerrarMenuPrincipal() {
  const menu = document.getElementById("menu-inferior");
  if (!menu) return;
  menu.classList.remove("abierto");
  document.getElementById("menu-fondo")?.classList.add("oculto");
  document.querySelector(".btn-menu-principal")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape") cerrarMenuPrincipal();
});

function marcarNavActivo(nombre) {
  document.querySelectorAll(".nav-btn, .barra-nav-btn, .btn-accion-flotante").forEach(btn => btn.classList.remove("activo"));
  document.querySelectorAll(`[data-nav="${nombre}"]`).forEach(btn => btn.classList.add("activo"));
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
  mostrarCargando("jornada-por-rutas");

  const hoy = obtenerFechaLocal();
  const rango = obtenerRangoPeriodoInicio();
  const titulo = document.getElementById("titulo-resumen-inicio");
  if (titulo) titulo.textContent = `Resumen de ${rango.etiqueta}`;

  const { data: pagosHoy, error: errorPagosHoy } = await supabaseClient
    .from("pagos").select("*, prestamos(cliente_id, cuota, frecuencia, estado, clientes(nombre))").gte("fecha_pago", rango.inicio).lte("fecha_pago", rango.fin);
  if (errorPagosHoy) { mostrarAlerta("No fue posible cargar el resumen de hoy."); return; }

  const pagosRegistrados = pagosHoy || [];
  const totalCobradoHoy = pagosRegistrados.reduce((s, p) => s + Number(p.monto_pagado), 0);
  const visitadosHoy = pagosRegistrados.length;

  const { data: prestamosActivos, error: errorPrestamos } = await supabaseClient
    .from("prestamos").select("*, clientes(id, nombre, direccion, orden, rutas(nombre))").eq("estado", "activo");
  if (errorPrestamos) { mostrarAlerta("No fue posible cargar la cartera."); return; }
  const prestamos = prestamosActivos || [];

  const { data: pagosDelDia } = await supabaseClient.from("pagos").select("prestamo_id").eq("fecha_pago", hoy);
  const idsConPagoHoy = (pagosDelDia || []).map(p => p.prestamo_id);
  const pendientes = prestamos.filter(p => !idsConPagoHoy.includes(p.id));

  document.getElementById("resumen-dia").innerHTML = `
    <div class="resumen-caja"><span class="numero">${formatoPesos(totalCobradoHoy)}</span><span class="etiqueta">Cobrado ${rango.etiqueta}</span></div>
    <div class="resumen-caja"><span class="numero">${visitadosHoy}</span><span class="etiqueta">Pagos registrados</span></div>
    <div class="resumen-caja"><span class="numero">${pendientes.length}</span><span class="etiqueta">Pendientes hoy</span></div>
  `;

  const metaJornada = totalCobradoHoy + pendientes.reduce((s, p) => s + Number(p.cuota || 0), 0);
  const pctCobrado = metaJornada ? Math.min((totalCobradoHoy / metaJornada) * 100, 100) : 0;
  const progreso = document.getElementById("progreso-cobro-principal");
  if (progreso) progreso.innerHTML = `
    <div class="progreso-cobro-cabecera"><span>Progreso de cobro</span><b>${Math.round(pctCobrado)}%</b></div>
    <div class="progreso-cobro-valores"><span><small>Cobrado</small><b>${formatoPesos(totalCobradoHoy)}</b></span><span><small>Pendiente</small><b>${formatoPesos(Math.max(metaJornada - totalCobradoHoy, 0))}</b></span></div>
    <div class="progreso-cobro-fondo"><div style="width:${pctCobrado}%"></div></div>`;

  // Cartera activa total + préstamos en mora (una sola consulta para todos los pagos, no una por préstamo)
  let carteraActiva = 0;
  let clientesEnMora = 0;
  const jornada = [];

  const idsPrestamosActivos = prestamos.map(p => p.id);
  const pagosPorPrestamo = {};
  if (idsPrestamosActivos.length > 0) {
    const { data: todosPagos } = await supabaseClient
      .from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", idsPrestamosActivos);
    (todosPagos || []).forEach(pg => {
      pagosPorPrestamo[pg.prestamo_id] = (pagosPorPrestamo[pg.prestamo_id] || 0) + Number(pg.monto_pagado);
    });
  }

  const hoyDate = new Date(hoy + "T00:00:00");
  for (const p of prestamos) {
    const totalPagado = pagosPorPrestamo[p.id] || 0;
    const totalConInteres = Number(p.monto_prestado) + (Number(p.monto_prestado) * Number(p.interes_porcentaje) / 100);
    carteraActiva += (totalConInteres - totalPagado);

    const fechaInicio = new Date(p.fecha_inicio + "T00:00:00");
    const dias = Math.floor((hoyDate - fechaInicio) / (1000 * 60 * 60 * 24));
    let cuotasEsperadas = p.frecuencia === "diario" ? dias + 1 : Math.floor(dias / 7) + 1;
    cuotasEsperadas = Math.min(cuotasEsperadas, p.numero_cuotas);
    const montoEsperado = cuotasEsperadas * Number(p.cuota);
    const atrasado = totalPagado < montoEsperado;
    if (atrasado) clientesEnMora++;
    if (!idsConPagoHoy.includes(p.id)) jornada.push({
      clienteId: p.cliente_id,
      cliente: p.clientes?.nombre || "Cliente",
      ruta: p.clientes?.rutas?.nombre || "Sin ruta",
      direccion: p.clientes?.direccion || "",
      orden: p.clientes?.orden,
      cuota: Number(p.cuota),
      atrasado,
      deudaVencida: Math.max(montoEsperado - totalPagado, 0)
    });
  }

  document.getElementById("resumen-cartera").innerHTML = `
    <div class="resumen-caja"><span class="numero">${formatoPesos(carteraActiva)}</span><span class="etiqueta">Cartera activa</span></div>
    <div class="resumen-caja"><span class="numero">${clientesEnMora}</span><span class="etiqueta">Préstamos en mora</span></div>
  `;

  const contenedorPendientes = document.getElementById("lista-pendientes-hoy");
  contenedorPendientes.innerHTML = "";

  pintarJornadaPorRutas(jornada);
}

let jornadaPorRutaCache = {};
let jornadaRutasOrdenNombres = [];

function pintarJornadaPorRutas(jornada) {
  const contenedor = document.getElementById("jornada-por-rutas");
  if (!contenedor) return;
  if (!jornada.length) { contenedor.innerHTML = '<div class="estado-vacio">🎉 Ya registraste la visita de todos tus clientes activos hoy.</div>'; return; }
  const porRuta = jornada.reduce((grupos, item) => {
    (grupos[item.ruta] ||= []).push(item);
    return grupos;
  }, {});
  jornadaPorRutaCache = porRuta;
  jornadaRutasOrdenNombres = [];
  contenedor.innerHTML = Object.entries(porRuta).sort(([, a], [, b]) => b.filter(x => x.atrasado).length - a.filter(x => x.atrasado).length).map(([ruta, clientes], idx) => {
    jornadaRutasOrdenNombres[idx] = ruta;
    const ordenados = [...clientes].sort((a, b) => Number(b.atrasado) - Number(a.atrasado));
    const vencidos = clientes.filter(cliente => cliente.atrasado).length;
    return `<div class="jornada-ruta">
      <div class="jornada-ruta-cabecera"><div><b>${escaparHtml(ruta)}</b><small>${clientes.length} por visitar${vencidos ? ` · ${vencidos} vencido${vencidos > 1 ? "s" : ""}` : ""}</small></div><span>${formatoPesos(clientes.reduce((total, cliente) => total + cliente.cuota, 0))}</span></div>
      <button type="button" class="btn-mapa-jornada" onclick="abrirMapaJornadaRuta(${idx})">🗺️ Ver ruta de hoy en el mapa</button>
      ${ordenados.map(cliente => `<button type="button" class="jornada-cliente ${cliente.atrasado ? "jornada-vencida" : ""}" onclick="abrirCobroCliente(${cliente.clienteId})"><span>${cliente.atrasado ? "Vencido" : "Pendiente"}</span><b>${escaparHtml(cliente.cliente)}</b><small>${cliente.atrasado ? `Debe ${formatoPesos(cliente.deudaVencida)} · ` : ""}Cuota ${formatoPesos(cliente.cuota)}</small><i>›</i></button>`).join("")}
    </div>`;
  }).join("");
}

// Abre el mapa con los clientes pendientes de HOY de esa ruta, en el orden manual
// que el cobrador definió en Rutas → Ordenar clientes (no en orden de urgencia).
function abrirMapaJornadaRuta(idx) {
  const ruta = jornadaRutasOrdenNombres[idx];
  const clientes = jornadaPorRutaCache[ruta] || [];
  const ordenadosPorVisita = [...clientes].sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999));
  const conDireccion = ordenadosPorVisita.filter(c => c.direccion && c.direccion.trim());
  if (conDireccion.length === 0) {
    mostrarAlerta(`Ningún cliente pendiente de "${ruta}" tiene dirección registrada todavía.`);
    return;
  }
  const url = construirUrlMapaClientes(conDireccion.map(c => c.direccion));
  window.open(url, "_blank", "noopener");
}

async function abrirCobroCliente(clienteId) {
  mostrarSeccion("cobrar");
  await cargarClientesParaCobrar();
  const cliente = clientesCobrarCache.find(item => item.id === clienteId);
  if (!cliente) return;
  document.getElementById("buscar-cliente-cobrar").value = cliente.nombre;
  document.getElementById("filtro-ruta-cobrar").value = "";
  cambiarFiltroCobrar("saldo");
}

async function cargarGraficoSemana() {
  mostrarCargando("grafico-semana");
  const hoy = obtenerFechaLocal(); // "YYYY-MM-DD" en hora de Bogotá, sin líos de UTC

  const dias = [];
  for (let i = 6; i >= 0; i--) dias.push(sumarDias(hoy, -i));

  const { data: pagos, error } = await supabaseClient
    .from("pagos").select("fecha_pago, monto_pagado").gte("fecha_pago", dias[0]);
  if (error) { document.getElementById("grafico-semana").textContent = "No fue posible cargar el gráfico."; return; }

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

async function cargarTendenciaCobro() {
  const contenedor = document.getElementById("tendencia-cobro");
  const hoy = obtenerFechaLocal();
  const [anio, mes] = hoy.substring(0, 7).split("-").map(Number);
  const inicioActual = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const inicioAnterior = mes === 1 ? `${anio - 1}-12-01` : `${anio}-${String(mes - 1).padStart(2, "0")}-01`;
  const { data, error } = await supabaseClient.from("pagos").select("fecha_pago, monto_pagado").gte("fecha_pago", inicioAnterior);
  if (error) { contenedor.classList.add("oculto"); return; }
  let actual = 0, anterior = 0;
  (data || []).forEach(p => { if (p.fecha_pago >= inicioActual) actual += Number(p.monto_pagado); else anterior += Number(p.monto_pagado); });
  if (!anterior) { contenedor.innerHTML = `<span>Este mes llevas <strong>${formatoPesos(actual)}</strong> recaudados.</span>`; return; }
  const variacion = ((actual - anterior) / anterior) * 100;
  const sube = variacion >= 0;
  contenedor.innerHTML = `<span class="${sube ? "tendencia-sube" : "tendencia-baja"}">${sube ? "↗" : "↘"} ${Math.abs(variacion).toFixed(1)}% ${sube ? "más" : "menos"} que el mes pasado</span><small>${formatoPesos(actual)} este mes · ${formatoPesos(anterior)} el mes anterior</small>`;
}

async function cargarAgendaVencimientos() {
  const contenedor = document.getElementById("agenda-vencimientos");
  if (!contenedor) return;
  contenedor.innerHTML = '<div class="cargando">Cargando agenda...</div>';
  const hoy = obtenerFechaLocal();
  const limite = sumarDias(hoy, 6);
  const { data: prestamos, error } = await supabaseClient
    .from("prestamos").select("id, cuota, frecuencia, fecha_inicio, clientes(nombre)").eq("estado", "activo");
  if (error) { contenedor.textContent = "No fue posible cargar la agenda."; return; }
  const ids = (prestamos || []).map(p => p.id);
  const { data: pagos } = ids.length
    ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", ids)
    : { data: [] };
  const totalPagado = {};
  (pagos || []).forEach(p => totalPagado[p.prestamo_id] = (totalPagado[p.prestamo_id] || 0) + Number(p.monto_pagado));
  const agenda = (prestamos || []).map(p => {
    const cuotasPagadas = Math.floor((totalPagado[p.id] || 0) / Number(p.cuota));
    return { ...p, proximaFecha: sumarDias(p.fecha_inicio, cuotasPagadas * (p.frecuencia === "semanal" ? 7 : 1)) };
  }).filter(p => p.proximaFecha <= limite).sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));
  contenedor.innerHTML = !agenda.length
    ? '<div class="estado-vacio">No hay cuotas próximas para los siguientes 7 días.</div>'
    : agenda.map(p => {
      const etiqueta = p.proximaFecha < hoy ? "Vencida" : p.proximaFecha === hoy ? "Hoy" : p.proximaFecha;
      return `<div class="fila-agenda ${p.proximaFecha <= hoy ? "agenda-hoy" : ""}"><span>${etiqueta}</span><strong>${escaparHtml(p.clientes?.nombre || "Cliente")}</strong><b>${formatoPesos(p.cuota)}</b></div>`;
    }).join("");
}

function prepararInicio() {
  const ahora = new Date();
  const hora = ahora.getHours();
  document.getElementById("saludo-inicio").textContent = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  document.getElementById("fecha-inicio").textContent = ahora.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
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
    ? `<div class="estado-vacio">Sin resultados para "${escaparHtml(texto)}"</div>`
    : resultados.map(c => `
        <div class="tarjeta cliente-clickable" onclick="irADetalleDesdeBusqueda(${c.id})">
          <strong>${escaparHtml(c.nombre)}</strong>
          <span>📍 ${escaparHtml(c.rutas ? c.rutas.nombre : "sin ruta")}</span>
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
  const user = await obtenerUsuarioActual();
  const { data, error } = await supabaseClient.from("metas").select("*").eq("user_id", user.id).maybeSingle();
  if (error) { mostrarAlerta("No fue posible cargar las metas."); }
  return data || { meta_diaria: 0, meta_mensual: 0 };
}

async function editarMetas() {
  const metas = await obtenerMetas();

  const diaria = await mostrarPrompt("¿Cuál es tu meta de recaudo DIARIO?", metas.meta_diaria || "0");
  if (diaria === null) return;
  const mensual = await mostrarPrompt("¿Cuál es tu meta de recaudo MENSUAL?", metas.meta_mensual || "0");
  if (mensual === null) return;

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("metas").upsert({
    user_id: user.id,
    meta_diaria: parseFloat(diaria.replace(/\D/g, "")) || 0,
    meta_mensual: parseFloat(mensual.replace(/\D/g, "")) || 0
  });

  if (error) { mostrarAlerta("No fue posible guardar las metas."); return; }
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
  cargarCajaDiaria();
}

async function cargarCajaDiaria() {
  const contenedor = document.getElementById("caja-diaria");
  if (!contenedor) return;
  const hoy = obtenerFechaLocal();
  const user = await obtenerUsuarioActual();
  const [caja, pagos, gastos, prestamos] = await Promise.all([
    supabaseClient.from("caja_diaria").select("*").eq("fecha", hoy).maybeSingle(),
    supabaseClient.from("pagos").select("monto_pagado").eq("fecha_pago", hoy),
    supabaseClient.from("gastos").select("monto").eq("fecha", hoy),
    supabaseClient.from("prestamos").select("monto_prestado, prestamo_anterior_id, fecha_inicio").eq("fecha_inicio", hoy)
  ]);
  if (caja.error) {
    contenedor.innerHTML = '<div class="caja-aviso">La caja diaria estará disponible cuando apliques la actualización de Supabase.</div>';
    return;
  }
  const cobros = (pagos.data || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
  const gastosDia = (gastos.data || []).reduce((s, g) => s + Number(g.monto), 0);
  const prestado = await calcularDesembolsoReal(prestamos.data);
  const base = Number(caja.data?.base_inicial || 0);
  const esperado = base + cobros - gastosDia - prestado;
  const cierre = caja.data?.efectivo_final;
  contenedor.innerHTML = `
    <div class="caja-cabecera"><div><span>Caja diaria</span><strong>${caja.data ? "Jornada en curso" : "Sin abrir"}</strong></div><button onclick="gestionarCajaDiaria(${caja.data ? "true" : "false"})">${caja.data ? "Cerrar caja" : "Abrir caja"}</button></div>
    <div class="caja-metricas"><span>Base <b>${formatoPesos(base)}</b></span><span>Cobros <b>${formatoPesos(cobros)}</b></span><span>Prestado (efectivo) <b>-${formatoPesos(prestado)}</b></span><span>Gastos <b>-${formatoPesos(gastosDia)}</b></span></div>
    <div class="caja-total">Efectivo esperado: <strong>${formatoPesos(esperado)}</strong>${cierre !== null && cierre !== undefined ? ` · Cierre: <strong>${formatoPesos(cierre)}</strong>` : ""}</div>`;
}

async function gestionarCajaDiaria(yaAbierta) {
  const hoy = obtenerFechaLocal();
  const user = await obtenerUsuarioActual();
  const etiqueta = yaAbierta ? "¿Con cuánto efectivo terminaste hoy?" : "¿Con cuánto efectivo empiezas hoy?";
  const texto = await mostrarPrompt(etiqueta, "0");
  if (texto === null) return;
  const valor = Number(String(texto).replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(valor) || valor < 0) { mostrarAlerta("Ingresa un valor válido."); return; }
  const datos = yaAbierta ? { user_id: user.id, fecha: hoy, efectivo_final: valor } : { user_id: user.id, fecha: hoy, base_inicial: valor, efectivo_final: null };
  const { error } = await supabaseClient.from("caja_diaria").upsert(datos, { onConflict: "user_id,fecha" });
  if (error) { mostrarAlerta("No fue posible guardar la caja: " + error.message); return; }
  cargarCajaDiaria();
}
