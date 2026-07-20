let periodoInicioActivo = "hoy";

function mostrarSeccion(nombre, desdeHistorial = false) {
  document.querySelectorAll(".seccion").forEach(sec => sec.classList.add("oculto"));
  document.getElementById("seccion-" + nombre).classList.remove("oculto");
  marcarNavActivo(nombre);

  if (nombre === "inicio") { cargarResumenDia(); cargarGraficoSemana(); cargarCajaDiaria(obtenerFechaLocal()); cargarTendenciaCobro(); cargarAgendaVencimientos(); cargarGananciaInicio(); }
  if (nombre === "clientes") cargarClientes();
  if (nombre === "prestamos") cargarClientesEnSelector();
  if (nombre === "cobrar") cargarClientesParaCobrar();
  if (nombre === "cuentas") cargarCuentasPorCobrar();
  if (nombre === "rutas") cargarRutas();
  if (nombre === "configuracion") { actualizarFilaConfigBloqueo(); actualizarFilaConfigPush(); actualizarFilaConfigCaja(); }
  if (nombre === "reportes") {
    cargarReporteMes();
    if (!document.getElementById("gasto-fecha").value) document.getElementById("gasto-fecha").value = obtenerFechaLocal();
    cargarRutasEnSelectorGasto();
  }
  cerrarMenuPrincipal();

  // Deja registrado el cambio de sección en el historial para que el botón
  // atrás del celular navegue dentro de la app en vez de salir directamente.
  if (typeof navegacionMovilPreparada !== "undefined" && navegacionMovilPreparada && !desdeHistorial) {
    if (estadoNavActual.modal) document.getElementById(estadoNavActual.modal)?.classList.add("oculto");
    if (nombre !== estadoNavActual.seccion || estadoNavActual.modal) {
      estadoNavActual = { seccion: nombre, modal: null };
      window.history.pushState(estadoNavActual, "");
    }
  }
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
    .from("prestamos").select("id, cuota, frecuencia, fecha_inicio, clientes(nombre, telefono)").eq("estado", "activo");
  if (error) { contenedor.textContent = "No fue posible cargar la agenda."; return; }
  const ids = (prestamos || []).map(p => p.id);
  const { data: pagos } = ids.length
    ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", ids)
    : { data: [] };
  const totalPagado = {};
  (pagos || []).forEach(p => totalPagado[p.prestamo_id] = (totalPagado[p.prestamo_id] || 0) + Number(p.monto_pagado));
  const manana = sumarDias(hoy, 1);
  const agenda = (prestamos || []).map(p => {
    const cuotasPagadas = Math.floor((totalPagado[p.id] || 0) / Number(p.cuota));
    return { ...p, proximaFecha: sumarDias(p.fecha_inicio, cuotasPagadas * (p.frecuencia === "semanal" ? 7 : 1)) };
  }).filter(p => p.proximaFecha <= limite).sort((a, b) => a.proximaFecha.localeCompare(b.proximaFecha));
  contenedor.innerHTML = !agenda.length
    ? '<div class="estado-vacio">No hay cuotas próximas para los siguientes 7 días.</div>'
    : agenda.map(p => {
      const etiqueta = p.proximaFecha < hoy ? "Vencida" : p.proximaFecha === hoy ? "Hoy" : p.proximaFecha;
      const telefonoLimpio = (p.clientes?.telefono || "").replace(/\D/g, "");
      const puedeRecordar = p.proximaFecha === manana && telefonoLimpio;
      return `<div class="fila-agenda ${p.proximaFecha <= hoy ? "agenda-hoy" : ""}"><span>${etiqueta}</span><strong>${escaparHtml(p.clientes?.nombre || "Cliente")}</strong><b>${formatoPesos(p.cuota)}</b>${puedeRecordar ? `<button type="button" class="btn-recordar-whatsapp" onclick="enviarRecordatorioWhatsapp('${escaparAtributoJs(p.clientes.nombre)}', '${telefonoLimpio}', ${p.cuota})">💬 Recordar</button>` : ""}</div>`;
    }).join("");

  const pendientesHoy = agenda.filter(p => p.proximaFecha <= hoy).length;
  mostrarLinkRecordatorios(pendientesHoy);
  dispararRecordatorioLocal(pendientesHoy);
}

