// --- PANTALLA DE INICIO ---
// Todo lo que carga y arma la pantalla de Inicio: resumen del día, jornada
// por rutas, gráfico semanal, tendencia, agenda de vencimientos y los
// recordatorios locales/WhatsApp. Antes vivía mezclado con caja, búsqueda
// y navegación dentro de un único main.js.

// El Inicio antes mostraba 8+ bloques de información a la vez. Ahora solo lo
// accionable del día queda siempre visible; ganancia, gráficos y agenda de
// vencimientos quedan colapsados hasta que el cobrador los pida.
function toggleMasEstadisticasInicio() {
  const bloque = document.getElementById("inicio-mas-estadisticas");
  const boton = document.getElementById("btn-ver-mas-inicio");
  if (!bloque || !boton) return;
  const abierto = bloque.classList.toggle("oculto") === false;
  boton.textContent = abierto ? "📊 Ocultar ganancia, gráficos y agenda" : "📊 Ver ganancia, gráficos y agenda de vencimientos";
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
    carteraActiva += calcularSaldoPendiente(p, totalPagado);

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
