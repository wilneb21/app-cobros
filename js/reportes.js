// Reportes mostraba de una vez: totales, comparación, gráfico de cartera,
// rendimiento por ruta, refinanciamientos y 5 botones de exportación. Ahora
// solo quedan visibles los totales del período; el resto se abre a pedido.
function toggleBloqueReportes(idBloque, boton, textoCerrado, textoAbierto) {
  const bloque = document.getElementById(idBloque);
  if (!bloque) return;
  const abierto = bloque.classList.toggle("oculto") === false;
  boton.textContent = abierto ? textoAbierto : textoCerrado;
}

function cambiarTipoReporte() {
  const tipo = document.getElementById("reporte-tipo").value;
  document.getElementById("reporte-fecha-dia").classList.add("oculto");
  document.getElementById("reporte-mes").classList.add("oculto");
  document.getElementById("reporte-anio").classList.add("oculto");
  document.getElementById("reporte-rango").classList.add("oculto");
  if (tipo === "dia") document.getElementById("reporte-fecha-dia").classList.remove("oculto");
  if (tipo === "mes") document.getElementById("reporte-mes").classList.remove("oculto");
  if (tipo === "anio") document.getElementById("reporte-anio").classList.remove("oculto");
  if (tipo === "rango") {
    document.getElementById("reporte-rango").classList.remove("oculto");
    const hoy = obtenerFechaLocal();
    if (!document.getElementById("reporte-rango-desde").value) document.getElementById("reporte-rango-desde").value = sumarDias(hoy, -6);
    if (!document.getElementById("reporte-rango-hasta").value) document.getElementById("reporte-rango-hasta").value = hoy;
  }
  // "semana" no necesita selector propio: siempre es la semana actual (lunes a domingo)
  // "rango" se dispara con el botón "Ver reporte" (para no recargar con cada tecla mientras se escribe la fecha)
  if (tipo !== "rango") cargarReporteMes();
}