// --- RECORDATORIOS LOCALES DE VENCIMIENTOS ---
// Son notificaciones del propio navegador/celular (Notification API), no un
// push real de servidor: solo se disparan mientras la app está abierta o en
// segundo plano reciente. Para avisos aunque el celular tenga la app cerrada
// hace falta un servicio de push con backend, que esta app (estática +
// Supabase) no tiene todavía — ver analisis-app-cobros.md.
let ultimoAvisoRecordatorioLocal = null;

function mostrarLinkRecordatorios(pendientesHoy) {
  const link = document.getElementById("link-activar-recordatorios");
  if (!link || typeof Notification === "undefined") return;
  link.classList.toggle("oculto", Notification.permission === "granted" || pendientesHoy === 0);
}

async function activarRecordatoriosLocales() {
  if (typeof Notification === "undefined") { mostrarAlerta("Este navegador no soporta notificaciones."); return; }
  const permiso = await Notification.requestPermission();
  document.getElementById("link-activar-recordatorios").classList.add("oculto");
  if (permiso === "granted") mostrarAlerta("🔔 Listo. Te avisaremos aquí cuando haya cuotas vencidas u hoy, mientras tengas la app abierta.");
}

// --- RECORDATORIO POR WHATSAPP (un día antes de que venza la cuota) ---
// Abre WhatsApp con un mensaje ya redactado; el cobrador solo revisa y envía.
// Usa la misma lógica de armarNumeroWhatsapp() de clientes.js para el indicativo.
function enviarRecordatorioWhatsapp(nombreCliente, telefonoLimpio, montoCuota) {
  const mensaje = `Hola ${nombreCliente}, te recuerdo que mañana vence tu cuota de ${formatoPesos(montoCuota)}. ¡Gracias por tu pago puntual! 🙏`;
  window.open(`https://wa.me/${armarNumeroWhatsapp(telefonoLimpio)}?text=${encodeURIComponent(mensaje)}`, "_blank", "noopener");
}

function dispararRecordatorioLocal(pendientesHoy) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || pendientesHoy === 0) return;
  const hoyTexto = obtenerFechaLocal();
  if (ultimoAvisoRecordatorioLocal === hoyTexto) return; // solo un aviso por día por sesión
  ultimoAvisoRecordatorioLocal = hoyTexto;
  new Notification("App Cobros", {
    body: `Tienes ${pendientesHoy} cuota${pendientesHoy > 1 ? "s" : ""} vencida${pendientesHoy > 1 ? "s" : ""} u hoy.`
  });
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
  empujarEstadoModal("modal-busqueda");
}