// Devuelve el lunes de la semana que contiene la fecha dada ("YYYY-MM-DD")
function obtenerLunesDeSemana(fechaTexto) {
  const [a, m, d] = fechaTexto.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  const diaSemana = fecha.getDay(); // 0 = domingo
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  fecha.setDate(fecha.getDate() + diff);
  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${año}-${mes}-${dia}`;
}

async function cargarReporteMes() {
  const tipo = document.getElementById("reporte-tipo").value;
  const hoy = obtenerFechaLocal();
  let inicio, fin, etiquetaPeriodo;
  document.getElementById("comparacion-mes").classList.add("oculto");

  if (tipo === "dia") {
    const inputDia = document.getElementById("reporte-fecha-dia");
    if (!inputDia.value) inputDia.value = hoy;
    inicio = inputDia.value;
    const fecha = new Date(inputDia.value + "T00:00:00");
    fecha.setDate(fecha.getDate() + 1);
    fin = fecha.toISOString().split("T")[0];
    etiquetaPeriodo = "el día";
  } else if (tipo === "semana") {
    inicio = obtenerLunesDeSemana(hoy);
    const finFecha = new Date(inicio + "T00:00:00");
    finFecha.setDate(finFecha.getDate() + 7);
    fin = finFecha.toISOString().split("T")[0];
    etiquetaPeriodo = "esta semana";
  } else if (tipo === "rango") {
    const desde = document.getElementById("reporte-rango-desde").value;
    const hasta = document.getElementById("reporte-rango-hasta").value;
    if (!desde || !hasta) return; // el botón "Ver reporte" espera a que se llenen las dos fechas
    if (desde > hasta) { mostrarAlerta("La fecha \"Desde\" no puede ser posterior a \"Hasta\"."); return; }
    inicio = desde;
    const finFecha = new Date(hasta + "T00:00:00");
    finFecha.setDate(finFecha.getDate() + 1);
    fin = finFecha.toISOString().split("T")[0];
    etiquetaPeriodo = `del ${formatoFecha(desde)} al ${formatoFecha(hasta)}`;
  } else if (tipo === "anio") {
    const inputAnio = document.getElementById("reporte-anio");
    if (!inputAnio.value) inputAnio.value = hoy.substring(0, 4);
    const año = parseInt(inputAnio.value);
    inicio = `${año}-01-01`; fin = `${año + 1}-01-01`;
    etiquetaPeriodo = "el año";
  } else {
    const inputMes = document.getElementById("reporte-mes");
    if (!inputMes.value) inputMes.value = hoy.substring(0, 7);
    const [año, mes] = inputMes.value.split("-").map(Number);
    inicio = inputMes.value + "-01";
    fin = mes === 12 ? `${año + 1}-01-01` : `${año}-${String(mes + 1).padStart(2, "0")}-01`;
    etiquetaPeriodo = "el mes";

    // --- Comparación con el mes anterior ---
    const mesAnteriorFin = inicio;
    const mesAnteriorInicioDate = new Date(año, mes - 2, 1);
    const mesAnteriorInicio = `${mesAnteriorInicioDate.getFullYear()}-${String(mesAnteriorInicioDate.getMonth() + 1).padStart(2, "0")}-01`;

    const { data: pagosMesAnterior } = await supabaseClient
      .from("pagos").select("monto_pagado").gte("fecha_pago", mesAnteriorInicio).lt("fecha_pago", mesAnteriorFin);
    const totalMesAnterior = (pagosMesAnterior || []).reduce((s, p) => s + Number(p.monto_pagado), 0);

    const { data: pagosMesActualPreview } = await supabaseClient
      .from("pagos").select("monto_pagado").gte("fecha_pago", inicio).lt("fecha_pago", fin);
    const totalMesActual = (pagosMesActualPreview || []).reduce((s, p) => s + Number(p.monto_pagado), 0);

    const contenedorComp = document.getElementById("comparacion-mes");
    if (totalMesAnterior > 0) {
      const variacion = ((totalMesActual - totalMesAnterior) / totalMesAnterior) * 100;
      const positivo = variacion >= 0;
      contenedorComp.innerHTML = `
        <span class="${positivo ? "variacion-positiva" : "variacion-negativa"}">
          ${positivo ? "📈" : "📉"} ${positivo ? "+" : ""}${variacion.toFixed(1)}% vs. mes anterior (${formatoPesos(totalMesAnterior)})
        </span>`;
      contenedorComp.classList.remove("oculto");
    }
  }

  const { data: prestamosPeriodo } = await supabaseClient
    .from("prestamos").select("monto_prestado, prestamo_anterior_id, fecha_inicio").gte("fecha_inicio", inicio).lt("fecha_inicio", fin);
  const refinanciados = (prestamosPeriodo || []).filter(p => p.prestamo_anterior_id);
  const totalPrestadoNuevo = await calcularDesembolsoReal(prestamosPeriodo);

  const { data: pagosPeriodo } = await supabaseClient.from("pagos").select("monto_pagado").gte("fecha_pago", inicio).lt("fecha_pago", fin);
  const totalCobrado = pagosPeriodo ? pagosPeriodo.reduce((s, p) => s + Number(p.monto_pagado), 0) : 0;

  const totalGastos = await cargarGastosDelPeriodo(inicio, fin);
  const flujoNeto = totalCobrado - totalGastos;
  const claseFlujo = flujoNeto >= 0 ? "tono-exito" : "tono-peligro";

  // --- GANANCIA: "al estilo libro de William" — la utilidad de un préstamo
  // se cuenta desde que se entrega (interés sobre el monto prestado), no
  // cuando el cliente lo va pagando poco a poco. Así, al cierre de un mes,
  // "Ganancia neta" suma toda la utilidad generada por los préstamos hechos
  // ese mes más la mora aplicada, menos los gastos del mes — la ganancia
  // real de lo que se hizo en el mes, sin mezclarse con el resto de cuentas.
  const gananciaBruta = await calcularUtilidadPorPrestamos(inicio, fin);
  const moraCobrada = await calcularMoraCobrada(inicio, fin);
  const gananciaNeta = (gananciaBruta + moraCobrada) - totalGastos;
  const claseGanancia = gananciaNeta >= 0 ? "tono-exito" : "tono-peligro";

  // --- Resumen: UN solo bloque de tarjetas ---
  // Antes había 2 juegos de tarjetas mostrando casi la misma plata con
  // nombres distintos (estas 7 arriba, y otras 5 más abajo en "Flujo de caja
  // día por día"). Ahora arriba solo quedan las 2 respuestas grandes que
  // importan al abrir Reportes (cuánto se movió en caja y cuánto se ganó de
  // verdad); el detalle día por día — desembolso, cobro, gastos y cierre —
  // vive en un solo lugar: la tabla de "Flujo de caja día por día" de más
  // abajo, que es la que de verdad explica de dónde sale cada peso.
  // Mismo estilo de tarjeta que "Flujo de caja día por día" (sin la variante
  // "grande", que se veía desalineada con montos largos) para que las dos
  // vistas se lean igual de un vistazo.
  // El banner de período es a propósito grande y va primero: es lo que más
  // rápido se confunde (fácil pensar "hoy" cuando en realidad se está viendo
  // el mes completo).
  document.getElementById("resumen-mes").innerHTML = `
    <div class="resumen-banner-periodo">📅 Mostrando: <strong>${etiquetaPeriodo === "el día" ? formatoFecha(inicio) : etiquetaPeriodo}</strong></div>
    <div class="resumen-destacado">
      <div class="resumen-caja ${claseFlujo}"><span class="numero">${flujoNeto >= 0 ? "+" : ""}${formatoPesos(flujoNeto)}</span><span class="etiqueta">Flujo de caja</span><span class="subetiqueta">Cobrado menos gastos en ${etiquetaPeriodo}</span></div>
      <div class="resumen-caja ${claseGanancia}"><span class="numero">${gananciaNeta >= 0 ? "+" : ""}${formatoPesos(gananciaNeta)}</span><span class="etiqueta">Ganancia neta</span><span class="subetiqueta">Utilidad de lo prestado + mora, menos gastos</span></div>
    </div>
    <p class="texto-ayuda">💡 <strong>Flujo de caja</strong> es cuánto efectivo entró y salió (incluye tu propio capital regresando). <strong>Ganancia neta</strong> es la utilidad real de los préstamos entregados en ${etiquetaPeriodo} (interés + mora), sin contar el capital que se presta y regresa. Por eso casi siempre son números distintos.</p>
    <p class="texto-ayuda">👇 El detalle de desembolso, cobro, gastos y cierre día por día está en "Flujo de caja día por día" más abajo.</p>`;

  ultimoReporteExportable = { inicio, fin, etiquetaPeriodo, tipo, esDia: tipo === "dia", totalPrestadoNuevo, totalCobrado, totalGastos, flujoNeto, gananciaBruta, moraCobrada, gananciaNeta, pagosPeriodo: pagosPeriodo || [] };

  await cargarRefinanciamientosPeriodo(refinanciados, inicio, fin);
  await cargarLibroDiario(inicio, fin);
  await cargarDetalleClientesDelDia(inicio, fin, tipo === "dia");
  await verificarRecordatorioRespaldo();
}

// --- LIBRO DIARIO: FECHA | BASE | PRÉSTAMOS | COBRO | GASTO | UTILIDAD | UTILIDAD % | CIERRE ---
// Reconstruye, día por día dentro del período del reporte, el mismo formato
// que ya llevaba el cliente a mano: cuánta caja tenía al empezar el día
// (BASE), cuánto prestó, cuánto cobró, cuánto gastó, cuánto fue GANANCIA real
// (solo intereses + mora aplicada — no el capital que simplemente regresa) y
// con cuánto cerró el día (que es la BASE del día siguiente). "UTILIDAD %"
// se calcula como la utilidad del día sobre lo COBRADO ese día (qué porción
// de lo que entró en efectivo fue ganancia real, no capital recuperado) — es
// la lectura más útil de "porcentaje de ganancia", pero si el negocio prefiere
// verla como % sobre lo PRESTADO o como ganancia acumulada en pesos, es un
// cambio de una sola fórmula aquí abajo.
let ultimoLibroDiario = null;

async function cargarLibroDiario(inicio, fin) {
  const contenedor = document.getElementById("libro-diario");
  const totalesEl = document.getElementById("libro-diario-totales");
  if (!contenedor) return;
  contenedor.innerHTML = '<div class="cargando">⏳ Calculando...</div>';

  const [{ data: caja }, { data: pagos }, { data: gastos }, { data: prestamos }, { data: aportes }, { data: cargosMora }, capitalInicial, utilidadHistoricaPrevia, utilidadHistoricaTotal] = await Promise.all([
    supabaseClient.from("caja_diaria").select("fecha, base_inicial").gte("fecha", inicio).lt("fecha", fin),
    supabaseClient.from("pagos").select("fecha_pago, monto_pagado").gte("fecha_pago", inicio).lt("fecha_pago", fin),
    supabaseClient.from("gastos").select("fecha, monto").gte("fecha", inicio).lt("fecha", fin),
    supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje, prestamo_anterior_id, fecha_inicio").gte("fecha_inicio", inicio).lt("fecha_inicio", fin),
    supabaseClient.from("aportes_capital").select("fecha, monto").gte("fecha", inicio).lt("fecha", fin),
    supabaseClient.from("cargos_mora").select("fecha, monto").gte("fecha", inicio).lt("fecha", fin),
    obtenerCapitalInicial(),
    calcularUtilidadHistoricaAntesDe(inicio),
    calcularUtilidadHistoricaTotal()
  ]);

  const baseGuardada = {};
  (caja || []).forEach(c => baseGuardada[c.fecha] = Number(c.base_inicial));
  const cobroPorDia = {};
  (pagos || []).forEach(p => cobroPorDia[p.fecha_pago] = (cobroPorDia[p.fecha_pago] || 0) + Number(p.monto_pagado));
  // La Utilidad "al estilo libro de William" nace el día que se ENTREGA el
  // préstamo (interés sobre lo prestado), no el día que se cobra — por eso
  // aquí no se usa cobroPorDia para la utilidad, solo para la columna Cobro.
  const utilidadPorDia = {};
  (prestamos || []).forEach(p => {
    const interesDelPrestamo = Number(p.monto_prestado) * (Number(p.interes_porcentaje) || 0) / 100;
    utilidadPorDia[p.fecha_inicio] = (utilidadPorDia[p.fecha_inicio] || 0) + interesDelPrestamo;
  });
  (cargosMora || []).forEach(c => utilidadPorDia[c.fecha] = (utilidadPorDia[c.fecha] || 0) + Number(c.monto));
  const gastoPorDia = {};
  (gastos || []).forEach(g => gastoPorDia[g.fecha] = (gastoPorDia[g.fecha] || 0) + Number(g.monto));
  const aportePorDia = {};
  (aportes || []).forEach(a => aportePorDia[a.fecha] = (aportePorDia[a.fecha] || 0) + Number(a.monto));
  const prestamosPorDia = {};
  (prestamos || []).forEach(p => (prestamosPorDia[p.fecha_inicio] ||= []).push(p));

  // Base del primer día del período: si ese día ya tiene caja_diaria guardada,
  // se usa esa; si no, y el período empieza justo en (o después de) la fecha
  // de la cartera inicial, se usa la cartera inicial como punto de partida.
  let baseCorriente = baseGuardada[inicio] !== undefined
    ? baseGuardada[inicio]
    : (capitalInicial && capitalInicial.fecha <= inicio ? capitalInicial.monto : 0);

  const filas = [];
  let fechaCursor = inicio;
  const totales = { prestado: 0, cobro: 0, gasto: 0, utilidad: 0 };
  // Ojo: esto NO arranca en 0. Arranca en la utilidad histórica de siempre
  // (todo lo generado antes de este período), para que "Utilidad acum." sea
  // de verdad el total acumulado del negocio y no se reinicie cada vez que
  // se cambia el rango de fechas del reporte.
  let utilidadAcumulada = utilidadHistoricaPrevia;

  while (fechaCursor < fin) {
    const base = baseGuardada[fechaCursor] !== undefined ? baseGuardada[fechaCursor] : baseCorriente;
    const prestamosDia = prestamosPorDia[fechaCursor] || [];
    const prestado = await calcularDesembolsoReal(prestamosDia);
    const cobro = cobroPorDia[fechaCursor] || 0;
    const gasto = gastoPorDia[fechaCursor] || 0;
    const aporte = aportePorDia[fechaCursor] || 0;
    const utilidad = utilidadPorDia[fechaCursor] || 0;
    const cierre = base + cobro + aporte - gasto - prestado;
    const utilidadPct = prestado > 0 ? (utilidad / prestado) * 100 : 0;
    utilidadAcumulada += utilidad;

    filas.push({ fecha: fechaCursor, base, prestado, cobro, gasto, utilidad, utilidadPct, utilidadAcumulada, cierre });
    totales.prestado += prestado; totales.cobro += cobro; totales.gasto += gasto; totales.utilidad += utilidad;

    baseCorriente = cierre;
    fechaCursor = sumarDias(fechaCursor, 1);
  }

  ultimoLibroDiario = { inicio, fin, filas };

  if (filas.length === 0) {
    contenedor.innerHTML = '<div class="estado-vacio">No hay días en este período.</div>';
    totalesEl.innerHTML = "";
    return;
  }

  contenedor.innerHTML = `
    <div class="fila-libro-diario fila-libro-diario-cabecera">
      <span>Fecha</span><span>Base</span><span>Préstamos</span><span>Cobro</span><span>Gasto</span><span>Utilidad</span><span>Utilidad acum.</span><span>Utilidad %</span><span>Cierre</span>
    </div>
    ${filas.map(f => `
      <div class="fila-libro-diario">
        <span>${formatoFecha(f.fecha)}</span>
        <span>${formatoPesos(f.base)}</span>
        <span>${f.prestado > 0 ? "-" + formatoPesos(f.prestado) : formatoPesos(0)}</span>
        <span>${formatoPesos(f.cobro)}</span>
        <span>${f.gasto > 0 ? "-" + formatoPesos(f.gasto) : formatoPesos(0)}</span>
        <span class="${f.utilidad >= 0 ? "tono-exito-texto" : "tono-peligro-texto"}">${formatoPesos(f.utilidad)}</span>
        <span class="${f.utilidadAcumulada >= 0 ? "tono-exito-texto" : "tono-peligro-texto"}">${formatoPesos(f.utilidadAcumulada)}</span>
        <span>${f.utilidadPct.toFixed(1)}%</span>
        <span><b>${formatoPesos(f.cierre)}</b></span>
      </div>`).join("")}`;

  const utilidadPctTotal = totales.prestado > 0 ? (totales.utilidad / totales.prestado) * 100 : 0;
  totalesEl.innerHTML = `
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(totales.prestado)}</span><span class="etiqueta">Desembolso nuevo</span><span class="subetiqueta">Préstamos entregados en el período</span></div>
    <div class="resumen-caja tono-exito"><span class="numero">${formatoPesos(totales.cobro)}</span><span class="etiqueta">Cobrado</span></div>
    <div class="resumen-caja tono-peligro"><span class="numero">${formatoPesos(totales.gasto)}</span><span class="etiqueta">Gastos</span></div>
    <div class="resumen-caja ${totales.utilidad >= 0 ? "tono-exito" : "tono-peligro"}"><span class="numero">${formatoPesos(totales.utilidad)}</span><span class="etiqueta">Utilidad del período</span><span class="subetiqueta">${utilidadPctTotal.toFixed(1)}% de lo prestado</span></div>
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(filas[filas.length - 1].cierre)}</span><span class="etiqueta">Cierre del período</span><span class="subetiqueta">Flujo de caja al final de ${formatoFecha(filas[filas.length - 1].fecha)}</span></div>
    <div class="resumen-caja tono-exito"><span class="numero">${formatoPesos(utilidadHistoricaTotal)}</span><span class="etiqueta">💰 Utilidad total acumulada</span><span class="subetiqueta">De todos los préstamos hechos desde siempre — de aquí saca el dueño las ganancias, no de la caja</span></div>`;
}

// --- CLIENTES DEL DÍA (solo para el reporte tipo "día") ---
// Lista a TODOS los clientes con crédito activo ese día — no solo a los que
// ya se cobraron. Por cada uno muestra cuánto cobró hoy, cuánto lleva pagado
// en total, cuánto le falta, y su estado: pagó / parcial / no pagó (si ya
// hay un registro de pago ese día) o "Pendiente" (si todavía no se ha
// pasado por él). Mismos colores que ya usa la pantalla de "Cobrar"
// (verde/amarillo/rojo) más gris para "pendiente", para que se lea igual de
// rápido. Solo tiene sentido para UN día puntual — en semana/mes/año/rango
// se vería una lista enorme mezclando muchos días, así que ahí se oculta y
// basta con el Libro diario de más abajo.
// OJO: "Le falta" usa la mora ACTUAL del crédito (no una foto histórica de
// cómo estaba la mora justo ese día), porque es el dato que de verdad importa
// al revisar el reporte: cuánto falta HOY, no cuánto faltaba en ese momento.
async function cargarDetalleClientesDelDia(inicio, fin, esReporteDeUnDia) {
  const envoltura = document.getElementById("detalle-clientes-dia-envoltura");
  const contenedor = document.getElementById("detalle-clientes-dia");
  if (!envoltura || !contenedor) return;

  if (!esReporteDeUnDia) { envoltura.classList.add("oculto"); contenedor.innerHTML = ""; return; }
  envoltura.classList.remove("oculto");
  // Se deja plegado por defecto cada vez que se carga un reporte de un día
  // (antes se mostraba siempre abierto, ocupando la pantalla apenas se
  // entraba a Reportes). El botón de arriba lo despliega con un clic.
  contenedor.classList.add("oculto");
  const botonToggle = envoltura.querySelector(".btn-ver-mas-inicio");
  if (botonToggle) botonToggle.textContent = "👥 Ver clientes del día";
  contenedor.innerHTML = '<div class="cargando">⏳ Cargando clientes del día...</div>';

  const { data: prestamosActivos, error } = await supabaseClient
    .from("prestamos")
    .select("id, monto_prestado, interes_porcentaje, mora_acumulada, cuota, clientes(id, nombre)")
    .eq("estado", "activo");
  if (error) { contenedor.innerHTML = '<p class="texto-ayuda">No fue posible cargar el detalle de clientes de este día.</p>'; return; }

  if (!prestamosActivos || prestamosActivos.length === 0) {
    contenedor.innerHTML = '<div class="estado-vacio">No tienes créditos activos.</div>';
    return;
  }

  const idsPrestamos = prestamosActivos.map(p => p.id);

  // Pago (si existe) registrado justo ese día, y cuánto llevaba pagado cada
  // crédito HASTA (e incluyendo) ese día — para "lleva pagado" y "faltante"
  // tal como quedaron al cierre de esa fecha, no el acumulado de hoy si se
  // está viendo un día pasado. También la mora aplicada justo ese día, para
  // poder calcular la utilidad real del cobro de cada cliente (igual que en
  // el Libro diario: interés + mora, sin contar el capital que vuelve).
  const [{ data: pagosDia }, { data: pagosHastaEseDia }, { data: cargosMoraDia }] = await Promise.all([
    supabaseClient.from("pagos").select("id, monto_pagado, estado, prestamo_id").in("prestamo_id", idsPrestamos).gte("fecha_pago", inicio).lt("fecha_pago", fin),
    supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", idsPrestamos).lt("fecha_pago", fin),
    supabaseClient.from("cargos_mora").select("prestamo_id, monto").in("prestamo_id", idsPrestamos).gte("fecha", inicio).lt("fecha", fin)
  ]);

  const pagoDiaPorPrestamo = {};
  (pagosDia || []).forEach(pg => { pagoDiaPorPrestamo[pg.prestamo_id] = pg; });
  const pagadoAcumulado = {};
  (pagosHastaEseDia || []).forEach(pg => pagadoAcumulado[pg.prestamo_id] = (pagadoAcumulado[pg.prestamo_id] || 0) + Number(pg.monto_pagado));
  const moraDiaPorPrestamo = {};
  (cargosMoraDia || []).forEach(c => moraDiaPorPrestamo[c.prestamo_id] = (moraDiaPorPrestamo[c.prestamo_id] || 0) + Number(c.monto));

  const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌", pendiente: "Pendiente ⏳" };
  // Mismos colores que ya usa la pantalla de Cobrar: verde = al día, amarillo
  // = parcial, rojo = no pagó, gris = todavía no se pasa por él — para que el
  // ojo no tenga que aprender un código de colores nuevo.
  const clases = { pago: "estado-al-dia", parcial: "estado-atencion", no_pago: "estado-mora", pendiente: "estado-pendiente" };
  // Los que pagaron van arriba, y al final los que no han pagado — para que
  // lo primero que se vea sea lo que ya está resuelto, y lo pendiente por
  // resolver quede abajo, fácil de ubicar.
  const orden = { pago: 0, parcial: 1, pendiente: 2, no_pago: 3 };

  const filas = prestamosActivos.map(prestamo => {
    const pagoDia = pagoDiaPorPrestamo[prestamo.id];
    const estado = pagoDia ? pagoDia.estado : "pendiente";
    const totalPagado = pagadoAcumulado[prestamo.id] || 0;
    const saldoPendiente = calcularSaldoPendiente(prestamo, totalPagado);
    const cobradoHoy = pagoDia ? Number(pagoDia.monto_pagado) : 0;
    // Utilidad real del cobro de HOY para este cliente: solo la fracción de
    // interés de lo cobrado (el resto es capital propio que vuelve, no es
    // ganancia) más la mora que se le haya aplicado justo este día.
    const interes = Number(prestamo.interes_porcentaje) || 0;
    const fraccionInteres = interes / (100 + interes);
    const utilidadHoy = cobradoHoy * fraccionInteres + (moraDiaPorPrestamo[prestamo.id] || 0);
    return {
      nombre: prestamo.clientes?.nombre || "Cliente eliminado",
      clienteId: prestamo.clientes?.id,
      estado, cobradoHoy, utilidadHoy,
      totalPagado, saldoPendiente
    };
  });

  const filasOrdenadas = filas.sort((a, b) => (orden[a.estado] ?? 4) - (orden[b.estado] ?? 4));
  let cantidadPago = 0, cantidadParcial = 0, cantidadNoPago = 0, cantidadPendiente = 0;
  let totalCobradoHoy = 0, totalUtilidadHoy = 0, totalFaltante = 0;

  const filasHtml = filasOrdenadas.map(f => {
    if (f.estado === "pago") cantidadPago++;
    else if (f.estado === "parcial") cantidadParcial++;
    else if (f.estado === "no_pago") cantidadNoPago++;
    else cantidadPendiente++;
    totalCobradoHoy += f.cobradoHoy; totalUtilidadHoy += f.utilidadHoy; totalFaltante += f.saldoPendiente;

    return `
      <div class="subtarjeta fila-cliente-dia ${clases[f.estado] || ""}" ${f.clienteId ? `onclick="abrirDetalleCliente(${f.clienteId})"` : ""}>
        <div class="fila-resumen-credito">
          <span class="nombre-cliente-dia">${escaparHtml(f.nombre)}</span>
          <span class="badge-estado">${etiquetas[f.estado] || escaparHtml(f.estado)}</span>
        </div>
        <div class="fila-cliente-dia-datos">
          <span>Cobrado hoy <b>${formatoPesos(f.cobradoHoy)}</b></span>
          <span>Utilidad del cobro <b class="${f.utilidadHoy >= 0 ? "tono-exito-texto" : "tono-peligro-texto"}">${formatoPesos(f.utilidadHoy)}</b></span>
          <span>Lleva pagado <b>${formatoPesos(f.totalPagado)}</b></span>
          <span>Faltante <b>${formatoPesos(f.saldoPendiente)}</b></span>
        </div>
      </div>`;
  }).join("");

  contenedor.innerHTML = `
    <div class="resumen-clientes-dia">
      <span class="tono-exito-texto">✅ ${cantidadPago} pagaron</span>
      <span class="tono-advertencia-texto">⚠️ ${cantidadParcial} parcial</span>
      <span class="tono-peligro-texto">❌ ${cantidadNoPago} no pagaron</span>
      <span class="tono-pendiente-texto">⏳ ${cantidadPendiente} pendientes</span>
    </div>
    ${filasHtml}
    <div class="subtarjeta fila-cliente-dia fila-cliente-dia-total">
      <div class="fila-resumen-credito"><span class="nombre-cliente-dia">Total (${filasOrdenadas.length} cliente${filasOrdenadas.length === 1 ? "" : "s"})</span></div>
      <div class="fila-cliente-dia-datos">
        <span>Cobrado hoy <b>${formatoPesos(totalCobradoHoy)}</b></span>
        <span>Utilidad del cobro <b class="${totalUtilidadHoy >= 0 ? "tono-exito-texto" : "tono-peligro-texto"}">${formatoPesos(totalUtilidadHoy)}</b></span>
        <span>Faltante <b>${formatoPesos(totalFaltante)}</b></span>
      </div>
    </div>`;
}

// Mora que se aplicó de verdad al saldo (no el estimado en pantalla) dentro del período.
async function calcularMoraCobrada(inicio, fin) {
  const { data, error } = await supabaseClient
    .from("cargos_mora").select("monto").gte("fecha", inicio).lt("fecha", fin);
  if (error || !data) return 0; // si la migración 20260720 aún no está instalada, no rompe el reporte
  return data.reduce((s, c) => s + Number(c.monto), 0);
}

// --- EXPORTAR REPORTE A CSV ---
let ultimoReporteExportable = null;

function exportarReporteCSV() {
  if (!ultimoReporteExportable) { mostrarAlerta("Espera a que cargue el reporte antes de exportar."); return; }
  const r = ultimoReporteExportable;
  const filas = [
    ["Reporte", r.etiquetaPeriodo],
    ["Desde", formatoFecha(r.inicio)], ["Hasta", formatoFecha(sumarDias(r.fin, -1))],
    ["Desembolso nuevo", r.totalPrestadoNuevo], ["Cobrado", r.totalCobrado],
    ["Gastos", r.totalGastos], ["Flujo de caja", r.flujoNeto],
    ["Utilidad de préstamos entregados", r.gananciaBruta], ["Mora cobrada", r.moraCobrada],
    ["Ganancia neta", r.gananciaNeta], [],
    ["Flujo de caja día por día"],
    ["Fecha", "Base", "Préstamos", "Cobro", "Gasto", "Utilidad", "Utilidad acumulada", "Utilidad %", "Cierre"],
    ...(ultimoLibroDiario?.filas || []).map(f => [formatoFecha(f.fecha), f.base, f.prestado, f.cobro, f.gasto, f.utilidad.toFixed(0), f.utilidadAcumulada.toFixed(0), f.utilidadPct.toFixed(1), f.cierre]),
    [], ["Detalle de pagos del período"],
    ["Monto pagado"], ...r.pagosPeriodo.map(p => [p.monto_pagado])
  ];
  const csv = filas.map(fila => fila.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = `reporte-${r.inicio}-a-${r.fin}.csv`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

// --- UTILIDAD "AL ESTILO LIBRO DE WILLIAM" ---
// A diferencia de contar la ganancia solo cuando el cliente COBRA (poco a
// poco en cada cuota), esta utilidad se cuenta desde el día en que se
// ENTREGA el préstamo: si hoy prestas $100 con 20% de interés, la utilidad
// de hoy es $20 — completa, ese mismo día — sin importar cuándo el cliente
// termine de pagar. Es la forma en que ya se llevaba a mano: cada préstamo
// nuevo suma su interés al total de utilidad del negocio, sin mezclarse con
// el resto de las cuentas (caja, gastos del día a día, etc.) hasta el
// cierre de mes. La usan tanto Reportes (Libro diario) como la tarjeta de
// Utilidad diaria/semanal/mensual de Inicio (ver ganancia.js).
async function calcularUtilidadPorPrestamos(inicio, fin) {
  const { data, error } = await supabaseClient
    .from("prestamos").select("monto_prestado, interes_porcentaje").gte("fecha_inicio", inicio).lt("fecha_inicio", fin);
  if (error || !data) return 0;
  return data.reduce((total, p) => total + Number(p.monto_prestado) * (Number(p.interes_porcentaje) || 0) / 100, 0);
}

// Utilidad total acumulada de TODA la vida del negocio (préstamos entregados
// desde siempre + toda la mora aplicada desde siempre), sin límite de
// fechas — es el número que va subiendo solo, présta a préstamo, y del que
// el dueño saca sus ganancias. No se resetea nunca y no tiene nada que ver
// con cuánto efectivo hay hoy en caja.
async function calcularUtilidadHistoricaTotal() {
  const [{ data: prestamos }, { data: cargosMora }] = await Promise.all([
    supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje"),
    supabaseClient.from("cargos_mora").select("monto")
  ]);
  const utilidadPrestamos = (prestamos || []).reduce((s, p) => s + Number(p.monto_prestado) * (Number(p.interes_porcentaje) || 0) / 100, 0);
  const utilidadMora = (cargosMora || []).reduce((s, c) => s + Number(c.monto), 0);
  return utilidadPrestamos + utilidadMora;
}

// La misma utilidad histórica, pero solo la parte generada ANTES de una
// fecha dada — se usa como punto de partida del acumulado del Libro diario,
// para que "Utilidad acum." sea de verdad el total de siempre y no solo lo
// que se ve dentro del período que se está mirando en pantalla.
async function calcularUtilidadHistoricaAntesDe(fecha) {
  const [{ data: prestamos }, { data: cargosMora }] = await Promise.all([
    supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje").lt("fecha_inicio", fecha),
    supabaseClient.from("cargos_mora").select("monto").lt("fecha", fecha)
  ]);
  const utilidadPrestamos = (prestamos || []).reduce((s, p) => s + Number(p.monto_prestado) * (Number(p.interes_porcentaje) || 0) / 100, 0);
  const utilidadMora = (cargosMora || []).reduce((s, c) => s + Number(c.monto), 0);
  return utilidadPrestamos + utilidadMora;
}

// --- REFINANCIAMIENTOS: separa cuánto es saldo renovado y cuánto es plata adicional nueva ---
async function cargarRefinanciamientosPeriodo(refinanciados, inicio, fin) {
  const contenedor = document.getElementById("bloque-refinanciamientos");
  if (!refinanciados || refinanciados.length === 0) { contenedor.classList.add("oculto"); return; }

  const { data: filas, error } = await supabaseClient
    .from("prestamos")
    .select("id, monto_prestado, fecha_inicio, prestamo_anterior_id, clientes(nombre)")
    .not("prestamo_anterior_id", "is", null)
    .gte("fecha_inicio", inicio).lt("fecha_inicio", fin);
  if (error || !filas || filas.length === 0) { contenedor.classList.add("oculto"); return; }

  let totalRenovado = 0;
  const detalle = [];
  for (const nuevo of filas) {
    const { data: viejo } = await supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje, mora_acumulada").eq("id", nuevo.prestamo_anterior_id).single();
    if (!viejo) continue;
    const { data: pagosViejo } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", nuevo.prestamo_anterior_id).lte("fecha_pago", nuevo.fecha_inicio);
    const pagadoViejo = (pagosViejo || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
    const saldoViejo = calcularSaldoPendiente(viejo, pagadoViejo);
    totalRenovado += saldoViejo;
    detalle.push({ nombre: nuevo.clientes?.nombre || "Cliente", saldoViejo, montoNuevo: Number(nuevo.monto_prestado) });
  }

  contenedor.classList.remove("oculto");
  contenedor.innerHTML = `
    <h4>🔄 Refinanciamientos de este período (${filas.length})</h4>
    <div class="resumen-dia" style="margin-bottom:10px;">
      <div class="resumen-caja tono-advertencia"><span class="numero">${formatoPesos(totalRenovado)}</span><span class="etiqueta">Saldo renovado</span><span class="subetiqueta">No es plata nueva en la calle</span></div>
    </div>
    ${detalle.map(d => `
      <div class="fila-refinanciamiento">
        <span>${escaparHtml(d.nombre)}</span>
        <span class="badge-refinanciado">${formatoPesos(d.saldoViejo)} → ${formatoPesos(d.montoNuevo)}</span>
      </div>`).join("")}`;
}


document.getElementById("reporte-fecha-dia").addEventListener("change", cargarReporteMes);
document.getElementById("reporte-mes").addEventListener("change", cargarReporteMes);
document.getElementById("reporte-anio").addEventListener("change", cargarReporteMes);
document.getElementById("reporte-rango-desde").addEventListener("change", cargarReporteMes);
document.getElementById("reporte-rango-hasta").addEventListener("change", cargarReporteMes);

// --- EXPORTAR A EXCEL (.xlsx con estilo: encabezados de color, bordes, franjas alternadas) ---
// Se usa xlsx-js-style (mismo API que SheetJS, con soporte de colores/bordes) solo
// cuando el usuario toca el botón, para no afectar el peso normal de la app.
function cargarLibreriaExcel() {
  return new Promise((resolve, reject) => {
    if (window.XLSX && window.XLSX.__conEstilo) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js";
    script.onload = () => { if (window.XLSX) window.XLSX.__conEstilo = true; resolve(); };
    script.onerror = () => reject(new Error("No fue posible descargar el generador de Excel. Revisa tu conexión e intenta de nuevo."));
    document.head.appendChild(script);
  });
}

const BORDE_FINO_EXCEL = {
  top: { style: "thin", color: { rgb: "DDDDDD" } }, bottom: { style: "thin", color: { rgb: "DDDDDD" } },
  left: { style: "thin", color: { rgb: "DDDDDD" } }, right: { style: "thin", color: { rgb: "DDDDDD" } }
};

// columnas: [{ header, key, tipo: "texto" | "moneda" | "porcentaje" | "entero", ancho }]
// colorPorFila (opcional): function(fila) => "RRGGBB" | null, para pintar una
// fila completa (ej. verde/amarillo/rojo según si el cliente pagó, quedó
// parcial o no pagó ese día). Si devuelve null, se usa la franja alternada normal.
// titulo (opcional): texto que va en una fila propia arriba del encabezado,
// fusionada a lo ancho de toda la tabla (ej. "Clientes del día — 22/07/2026"),
// para que la hoja se identifique de un vistazo al abrirla en Excel.
function construirHojaEstilizada(filas, columnas, colorHex, colorPorFila, titulo) {
  const filaEncabezado = titulo ? 1 : 0;

  const encabezado = columnas.map(c => ({
    v: c.header, t: "s",
    s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: colorHex } }, alignment: { horizontal: "center", vertical: "center" }, border: BORDE_FINO_EXCEL }
  }));

  const filasCuerpo = filas.map((fila, i) => columnas.map(c => {
    const valor = fila[c.key];
    const esNumero = c.tipo === "moneda" || c.tipo === "porcentaje" || c.tipo === "entero";
    const estilo = { border: BORDE_FINO_EXCEL, alignment: { horizontal: esNumero ? "right" : "left", vertical: "center" } };
    const colorFila = colorPorFila ? colorPorFila(fila) : null;
    if (colorFila) estilo.fill = { fgColor: { rgb: colorFila } };
    else if (i % 2 === 1) estilo.fill = { fgColor: { rgb: "F4F5FB" } };
    if (fila._negrita) estilo.font = { bold: true };
    if (c.tipo === "moneda") estilo.numFmt = '"$"#,##0';
    if (c.tipo === "porcentaje") estilo.numFmt = '0.00"%"';
    return { v: esNumero ? Number(valor) || 0 : (valor ?? ""), t: esNumero ? "n" : "s", s: estilo };
  }));

  const filaTitulo = titulo ? [{
    v: titulo, t: "s",
    s: { font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: colorHex } }, alignment: { horizontal: "center", vertical: "center" } }
  }, ...Array(columnas.length - 1).fill(null).map(() => ({ v: "", t: "s", s: { fill: { fgColor: { rgb: colorHex } } } }))] : null;

  const ws = XLSX.utils.aoa_to_sheet(filaTitulo ? [filaTitulo, encabezado, ...filasCuerpo] : [encabezado, ...filasCuerpo]);
  ws["!cols"] = columnas.map(c => ({ wch: c.ancho || 18 }));
  if (filaTitulo) {
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columnas.length - 1 } }];
    ws["!rows"] = [{ hpt: 24 }];
  }
  // Encabezado (y título, si hay) siempre visibles al desplazarse hacia abajo.
  ws["!freeze"] = { xSplit: 0, ySplit: filaEncabezado + 1 };
  if (filasCuerpo.length > 0) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: filaEncabezado, c: 0 }, e: { r: filaEncabezado + filasCuerpo.length, c: columnas.length - 1 } }) };
  }
  return ws;
}

async function exportarExcel(evento) {
  if (!ultimoReporteExportable) { mostrarAlerta("Espera a que cargue el reporte antes de exportar."); return; }
  const { inicio, fin, esDia } = ultimoReporteExportable;

  const boton = evento?.currentTarget;
  const textoOriginal = boton ? boton.innerHTML : "";
  if (boton) { boton.disabled = true; boton.innerHTML = "⏳ Generando Excel..."; }

  try {
    await cargarLibreriaExcel();

    // Clientes: lista completa (nombre, teléfono, dirección, ruta) porque es
    // información de referencia, no un movimiento del día. Préstamos, Pagos
    // y Gastos sí se filtran al período que está abierto en Reportes, para
    // que el Excel muestre SOLO el día (o rango) que se está descargando.
    const [clientes, prestamos, pagos, gastos, pagosDia] = await Promise.all([
      supabaseClient.from("clientes").select("id, nombre, telefono, direccion, archivado, rutas(nombre)").order("nombre"),
      supabaseClient.from("prestamos").select("id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, prestamo_anterior_id, clientes(nombre)").gte("fecha_inicio", inicio).lt("fecha_inicio", fin).order("fecha_inicio", { ascending: false }),
      supabaseClient.from("pagos").select("fecha_pago, monto_pagado, estado, prestamos(interes_porcentaje, clientes(nombre))").gte("fecha_pago", inicio).lt("fecha_pago", fin).order("fecha_pago", { ascending: false }),
      supabaseClient.from("gastos").select("fecha, concepto, monto").gte("fecha", inicio).lt("fecha", fin).order("fecha", { ascending: false }),
      esDia
        ? supabaseClient.from("pagos").select("monto_pagado, estado, prestamo_id, prestamos(monto_prestado, interes_porcentaje, mora_acumulada, cuota, clientes(nombre))").gte("fecha_pago", inicio).lt("fecha_pago", fin)
        : Promise.resolve({ data: [] })
    ]);
    const conError = [clientes, prestamos, pagos, gastos, pagosDia].find(r => r.error);
    if (conError) { mostrarAlerta("No fue posible exportar a Excel: " + traducirErrorSupabase(conError.error)); return; }
    await calcularRiesgoTodosClientes();

    // --- "Clientes del día": mismo detalle cliente por cliente que ya se ve
    // en Reportes al elegir "día" (cobrado hoy, lleva pagado, le falta, y si
    // pagó/parcial/no pagó) — para verificar rápido, con color por estado.
    let filasClientesDia = [];
    if (esDia && pagosDia.data && pagosDia.data.length) {
      const idsPrestamos = [...new Set(pagosDia.data.map(p => p.prestamo_id))];
      const { data: pagosHastaEseDia } = await supabaseClient
        .from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", idsPrestamos).lt("fecha_pago", fin);
      const pagadoAcumulado = {};
      (pagosHastaEseDia || []).forEach(pg => pagadoAcumulado[pg.prestamo_id] = (pagadoAcumulado[pg.prestamo_id] || 0) + Number(pg.monto_pagado));
      const etiquetasEstadoDia = { pago: "Pagó", parcial: "Parcial", no_pago: "No pagó" };
      const ordenEstado = { no_pago: 0, parcial: 1, pago: 2 };
      filasClientesDia = [...pagosDia.data]
        .sort((a, b) => (ordenEstado[a.estado] ?? 3) - (ordenEstado[b.estado] ?? 3))
        .map(pg => {
          const prestamo = pg.prestamos;
          const totalPagado = pagadoAcumulado[pg.prestamo_id] || 0;
          const saldoPendiente = prestamo ? calcularSaldoPendiente(prestamo, totalPagado) : 0;
          return {
            cliente: prestamo?.clientes?.nombre || "Cliente eliminado",
            estado: etiquetasEstadoDia[pg.estado] || pg.estado,
            cobradoHoy: pg.monto_pagado, llevaPagado: totalPagado, leFalta: saldoPendiente,
            _estadoRaw: pg.estado
          };
        });
    }

    const etiquetasEstado = { pago: "Pagó", parcial: "Parcial", no_pago: "No pagó" };
    const etiquetasRiesgo = { bueno: "Bueno", regular: "Regular", riesgoso: "Riesgoso" };
    const libro = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (clientes.data || []).map(c => ({
        nombre: c.nombre, telefono: c.telefono || "", direccion: c.direccion || "",
        ruta: c.rutas?.nombre || "sin ruta", riesgo: etiquetasRiesgo[obtenerRiesgoCliente(c.id)] || "Bueno", archivado: c.archivado ? "Sí" : "No"
      })),
      [{ header: "Nombre", key: "nombre", ancho: 24 }, { header: "Teléfono", key: "telefono", ancho: 16 },
       { header: "Dirección", key: "direccion", ancho: 28 }, { header: "Ruta", key: "ruta", ancho: 18 },
       { header: "Riesgo", key: "riesgo", ancho: 12 }, { header: "Archivado", key: "archivado", ancho: 12 }],
      "4056D6"
    ), "Clientes");

    if (filasClientesDia.length > 0) {
      const coloresEstadoDia = { pago: "DCFCE7", parcial: "FEF9C3", no_pago: "FEE2E2" };
      XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
        filasClientesDia,
        [{ header: "Cliente", key: "cliente", ancho: 24 }, { header: "Estado", key: "estado", ancho: 12 },
         { header: "Cobrado hoy", key: "cobradoHoy", tipo: "moneda", ancho: 16 },
         { header: "Lleva pagado", key: "llevaPagado", tipo: "moneda", ancho: 16 },
         { header: "Le falta", key: "leFalta", tipo: "moneda", ancho: 16 }],
        "0D9488",
        (fila) => coloresEstadoDia[fila._estadoRaw] || null
      ), "Clientes del día");
    }

    // "Refinanciamiento": deja claro que ese "Monto prestado" no salió todo en
    // efectivo — una parte (o todo) es saldo del crédito anterior que se renovó.
    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (prestamos.data || []).map(p => ({
        cliente: p.clientes?.nombre || "", monto: p.monto_prestado, interes: p.interes_porcentaje, cuota: p.cuota,
        cuotas: p.numero_cuotas, frecuencia: p.frecuencia, fecha: p.fecha_inicio, estado: p.estado,
        refinanciamiento: p.prestamo_anterior_id ? "Sí" : "No"
      })),
      [{ header: "Cliente", key: "cliente", ancho: 24 }, { header: "Monto prestado", key: "monto", tipo: "moneda", ancho: 16 },
       { header: "Interés %", key: "interes", tipo: "porcentaje", ancho: 12 }, { header: "Cuota", key: "cuota", tipo: "moneda", ancho: 14 },
       { header: "Cuotas", key: "cuotas", tipo: "entero", ancho: 10 }, { header: "Frecuencia", key: "frecuencia", ancho: 12 },
       { header: "Fecha inicio", key: "fecha", ancho: 14 }, { header: "Estado", key: "estado", ancho: 14 },
       { header: "¿Es refinanciamiento?", key: "refinanciamiento", ancho: 18 }],
      "8B5CF6"
    ), "Préstamos");

    // Columna "Ganancia": la porción de cada abono que es interés real (el resto
    // es capital propio que regresa). Fracción = interés% / (100 + interés%).
    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (pagos.data || []).map(p => {
        const interes = Number(p.prestamos?.interes_porcentaje) || 0;
        const ganancia = Number(p.monto_pagado) * (interes / (100 + interes));
        return { fecha: p.fecha_pago, cliente: p.prestamos?.clientes?.nombre || "", estado: etiquetasEstado[p.estado] || p.estado, monto: p.monto_pagado, ganancia };
      }),
      [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Cliente", key: "cliente", ancho: 24 },
       { header: "Estado", key: "estado", ancho: 14 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 16 },
       { header: "Ganancia (solo interés)", key: "ganancia", tipo: "moneda", ancho: 20 }],
      "16A36F"
    ), "Pagos");

    // Hoja dedicada a refinanciamientos: cuánto era saldo trasladado (no es
    // plata nueva) vs. cuánto adicional se entregó realmente en efectivo.
    const refinanciamientosDetalle = [];
    for (const nuevo of (prestamos.data || []).filter(p => p.prestamo_anterior_id)) {
      const viejo = (prestamos.data || []).find(p => p.id === nuevo.prestamo_anterior_id);
      const montoViejo = viejo ? Number(viejo.monto_prestado) : 0;
      const interesViejo = viejo ? Number(viejo.interes_porcentaje) : 0;
      const { data: pagosViejo } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", nuevo.prestamo_anterior_id).lte("fecha_pago", nuevo.fecha_inicio);
      const pagadoViejo = (pagosViejo || []).reduce((s, pg) => s + Number(pg.monto_pagado), 0);
      const saldoRenovado = Math.max(montoViejo * (1 + interesViejo / 100) - pagadoViejo, 0);
      const dineroAdicional = Math.max(Number(nuevo.monto_prestado) - saldoRenovado, 0);
      refinanciamientosDetalle.push({
        cliente: nuevo.clientes?.nombre || "", fecha: nuevo.fecha_inicio,
        saldoRenovado, montoNuevoTotal: nuevo.monto_prestado, dineroAdicional
      });
    }
    if (refinanciamientosDetalle.length > 0) {
      XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
        refinanciamientosDetalle,
        [{ header: "Cliente", key: "cliente", ancho: 24 }, { header: "Fecha", key: "fecha", ancho: 14 },
         { header: "Saldo renovado (no es plata nueva)", key: "saldoRenovado", tipo: "moneda", ancho: 24 },
         { header: "Monto nuevo total", key: "montoNuevoTotal", tipo: "moneda", ancho: 18 },
         { header: "Dinero adicional entregado", key: "dineroAdicional", tipo: "moneda", ancho: 22 }],
        "F97316"
      ), "Refinanciamientos");
    }

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (gastos.data || []).map(g => ({ fecha: g.fecha, concepto: g.concepto, monto: g.monto })),
      [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Concepto", key: "concepto", ancho: 28 },
       { header: "Monto", key: "monto", tipo: "moneda", ancho: 16 }],
      "E11D48"
    ), "Gastos");

    // Hoja "Libro diario": el mismo desglose día por día que se ve en
    // Reportes (fecha, prestado, utilidad, cobro, gasto y base/cierre de
    // caja), en el período que estaba abierto en Reportes al exportar.
    if (ultimoLibroDiario && ultimoLibroDiario.filas.length) {
      XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
        ultimoLibroDiario.filas.map(f => ({
          fecha: formatoFecha(f.fecha), prestamos: f.prestado, utilidad: f.utilidad, utilidadAcumulada: f.utilidadAcumulada,
          utilidadPct: f.utilidadPct, cobro: f.cobro, gasto: f.gasto, base: f.base, cierre: f.cierre
        })),
        [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Préstamos", key: "prestamos", tipo: "moneda", ancho: 16 },
         { header: "Utilidad", key: "utilidad", tipo: "moneda", ancho: 16 }, { header: "Utilidad acumulada", key: "utilidadAcumulada", tipo: "moneda", ancho: 18 },
         { header: "Utilidad %", key: "utilidadPct", tipo: "porcentaje", ancho: 14 },
         { header: "Cobro", key: "cobro", tipo: "moneda", ancho: 16 }, { header: "Gasto", key: "gasto", tipo: "moneda", ancho: 16 },
         { header: "Base", key: "base", tipo: "moneda", ancho: 16 }, { header: "Cierre (flujo de caja)", key: "cierre", tipo: "moneda", ancho: 20 }],
        "0EA5E9"
      ), "Libro diario");
    }

    // --- Hoja "Resumen": totales del período exportado (mismos totales que
    // se ven arriba en Reportes), con la ganancia neta real (solo intereses
    // cobrados + mora, menos gastos operativos).
    const totalCobradoPeriodo = (pagos.data || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
    const totalGastosPeriodo = (gastos.data || []).reduce((s, g) => s + Number(g.monto), 0);
    const gananciaBrutaPeriodo = ultimoReporteExportable.gananciaBruta || 0;
    const totalDesembolsadoPeriodo = await calcularDesembolsoReal((prestamos.data || []).map(p => ({ monto_prestado: p.monto_prestado, prestamo_anterior_id: p.prestamo_anterior_id, fecha_inicio: p.fecha_inicio })));
    const totalSaldoRenovadoPeriodo = refinanciamientosDetalle.reduce((s, r) => s + r.saldoRenovado, 0);
    const moraCobradaPeriodo = ultimoReporteExportable.moraCobrada || 0;

    const filasResumen = [
      { concepto: "Total desembolsado en efectivo (sin contar saldos renovados)", monto: totalDesembolsadoPeriodo },
      { concepto: "Total cobrado (capital + interés)", monto: totalCobradoPeriodo },
      { concepto: "Utilidad de préstamos entregados (ganancia real)", monto: gananciaBrutaPeriodo },
      { concepto: "Mora cobrada", monto: moraCobradaPeriodo },
      { concepto: "Gastos operativos", monto: totalGastosPeriodo },
      { concepto: "Ganancia neta (utilidad + mora - gastos)", monto: (gananciaBrutaPeriodo + moraCobradaPeriodo) - totalGastosPeriodo },
      { concepto: "Saldo renovado en refinanciamientos (no es plata nueva)", monto: totalSaldoRenovadoPeriodo }
    ];
    const hojaResumen = construirHojaEstilizada(
      filasResumen,
      [{ header: `Concepto (${ultimoReporteExportable.etiquetaPeriodo})`, key: "concepto", ancho: 50 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 20 }],
      "252F86"
    );
    XLSX.utils.book_append_sheet(libro, hojaResumen, "Resumen");
    // Se reordena para que "Resumen" quede como primera hoja al abrir el archivo.
    libro.SheetNames.unshift(libro.SheetNames.pop());

    // Nombre del archivo con la fecha real del período exportado (no siempre
    // la fecha de hoy), para que quede claro qué día(s) trae ese Excel.
    const ultimoDiaIncluido = sumarDias(fin, -1);
    const sufijoFecha = inicio === ultimoDiaIncluido ? inicio : `${inicio}_a_${ultimoDiaIncluido}`;
    XLSX.writeFile(libro, `cobros-excel-${sufijoFecha}.xlsx`);
  } catch (error) {
    mostrarAlerta(error ? traducirErrorSupabase(error) : "No fue posible generar el Excel.");
  } finally {
    if (boton) { boton.disabled = false; boton.innerHTML = textoOriginal; }
  }
}

// --- 3 EXPORTACIONES SIMPLES, CADA UNA POR SU LADO ---
// En vez de un solo Excel con 8 hojas mezclando todo, estas 3 bajan SOLO lo
// que se pide: el histórico completo, el día puntual, o el período que se
// esté viendo en Reportes (semana/mes/año/rango). El botón "Exportar todo"
// de más abajo se deja aparte para quien de verdad necesite el detalle
// completo con fines contables.

async function ejecutarExportacionExcel(boton, funcion) {
  const textoOriginal = boton ? boton.innerHTML : "";
  if (boton) { boton.disabled = true; boton.innerHTML = "⏳ Generando..."; }
  try {
    await cargarLibreriaExcel();
    await funcion();
  } catch (error) {
    mostrarAlerta(error ? traducirErrorSupabase(error) : "No fue posible generar el Excel.");
  } finally {
    if (boton) { boton.disabled = false; boton.innerHTML = textoOriginal; }
  }
}

// 1) RESUMEN GENERAL: acumulado desde que inició la cartera hasta hoy — para
// ver "cómo va todo" de un vistazo, sin importar qué período esté abierto en
// Reportes arriba.
async function exportarResumenGeneralExcel(evento) {
  await ejecutarExportacionExcel(evento?.currentTarget, async () => {
    const [{ data: pagos }, { data: gastos }, { data: prestamos }, { data: cargosMora }, capitalInicial] = await Promise.all([
      supabaseClient.from("pagos").select("monto_pagado, prestamo_id, prestamos(interes_porcentaje)"),
      supabaseClient.from("gastos").select("monto"),
      supabaseClient.from("prestamos").select("id, monto_prestado, interes_porcentaje, mora_acumulada, prestamo_anterior_id, fecha_inicio, estado"),
      supabaseClient.from("cargos_mora").select("monto"),
      obtenerCapitalInicial()
    ]);

    const totalCobrado = (pagos || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
    const totalGastos = (gastos || []).reduce((s, g) => s + Number(g.monto), 0);
    const gananciaBruta = (prestamos || []).reduce((s, p) => s + Number(p.monto_prestado) * (Number(p.interes_porcentaje) || 0) / 100, 0);
    const moraCobrada = (cargosMora || []).reduce((s, c) => s + Number(c.monto), 0);
    const totalDesembolsado = await calcularDesembolsoReal(prestamos || []);
    const gananciaNeta = (gananciaBruta + moraCobrada) - totalGastos;

    // Cartera activa hoy: suma del saldo pendiente de cada préstamo activo.
    const pagadoPorPrestamo = {};
    (pagos || []).forEach(p => pagadoPorPrestamo[p.prestamo_id] = (pagadoPorPrestamo[p.prestamo_id] || 0) + Number(p.monto_pagado));
    const carteraActiva = (prestamos || [])
      .filter(p => p.estado === "activo")
      .reduce((s, p) => s + calcularSaldoPendiente(p, pagadoPorPrestamo[p.id] || 0), 0);

    const filas = [
      { concepto: "Cartera / capital inicial", monto: capitalInicial ? capitalInicial.monto : 0 },
      { concepto: "Total prestado (efectivo entregado, histórico)", monto: totalDesembolsado },
      { concepto: "Total cobrado (histórico)", monto: totalCobrado },
      { concepto: "Utilidad total acumulada (de préstamos entregados, histórica)", monto: gananciaBruta },
      { concepto: "Mora cobrada (histórica)", monto: moraCobrada },
      { concepto: "Gastos operativos (histórico)", monto: totalGastos },
      { concepto: "Ganancia neta (histórica)", monto: gananciaNeta },
      { concepto: "Cartera activa hoy (lo que falta por cobrar)", monto: carteraActiva }
    ];

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      filas,
      [{ header: `Resumen general (desde ${capitalInicial?.fecha ? formatoFecha(capitalInicial.fecha) : "el inicio"} hasta hoy)`, key: "concepto", ancho: 55 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 20 }],
      "252F86"
    ), "Resumen general");
    XLSX.writeFile(libro, `resumen-general-${obtenerFechaLocal()}.xlsx`);
  });
}

// 2) REPORTE DIARIO: el día puntual que se esté viendo en el selector "Reporte
// diario" (o hoy, si no hay un día de reporte activo) — base con la que
// inició, préstamos entregados, cobros de TODOS los clientes, gastos, y con
// cuánto cerró/debería cerrar el día.
async function exportarReporteDiarioExcel(evento) {
  const fecha = (ultimoReporteExportable && ultimoReporteExportable.tipo === "dia") ? ultimoReporteExportable.inicio : obtenerFechaLocal();
  const finDia = sumarDias(fecha, 1);

  await ejecutarExportacionExcel(evento?.currentTarget, async () => {
    const [{ data: caja }, { data: pagos }, { data: gastos }, { data: prestamos }, { data: aportes }] = await Promise.all([
      supabaseClient.from("caja_diaria").select("base_inicial, efectivo_final").eq("fecha", fecha).maybeSingle(),
      supabaseClient.from("pagos").select("monto_pagado, estado, prestamo_id, prestamos(interes_porcentaje, mora_acumulada, monto_prestado, cuota, clientes(nombre))").eq("fecha_pago", fecha),
      supabaseClient.from("gastos").select("concepto, monto").eq("fecha", fecha),
      supabaseClient.from("prestamos").select("cliente_id, monto_prestado, interes_porcentaje, prestamo_anterior_id, fecha_inicio, clientes(nombre)").eq("fecha_inicio", fecha),
      supabaseClient.from("aportes_capital").select("monto, nota").eq("fecha", fecha)
    ]);

    const totalCobrado = (pagos || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
    const totalGastos = (gastos || []).reduce((s, g) => s + Number(g.monto), 0);
    const totalAportes = (aportes || []).reduce((s, a) => s + Number(a.monto), 0);
    const totalPrestado = await calcularDesembolsoReal(prestamos || []);
    const base = Number(caja?.base_inicial || 0);
    const cierre = base + totalCobrado + totalAportes - totalGastos - totalPrestado;

    const libro = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      [
        { concepto: "Base con la que inició el día", monto: base },
        { concepto: "Préstamos entregados", monto: totalPrestado },
        { concepto: "Cobrado", monto: totalCobrado },
        { concepto: "Aportes propios", monto: totalAportes },
        { concepto: "Gastos", monto: totalGastos },
        { concepto: "Base con la que cerró (o debería cerrar) el día", monto: cierre }
      ],
      [{ header: "Concepto", key: "concepto", ancho: 45 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 20 }],
      "0EA5E9",
      null,
      `Reporte diario — ${formatoFecha(fecha)}`
    ), "Reporte diario");

    // Todos los clientes con crédito activo ese día: quién pagó, quién no, y
    // si además se le entregó un préstamo nuevo ese mismo día (y si era
    // cliente nuevo o ya venía de antes). La "Utilidad" de esta hoja es
    // SOLO la del préstamo entregado hoy (interés completo desde el día que
    // se entrega, igual que en el resto de la app) — no la utilidad que se
    // saca poco a poco de lo cobrado, para no mezclar los dos conceptos.
    const { data: prestamosActivos } = await supabaseClient
      .from("prestamos").select("id, cuota, monto_prestado, interes_porcentaje, mora_acumulada, clientes(id, nombre)").eq("estado", "activo");
    if (prestamosActivos && prestamosActivos.length) {
      const idsPrestamos = prestamosActivos.map(p => p.id);
      const [{ data: pagosDia }, { data: pagosHastaEseDia }] = await Promise.all([
        supabaseClient.from("pagos").select("prestamo_id, monto_pagado, estado").in("prestamo_id", idsPrestamos).gte("fecha_pago", fecha).lt("fecha_pago", finDia),
        supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", idsPrestamos).lt("fecha_pago", finDia)
      ]);
      const pagoDiaPorPrestamo = {};
      (pagosDia || []).forEach(pg => pagoDiaPorPrestamo[pg.prestamo_id] = pg);
      // Lo que llevaba pagado cada crédito HASTA (e incluyendo) ese día — el
      // mismo dato que usa la vista en pantalla para el "Faltante" (saldo
      // pendiente calculado a esa fecha, no el saldo de hoy si se exporta un
      // día pasado).
      const pagadoAcumulado = {};
      (pagosHastaEseDia || []).forEach(pg => pagadoAcumulado[pg.prestamo_id] = (pagadoAcumulado[pg.prestamo_id] || 0) + Number(pg.monto_pagado));

      // Préstamos entregados justo hoy, agrupados por cliente (por si un
      // mismo cliente recibiera más de uno el mismo día) — y si el cliente
      // ya tenía créditos antes o es la primera vez que se le presta.
      const prestamosHoy = prestamos || [];
      const idsClientesConPrestamoHoy = [...new Set(prestamosHoy.map(p => p.cliente_id).filter(Boolean))];
      const historialPorCliente = {};
      if (idsClientesConPrestamoHoy.length > 0) {
        const { data: historial } = await supabaseClient
          .from("prestamos").select("cliente_id").in("cliente_id", idsClientesConPrestamoHoy);
        (historial || []).forEach(p => { historialPorCliente[p.cliente_id] = (historialPorCliente[p.cliente_id] || 0) + 1; });
      }
      const prestamoHoyPorCliente = {};
      prestamosHoy.forEach(p => {
        if (!p.cliente_id) return;
        const utilidad = Number(p.monto_prestado) * (Number(p.interes_porcentaje) || 0) / 100;
        const actual = prestamoHoyPorCliente[p.cliente_id] || { monto: 0, utilidad: 0, esNuevo: (historialPorCliente[p.cliente_id] || 1) <= 1 };
        actual.monto += Number(p.monto_prestado);
        actual.utilidad += utilidad;
        prestamoHoyPorCliente[p.cliente_id] = actual;
      });

      const etiquetasEstadoDia = { pago: "Pagó", parcial: "Parcial", no_pago: "No pagó" };
      // Los que pagaron van arriba, los que no pagaron quedan al final.
      const ordenEstado = { pago: 0, parcial: 1, pendiente: 2, no_pago: 3 };
      const coloresEstadoDia = { pago: "DCFCE7", parcial: "FEF9C3", no_pago: "FEE2E2" };

      const filasClientes = prestamosActivos.map(p => {
        const pagoDia = pagoDiaPorPrestamo[p.id];
        const cobradoHoy = pagoDia ? Number(pagoDia.monto_pagado) : 0;
        const clienteId = p.clientes?.id;
        const prestamoHoy = clienteId ? prestamoHoyPorCliente[clienteId] : null;
        const faltante = calcularSaldoPendiente(p, pagadoAcumulado[p.id] || 0);
        return {
          fecha: formatoFecha(fecha),
          cliente: p.clientes?.nombre || "Cliente eliminado",
          estado: pagoDia ? (etiquetasEstadoDia[pagoDia.estado] || pagoDia.estado) : "Pendiente",
          cobradoHoy,
          prestamo: prestamoHoy ? `${prestamoHoy.esNuevo ? "Cliente nuevo" : "Cliente existente"} — ${formatoPesos(prestamoHoy.monto)}` : "—",
          utilidadPrestamo: prestamoHoy ? prestamoHoy.utilidad : 0,
          faltante,
          _estadoRaw: pagoDia ? pagoDia.estado : "pendiente"
        };
      }).sort((a, b) => (ordenEstado[a._estadoRaw] ?? 4) - (ordenEstado[b._estadoRaw] ?? 4));

      // Fila de total al final, para no tener que sumar la columna a mano al
      // abrir el archivo.
      filasClientes.push({
        fecha: "",
        cliente: `Total (${filasClientes.length} cliente${filasClientes.length === 1 ? "" : "s"})`,
        estado: "",
        cobradoHoy: filasClientes.reduce((s, f) => s + f.cobradoHoy, 0),
        prestamo: "",
        utilidadPrestamo: filasClientes.reduce((s, f) => s + f.utilidadPrestamo, 0),
        faltante: filasClientes.reduce((s, f) => s + f.faltante, 0),
        _estadoRaw: "_total",
        _negrita: true
      });

      const hojaClientes = construirHojaEstilizada(
        filasClientes,
        [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Cliente", key: "cliente", ancho: 26 },
         { header: "Estado", key: "estado", ancho: 14 },
         { header: "Cobro", key: "cobradoHoy", tipo: "moneda", ancho: 16 },
         { header: "Préstamos", key: "prestamo", ancho: 30 },
         { header: "Utilidad", key: "utilidadPrestamo", tipo: "moneda", ancho: 16 },
         { header: "Faltante", key: "faltante", tipo: "moneda", ancho: 16 }],
        "0D9488",
        (fila) => fila._estadoRaw === "_total" ? "E0E7FF" : (coloresEstadoDia[fila._estadoRaw] || null),
        `Clientes del día — ${formatoFecha(fecha)}`
      );
      XLSX.utils.book_append_sheet(libro, hojaClientes, "Clientes del día");
    }

    XLSX.writeFile(libro, `reporte-diario-${fecha}.xlsx`);
  });
}

// 3) REPORTE DEL PERÍODO (semana/mes/año/rango): el mismo Libro diario que ya
// se ve en pantalla, día por día, con los totales del período — para cuando
// solo se necesita ESO, sin las hojas de Clientes/Préstamos/Refinanciamientos.
async function exportarReportePeriodoExcel(evento) {
  await ejecutarExportacionExcel(evento?.currentTarget, async () => {
    if (!ultimoReporteExportable || !ultimoLibroDiario) { mostrarAlerta("Espera a que cargue el reporte antes de exportar."); return; }
    const r = ultimoReporteExportable;

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      [
        { concepto: "Desembolso nuevo", monto: r.totalPrestadoNuevo },
        { concepto: "Cobrado", monto: r.totalCobrado },
        { concepto: "Gastos", monto: r.totalGastos },
        { concepto: "Flujo de caja", monto: r.flujoNeto },
        { concepto: "Utilidad de préstamos entregados", monto: r.gananciaBruta },
        { concepto: "Mora cobrada", monto: r.moraCobrada },
        { concepto: "Ganancia neta", monto: r.gananciaNeta }
      ],
      [{ header: `Resumen — ${r.etiquetaPeriodo}`, key: "concepto", ancho: 40 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 20 }],
      "252F86"
    ), "Resumen del período");

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      ultimoLibroDiario.filas.map(f => ({
        fecha: formatoFecha(f.fecha), prestamos: f.prestado, cobro: f.cobro, gasto: f.gasto,
        utilidad: f.utilidad, utilidadAcumulada: f.utilidadAcumulada, utilidadPct: f.utilidadPct, base: f.base, cierre: f.cierre
      })),
      [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Préstamos", key: "prestamos", tipo: "moneda", ancho: 16 },
       { header: "Cobro", key: "cobro", tipo: "moneda", ancho: 16 }, { header: "Gasto", key: "gasto", tipo: "moneda", ancho: 16 },
       { header: "Utilidad", key: "utilidad", tipo: "moneda", ancho: 16 }, { header: "Utilidad acumulada", key: "utilidadAcumulada", tipo: "moneda", ancho: 18 },
       { header: "Utilidad %", key: "utilidadPct", tipo: "porcentaje", ancho: 14 },
       { header: "Base", key: "base", tipo: "moneda", ancho: 16 }, { header: "Cierre", key: "cierre", tipo: "moneda", ancho: 16 }],
      "0EA5E9"
    ), "Libro diario");

    const ultimoDiaIncluido = sumarDias(r.fin, -1);
    const sufijoFecha = r.inicio === ultimoDiaIncluido ? r.inicio : `${r.inicio}_a_${ultimoDiaIncluido}`;
    XLSX.writeFile(libro, `reporte-periodo-${sufijoFecha}.xlsx`);
  });
}

async function descargarRespaldo() {
  const [rutas, clientes, prestamos, pagos, gastos, cajaDiaria, aportes] = await Promise.all([
    supabaseClient.from("rutas").select("*").order("id"),
    supabaseClient.from("clientes").select("*").order("id"),
    supabaseClient.from("prestamos").select("*").order("id"),
    supabaseClient.from("pagos").select("*").order("fecha_pago", { ascending: false }),
    supabaseClient.from("gastos").select("*").order("fecha", { ascending: false }),
    supabaseClient.from("caja_diaria").select("*").order("fecha", { ascending: false }),
    supabaseClient.from("aportes_capital").select("*").order("fecha", { ascending: false })
  ]);
  const resultadoConError = [rutas, clientes, prestamos, pagos, gastos, cajaDiaria, aportes].find(resultado => resultado.error);
  if (resultadoConError) { mostrarAlerta("No fue posible generar el respaldo: " + traducirErrorSupabase(resultadoConError.error)); return; }

  const respaldo = {
    version: 1,
    generado_en: new Date().toISOString(),
    zona_horaria: "America/Bogota",
    datos: { rutas: rutas.data || [], clientes: clientes.data || [], prestamos: prestamos.data || [], pagos: pagos.data || [], gastos: gastos.data || [], caja_diaria: cajaDiaria.data || [], aportes_capital: aportes.data || [] }
  };
  const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `respaldo-cobros-completo-${obtenerFechaLocal()}.json`;
  enlace.click();
  URL.revokeObjectURL(url);

  // Antes esto se guardaba en localStorage (por celular). Ahora se guarda en
  // Supabase para que no se pierda si el cobrador cambia de dispositivo.
  const user = await obtenerUsuarioActual();
  await supabaseClient.from("preferencias_usuario")
    .upsert({ user_id: user.id, ultimo_respaldo: obtenerFechaLocal() }, { onConflict: "user_id" });
  document.getElementById("respaldo-recordatorio").classList.add("oculto");
}

function escaparCsv(valor) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

function descargarArchivoCsv(nombre, columnas, filas) {
  const contenido = [columnas.join(","), ...filas.map(fila => fila.map(escaparCsv).join(","))].join("\n");
  const blob = new Blob(["\ufeff" + contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url; enlace.download = `${nombre}-${obtenerFechaLocal()}.csv`; enlace.click();
  URL.revokeObjectURL(url);
}

async function exportarCsv(tipo) {
  if (tipo === "pagos") {
    const { data, error } = await supabaseClient.from("pagos").select("fecha_pago, monto_pagado, estado, prestamos(clientes(nombre))").order("fecha_pago", { ascending: false });
    if (error) return mostrarAlerta("No fue posible exportar los pagos.");
    descargarArchivoCsv("pagos", ["Fecha", "Cliente", "Estado", "Monto"], (data || []).map(p => [p.fecha_pago, p.prestamos?.clientes?.nombre, p.estado, p.monto_pagado]));
  } else if (tipo === "gastos") {
    const { data, error } = await supabaseClient.from("gastos").select("fecha, concepto, monto").order("fecha", { ascending: false });
    if (error) return mostrarAlerta("No fue posible exportar los gastos.");
    descargarArchivoCsv("gastos", ["Fecha", "Concepto", "Monto"], (data || []).map(g => [g.fecha, g.concepto, g.monto]));
  } else {
    const { data: prestamos, error } = await supabaseClient.from("prestamos").select("id, monto_prestado, interes_porcentaje, mora_acumulada, cuota, prestamo_anterior_id, clientes(nombre)").eq("estado", "activo");
    if (error) return mostrarAlerta("No fue posible exportar la cartera.");
    const ids = (prestamos || []).map(p => p.id);
    const { data: pagos } = ids.length ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", ids) : { data: [] };
    const abonado = {}; (pagos || []).forEach(p => abonado[p.prestamo_id] = (abonado[p.prestamo_id] || 0) + Number(p.monto_pagado));
    // Antes este saldo no incluía la mora aplicada, así que un crédito con
    // mora salía con un número distinto aquí que en la pantalla de Cobrar.
    descargarArchivoCsv("cartera", ["Cliente", "Monto inicial", "Interés %", "Cuota", "Abonado", "Mora aplicada", "Saldo", "Es refinanciamiento"], (prestamos || []).map(p => {
      return [p.clientes?.nombre, p.monto_prestado, p.interes_porcentaje, p.cuota, abonado[p.id] || 0, p.mora_acumulada || 0, calcularSaldoPendiente(p, abonado[p.id] || 0), p.prestamo_anterior_id ? "Sí" : "No"];
    }));
  }
}

// --- Recordatorio de respaldo si han pasado más de 7 días ---
// Antes vivía en localStorage (por celular); ahora vive en Supabase, junto
// con el resto de las preferencias del negocio, para que no se pierda si
// cambias de dispositivo.
async function verificarRecordatorioRespaldo() {
  const user = await obtenerUsuarioActual();
  const { data } = await supabaseClient.from("preferencias_usuario").select("ultimo_respaldo").eq("user_id", user.id).maybeSingle();
  const ultimo = data?.ultimo_respaldo;
  const contenedor = document.getElementById("respaldo-recordatorio");
  const hoy = obtenerFechaLocal();

  if (!ultimo) {
    contenedor.innerHTML = `<div class="aviso-respaldo">💾 Aún no has descargado ningún respaldo. Te recomendamos hacerlo periódicamente.</div>`;
    contenedor.classList.remove("oculto");
    return;
  }

  const [a1, m1, d1] = ultimo.split("-").map(Number);
  const [a2, m2, d2] = hoy.split("-").map(Number);
  const dias = Math.floor((new Date(a2, m2 - 1, d2) - new Date(a1, m1 - 1, d1)) / (1000 * 60 * 60 * 24));

  if (dias >= 7) {
    contenedor.innerHTML = `<div class="aviso-respaldo">💾 Han pasado ${dias} días desde tu último respaldo. Te recomendamos descargar uno nuevo.</div>`;
    contenedor.classList.remove("oculto");
  } else {
    contenedor.classList.add("oculto");
  }
}