function cerrarBusquedaGlobal() {
  cerrarModalConHistorial("modal-busqueda");
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

// --- CUADRE AUTOMÁTICO DE CAJA ---
// Por defecto la caja es MANUAL: cada mañana tocas "Abrir caja" (te sugiere
// la base, pero la confirmas tú) y cada noche cuentas el efectivo físico
// para comparar contra lo esperado. Eso sirve para detectar diferencias
// reales (billetes que faltan, un gasto que se te olvidó anotar, etc.).
//
// Si activas el cuadre AUTOMÁTICO, la app deja de pedir ese conteo: cada día
// abre solo, usando la fórmula (base de ayer + cobros + aportes − gastos −
// prestado) como la base real de hoy, sin que nadie la confirme a mano. Es
// más cómodo, pero pierdes esa segunda revisión física — si un día alguien
// se equivoca anotando un gasto o un cobro, la caja "cuadra" igual, porque ya
// no hay un conteo real con qué compararla. Aun así, mientras el cuadre
// automático está activo, puedes tocar "🧮 Contar caja física" cuando
// quieras hacer una revisión puntual, sin tener que desactivar el modo.
let cajaAutomaticaCache = null;

async function obtenerPreferenciaCajaAutomatica(forzarRecarga = false) {
  if (cajaAutomaticaCache !== null && !forzarRecarga) return cajaAutomaticaCache;
  try {
    const user = await obtenerUsuarioActual();
    const { data } = await supabaseClient.from("preferencias_usuario").select("caja_automatica").eq("user_id", user.id).maybeSingle();
    cajaAutomaticaCache = !!data?.caja_automatica;
  } catch (e) {
    cajaAutomaticaCache = false;
  }
  return cajaAutomaticaCache;
}

async function actualizarFilaConfigCaja() {
  const fila = document.getElementById("fila-config-caja-auto");
  if (!fila) return;
  const activa = await obtenerPreferenciaCajaAutomatica();
  fila.querySelector("small").textContent = activa
    ? "Activado · la base se calcula sola cada día · toca para volver a manual"
    : "La base de cada día se calcula sola, sin contar efectivo";
}

async function toggleCajaAutomatica() {
  if (!requiereConexion()) return;
  const activaAhora = await obtenerPreferenciaCajaAutomatica();

  if (!activaAhora) {
    const confirmar = await mostrarConfirmacion("🧮 Con el cuadre automático activado, la app ya no te va a pedir contar el efectivo físico cada día: va a calcular sola la base de mañana con la fórmula (base de ayer + cobros + aportes − gastos − prestado).<br><br>Es más rápido, pero dejas de tener un conteo físico que te avise si algo no cuadra en la calle. Igual vas a poder contar la caja cuando quieras con el botón \"Contar caja física\".<br><br>¿Activar el cuadre automático?");
    if (!confirmar) return;
  } else {
    const confirmar = await mostrarConfirmacion("¿Volver al modo manual? Vas a tener que tocar \"Abrir caja\" cada mañana y contar el efectivo al cerrar, como antes.");
    if (!confirmar) return;
  }

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("preferencias_usuario")
    .upsert({ user_id: user.id, caja_automatica: !activaAhora }, { onConflict: "user_id" });
  if (error) { mostrarAlerta("No fue posible guardar la preferencia: " + traducirErrorSupabase(error)); return; }

  cajaAutomaticaCache = !activaAhora;
  actualizarFilaConfigCaja();
  mostrarAlerta(!activaAhora ? "✅ Cuadre automático activado." : "✅ Volviste al cuadre manual.");
  cargarCajaDiaria(obtenerFechaLocal());
}


// fechaCajaMostrada indica qué día se está viendo en el widget de Inicio.
// Por defecto es siempre HOY (con todos los botones activos); si el cobrador
// usa "Ver otro día", queda en modo SOLO LECTURA para no arriesgar a que
// edite sin querer el cierre de un día que ya pasó.
let fechaCajaMostrada = null;

async function cargarCajaDiaria(fecha) {
  const contenedor = document.getElementById("caja-diaria");
  if (!contenedor) return;
  const hoy = obtenerFechaLocal();
  if (fecha) fechaCajaMostrada = fecha;
  if (!fechaCajaMostrada) fechaCajaMostrada = hoy;
  const fechaVista = fechaCajaMostrada;
  const esHoy = fechaVista === hoy;
  const automatica = esHoy ? await obtenerPreferenciaCajaAutomatica() : false;

  // Cuadre automático: si hoy todavía no se ha "abierto" la caja, se abre
  // sola con la base calculada — sin preguntar nada — para que el cobrador
  // no tenga que tocar ningún botón cada mañana.
  if (automatica && esHoy) {
    const { data: cajaHoyExiste } = await supabaseClient.from("caja_diaria").select("id").eq("fecha", hoy).maybeSingle();
    if (!cajaHoyExiste) {
      const user = await obtenerUsuarioActual();
      const baseCalculada = await sugerirBaseConAviso();
      await supabaseClient.from("caja_diaria")
        .upsert({ user_id: user.id, fecha: hoy, base_inicial: baseCalculada, efectivo_final: null }, { onConflict: "user_id,fecha", ignoreDuplicates: true });
    }
  }

  const [caja, pagos, gastos, prestamos, aportes] = await Promise.all([
    supabaseClient.from("caja_diaria").select("*").eq("fecha", fechaVista).maybeSingle(),
    supabaseClient.from("pagos").select("monto_pagado").eq("fecha_pago", fechaVista),
    supabaseClient.from("gastos").select("monto").eq("fecha", fechaVista),
    supabaseClient.from("prestamos").select("monto_prestado, prestamo_anterior_id, fecha_inicio").eq("fecha_inicio", fechaVista),
    supabaseClient.from("aportes_capital").select("*").eq("fecha", fechaVista).order("creado_en")
  ]);

  if (caja.error) {
    // Distinguimos "la tabla no existe todavía" (falta aplicar una migración)
    // de cualquier otro error (por ejemplo, un corte de señal momentáneo),
    // para no decirte "actualiza Supabase" cuando el problema es otro.
    const tablaNoExiste = caja.error.code === "42P01" || /relation .* does not exist/i.test(caja.error.message || "");
    contenedor.innerHTML = tablaNoExiste
      ? '<div class="caja-aviso">La caja diaria estará disponible cuando apliques la actualización de Supabase.</div>'
      : `<div class="caja-aviso">No fue posible cargar la caja diaria (${escaparHtml(caja.error.message || "error de conexión")}). <button type="button" onclick="cargarCajaDiaria()">Reintentar</button></div>`;
    return;
  }

  const cobros = (pagos.data || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
  const gastosDia = (gastos.data || []).reduce((s, g) => s + Number(g.monto), 0);
  const listaAportes = aportes.data || [];
  const aportesDia = listaAportes.reduce((s, a) => s + Number(a.monto), 0);
  const prestado = await calcularDesembolsoReal(prestamos.data);
  const base = Number(caja.data?.base_inicial || 0);
  const esperado = base + cobros + aportesDia - gastosDia - prestado;
  const cierre = caja.data?.efectivo_final;
  const hayConteo = cierre !== null && cierre !== undefined;
  const descuadre = hayConteo ? Number(cierre) - esperado : 0;

  const colaOffline = esHoy ? obtenerColaOffline().length : 0;
  const avisoOffline = colaOffline > 0
    ? `<div class="caja-aviso-offline">⏳ Tienes ${colaOffline} pago${colaOffline > 1 ? "s" : ""} sin sincronizar todavía — el "Cobrado" de aquí abajo no los incluye aún. Espera a tener señal antes de ${automatica ? "contar la caja" : "cerrar caja"} para que el conteo sea exacto.</div>`
    : "";

  // En modo automático contar el efectivo es opcional, así que si nadie lo
  // hace por varios días el cálculo puede acumular un error sin que nadie se
  // entere. Este aviso te lo recuerda cada vez que abres la app.
  const rachaSinVerificar = automatica && esHoy ? await calcularRachaSinVerificarCaja() : 0;
  const avisoRacha = rachaSinVerificar >= 2
    ? `<div class="caja-aviso-offline">⚠️ Llevas ${rachaSinVerificar} días sin contar tu caja física. Te recomendamos tocar "🧮 Contar caja física" pronto, para asegurarte de que no se esté acumulando un error entre lo calculado y lo real.</div>`
    : "";

  const encabezadoFecha = esHoy
    ? `<button type="button" class="link-ver-otro-dia" onclick="verCajaDeOtroDia()">📅 Ver otro día</button>`
    : `<span class="caja-fecha-vista">📅 ${fechaVista} (solo lectura)</span> <button type="button" class="link-ver-otro-dia" onclick="volverACajaDeHoy()">← Volver a hoy</button>`;

  // En modo automático no hay "Abrir/Cerrar caja" (eso ya pasó solo); en su
  // lugar se ofrece un conteo físico OPCIONAL, para quien igual quiera
  // verificar de vez en cuando sin desactivar el modo automático.
  const botonAccion = !esHoy ? "" : automatica
    ? `<button type="button" class="btn-contar-caja-auto" onclick="gestionarCajaDiaria(true)">🧮 Contar caja física</button>`
    : `<button onclick="gestionarCajaDiaria(${caja.data ? "true" : "false"})">${caja.data ? "Cerrar caja" : "Abrir caja"}</button>`;

  const editarBase = esHoy && caja.data
    ? ` <button type="button" class="link-editar-base" onclick="editarBaseCaja()" title="Corregir base inicial">✏️</button>` : "";

  // Antes, una vez cerrabas la caja de hoy (contabas el efectivo final), no
  // había forma de deshacerlo: el botón seguía diciendo "Cerrar caja" y solo
  // dejaba sobrescribir el conteo, pero no volver al estado "abierta". Si
  // cerrabas por error, o si te faltaba registrar algo más ese mismo día, no
  // había salida. Este botón deshace el cierre (borra el conteo guardado).
  const botonReabrir = esHoy && caja.data && !automatica && hayConteo
    ? ` <button type="button" class="link-editar-base" onclick="reabrirCajaDeHoy()" title="Deshacer el cierre de hoy">🔓 Reabrir</button>` : "";

  const listaAportesHtml = listaAportes.length === 0 ? "" : `
    <div class="caja-lista-aportes">
      ${listaAportes.map(a => `
        <div class="fila-aporte">
          <span>+${formatoPesos(a.monto)}${a.nota ? ` · ${escaparHtml(a.nota)}` : ""}</span>
          ${esHoy ? `<span class="acciones-aporte">
            <span onclick="editarAportePropio(${a.id})" title="Editar">✏️</span>
            <span onclick="eliminarAportePropio(${a.id})" title="Eliminar">🗑️</span>
          </span>` : ""}
        </div>`).join("")}
    </div>`;

  contenedor.innerHTML = `
    <div class="caja-cabecera"><div><span>Caja diaria</span><strong>${!caja.data ? "Sin abrir" : !esHoy ? "Cerrada" : automatica ? (hayConteo ? "🧮 Automática · ✅ Verificada hoy" : "🧮 Automática · ⏳ Sin verificar hoy") : "Jornada en curso"}</strong></div>${botonAccion}</div>
    <div class="caja-subcabecera">${encabezadoFecha}${botonReabrir}</div>
    ${avisoOffline}
    ${avisoRacha}
    <div class="caja-metricas"><span>Base <b>${formatoPesos(base)}</b>${editarBase}</span><span>Cobros <b>${formatoPesos(cobros)}</b></span>${aportesDia > 0 ? `<span>Aporte propio <b>+${formatoPesos(aportesDia)}</b></span>` : ""}<span>Prestado (efectivo) <b>-${formatoPesos(prestado)}</b></span><span>Gastos <b>-${formatoPesos(gastosDia)}</b></span></div>
    ${listaAportesHtml}
    <div class="caja-total">Efectivo esperado: <strong>${formatoPesos(esperado)}</strong>${hayConteo ? ` · Contado: <strong>${formatoPesos(cierre)}</strong>${automatica ? ` <small>(al momento de contar — si registras más cobros/gastos después, puede quedar desactualizado)</small>` : ""}` : ""}</div>
    ${hayConteo ? `
      <div class="caja-descuadre ${descuadre === 0 ? "cuadrada" : descuadre > 0 ? "sobrante" : "faltante"}">
        ${descuadre === 0 ? "✅ Caja cuadrada — el conteo físico coincide con lo esperado" : descuadre > 0 ? `🔵 Sobrante de ${formatoPesos(descuadre)} — contaste más efectivo del esperado` : `🔴 Faltante de ${formatoPesos(Math.abs(descuadre))} — contaste menos efectivo del esperado`}
      </div>` : ""}
    ${esHoy && caja.data && (automatica || !hayConteo) ? `<button type="button" class="btn-aporte-propio" onclick="agregarAportePropio()">➕ Agregar efectivo propio</button>` : ""}`;
}

function verCajaDeOtroDia() {
  mostrarPrompt("¿Qué día quieres consultar? (formato AAAA-MM-DD)", fechaCajaMostrada || obtenerFechaLocal())
    .then(fecha => {
      if (!fecha) return;
      const valida = /^\d{4}-\d{2}-\d{2}$/.test(fecha.trim());
      if (!valida) { mostrarAlerta("Escribe la fecha en formato AAAA-MM-DD, por ejemplo 2026-07-15."); return; }
      cargarCajaDiaria(fecha.trim());
    });
}

function volverACajaDeHoy() {
  cargarCajaDiaria(obtenerFechaLocal());
}

// Cuenta cuántos días SEGUIDOS hacia atrás (sin contar hoy, que puede seguir
// en curso) no se ha contado el efectivo físico. Solo tiene sentido en modo
// automático, donde contar es opcional — en modo manual siempre es 0 porque
// cerrar caja obliga a contar cada día.
async function calcularRachaSinVerificarCaja() {
  const hoy = obtenerFechaLocal();
  const desde = sumarDias(hoy, -13);
  const { data } = await supabaseClient.from("caja_diaria").select("fecha, efectivo_final").gte("fecha", desde).lte("fecha", hoy).order("fecha", { ascending: false });
  if (!data) return 0;
  let racha = 0;
  for (const fila of data) {
    if (fila.fecha === hoy) continue;
    if (fila.efectivo_final === null || fila.efectivo_final === undefined) racha++;
    else break;
  }
  return racha;
}

// Deshace el cierre de hoy (borra el conteo de efectivo final guardado), para
// poder seguir trabajando o volver a cerrar más tarde con el número correcto.
async function reabrirCajaDeHoy() {
  const confirmar = await mostrarConfirmacion("¿Reabrir la caja de hoy? Esto borra el conteo de cierre que ya guardaste — vas a poder seguir registrando cosas y volver a cerrar más tarde.");
  if (!confirmar) return;
  const user = await obtenerUsuarioActual();
  const hoy = obtenerFechaLocal();
  const { error } = await supabaseClient.from("caja_diaria").update({ efectivo_final: null }).eq("user_id", user.id).eq("fecha", hoy);
  if (error) { mostrarAlerta("No fue posible reabrir la caja: " + traducirErrorSupabase(error)); return; }
  cargarCajaDiaria(hoy);
}

// Calcula con cuánto efectivo debería empezar el día de hoy, tomando el
// cierre de ayer como punto de partida (así el cobrador no tiene que hacer
// esta cuenta a mano cada mañana). Prioridad:
//   1. Si ayer contaste físicamente la caja al cerrar (efectivo_final), esa
//      es la base real y más confiable.
//   2. Si abriste caja ayer pero no la cerraste, se calcula lo que debería
//      haber quedado (base + cobros + aportes - gastos - prestado de ayer).
//   3. Si no hay ningún registro de ayer (primer día, o se te pasó), 0 — y el
//      cobrador puede escribir el monto real a mano, como siempre.
async function calcularBaseSugerida() {
  const ayer = sumarDias(obtenerFechaLocal(), -1);
  const { data: cajaAyer } = await supabaseClient.from("caja_diaria").select("*").eq("fecha", ayer).maybeSingle();
  if (!cajaAyer) return 0;
  if (cajaAyer.efectivo_final !== null && cajaAyer.efectivo_final !== undefined) {
    return Number(cajaAyer.efectivo_final);
  }
  const [pagos, gastos, prestamos, aportes] = await Promise.all([
    supabaseClient.from("pagos").select("monto_pagado").eq("fecha_pago", ayer),
    supabaseClient.from("gastos").select("monto").eq("fecha", ayer),
    supabaseClient.from("prestamos").select("monto_prestado, prestamo_anterior_id, fecha_inicio").eq("fecha_inicio", ayer),
    supabaseClient.from("aportes_capital").select("monto").eq("fecha", ayer)
  ]);
  const cobros = (pagos.data || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
  const gastosDia = (gastos.data || []).reduce((s, g) => s + Number(g.monto), 0);
  const aportesDia = (aportes.data || []).reduce((s, a) => s + Number(a.monto), 0);
  const prestado = await calcularDesembolsoReal(prestamos.data);
  const baseAyer = Number(cajaAyer.base_inicial || 0);
  // OJO: aquí ya NO se fuerza a 0 con Math.max — si el resultado da negativo
  // (prestaste o gastaste más efectivo del que tenías, por ejemplo poniendo
  // plata de tu bolsillo sin registrarla como "aporte propio"), se devuelve
  // el número real. La base que se GUARDA en la caja de hoy sí tiene que ser
  // 0 como mínimo (el efectivo físico no puede ser negativo), pero quien
  // llama a esta función es responsable de avisar sobre ese faltante en vez
  // de simplemente esconderlo — ver sugerirBaseConAviso() más abajo.
  return baseAyer + cobros + aportesDia - gastosDia - prestado;
}

// Envuelve calcularBaseSugerida() para que, si el resultado da negativo, no
// desaparezca sin más: te avisa cuánto quedaste debiendo y te recuerda que la
// próxima vez lo ideal es registrarlo con "➕ Agregar efectivo propio" en el
// momento en que prestas ese dinero extra — así queda contado en la cartera
// desde el primer día, en vez de aparecer como un faltante después.
async function sugerirBaseConAviso(silencioso) {
  const sugerida = await calcularBaseSugerida();
  if (sugerida >= 0) return sugerida;
  if (!silencioso) {
    await mostrarAlerta(`⚠️ Ayer terminaste con ${formatoPesos(Math.abs(sugerida))} de más prestado/gastado de lo que tenías en caja — probablemente pusiste plata de tu bolsillo. La base de hoy queda en $0 porque el efectivo físico no puede ser negativo, pero esa plata la tienes que recuperar de la cartera.\n\nTip: la próxima vez que prestes efectivo propio, regístralo ahí mismo con "➕ Agregar efectivo propio" — así queda contado desde el primer día y no se te pierde.`);
  }
  return 0;
}

async function gestionarCajaDiaria(yaAbierta) {
  if (!requiereConexion()) return;
  const hoy = obtenerFechaLocal();
  const user = await obtenerUsuarioActual();

  // Si vamos a CERRAR la caja y todavía hay pagos guardados sin conexión que
  // no han llegado a Supabase, el "Cobrado" que se ve en pantalla está
  // incompleto: cerrar ahora mostraría un faltante que en realidad no existe.
  if (yaAbierta) {
    const pendientes = obtenerColaOffline().length;
    if (pendientes > 0) {
      const continuar = await mostrarConfirmacion(`⏳ Tienes ${pendientes} pago${pendientes > 1 ? "s" : ""} guardado${pendientes > 1 ? "s" : ""} sin conexión que aún no se ha${pendientes > 1 ? "n" : ""} enviado a Supabase. Si cierras la caja ahora, el conteo puede mostrar un faltante que en realidad no existe.<br><br>Lo ideal es esperar a tener señal y dejar que se sincronicen solos.<br><br>¿Quieres cerrar la caja de todas formas?`);
      if (!continuar) return;
    }
  }

  // Al reabrir el diálogo de cierre (por ejemplo, para corregir un conteo que
  // ya habías guardado), se muestra el valor que ya tienes guardado, no cero
  // — así evitamos que un clic accidental te borre el conteo real.
  let valorDefault = 0;
  if (yaAbierta) {
    const { data: cajaHoy } = await supabaseClient.from("caja_diaria").select("efectivo_final").eq("fecha", hoy).maybeSingle();
    valorDefault = (cajaHoy?.efectivo_final !== null && cajaHoy?.efectivo_final !== undefined) ? Math.round(cajaHoy.efectivo_final) : "0";
  } else {
    valorDefault = Math.round(await sugerirBaseConAviso());
  }

  const etiqueta = yaAbierta
    ? "¿Con cuánto efectivo terminaste hoy?"
    : "¿Con cuánto efectivo empiezas hoy? (ya calculamos lo que debería quedar de ayer — ajústalo si contaste algo distinto)";
  const texto = await mostrarPrompt(etiqueta, valorDefault, true);
  if (texto === null) return;
  const valor = Number(String(texto).replace(/\D/g, "")) || 0;
  if (valor < 0) { mostrarAlerta("Ingresa un valor válido."); return; }
  const datos = yaAbierta ? { user_id: user.id, fecha: hoy, efectivo_final: valor } : { user_id: user.id, fecha: hoy, base_inicial: valor, efectivo_final: null };
  const { error } = await supabaseClient.from("caja_diaria").upsert(datos, { onConflict: "user_id,fecha" });
  if (error) { mostrarAlerta("No fue posible guardar la caja: " + traducirErrorSupabase(error)); return; }
  cargarCajaDiaria(hoy);
}

// Corregir la base inicial del día si te equivocaste al escribirla al abrir caja.
async function editarBaseCaja() {
  if (!requiereConexion()) return;
  const hoy = obtenerFechaLocal();
  const { data: cajaHoy } = await supabaseClient.from("caja_diaria").select("base_inicial").eq("fecha", hoy).maybeSingle();
  const texto = await mostrarPrompt("Corrige la base inicial de hoy:", Math.round(Number(cajaHoy?.base_inicial || 0)), true);
  if (texto === null) return;
  const valor = Number(String(texto).replace(/\D/g, "")) || 0;
  if (valor < 0) { mostrarAlerta("Ingresa un valor válido."); return; }
  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("caja_diaria").update({ base_inicial: valor }).eq("user_id", user.id).eq("fecha", hoy);
  if (error) { mostrarAlerta("No fue posible corregir la base: " + traducirErrorSupabase(error)); return; }
  cargarCajaDiaria(hoy);
}

// --- EFECTIVO PROPIO (no es plata de la cartera) ---
// Para cuando el cobrador mete dinero de su propio bolsillo — por ejemplo,
// para completar un préstamo que necesita más efectivo del que hay en caja.
// Queda registrado aparte de los cobros normales, para no confundirlo con
// ganancias del negocio en los reportes, pero sí se suma al efectivo
// esperado de la caja de hoy. Se puede editar o borrar mientras el día siga abierto.
async function agregarAportePropio() {
  if (!requiereConexion()) return;
  const monto = await mostrarPrompt("¿Cuánto efectivo PROPIO (no de la cartera) vas a meter a la caja de hoy? Por ejemplo, para completar un préstamo.", "0", true);
  if (monto === null) return;
  const montoLimpio = Number(String(monto).replace(/\D/g, "")) || 0;
  if (montoLimpio <= 0) { mostrarAlerta("Ingresa un monto válido."); return; }
  const nota = await mostrarPrompt("¿Para qué fue este aporte? (opcional)", "");

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("aportes_capital").insert({
    user_id: user.id, fecha: obtenerFechaLocal(), monto: montoLimpio, nota: nota || null
  });
  if (error) { mostrarAlerta("No fue posible registrar el aporte: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("✅ Aporte registrado. Ya se sumó al efectivo esperado de hoy.");
  cargarCajaDiaria(obtenerFechaLocal());
}

async function editarAportePropio(aporteId) {
  if (!requiereConexion()) return;
  const { data: aporte } = await supabaseClient.from("aportes_capital").select("*").eq("id", aporteId).maybeSingle();
  if (!aporte) { mostrarAlerta("Ese aporte ya no existe."); cargarCajaDiaria(obtenerFechaLocal()); return; }
  const monto = await mostrarPrompt("Corrige el monto del aporte:", Math.round(Number(aporte.monto)), true);
  if (monto === null) return;
  const montoLimpio = Number(String(monto).replace(/\D/g, "")) || 0;
  if (montoLimpio <= 0) { mostrarAlerta("Ingresa un monto válido."); return; }
  const nota = await mostrarPrompt("¿Para qué fue este aporte? (opcional)", aporte.nota || "");
  const { error } = await supabaseClient.from("aportes_capital").update({ monto: montoLimpio, nota: nota || null }).eq("id", aporteId);
  if (error) { mostrarAlerta("No fue posible corregir el aporte: " + traducirErrorSupabase(error)); return; }
  cargarCajaDiaria(obtenerFechaLocal());
}

async function eliminarAportePropio(aporteId) {
  const confirmado = await mostrarConfirmacion("¿Eliminar este aporte propio? Se restará del efectivo esperado de hoy.");
  if (!confirmado) return;
  const { error } = await supabaseClient.from("aportes_capital").delete().eq("id", aporteId);
  if (error) { mostrarAlerta("No fue posible eliminar el aporte: " + traducirErrorSupabase(error)); return; }
  cargarCajaDiaria(obtenerFechaLocal());
}
