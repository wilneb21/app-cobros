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

  // --- GANANCIA: de lo cobrado, solo la parte de INTERÉS es ganancia real.
  // El resto es capital que vuelve (no es plata que "ganas", es tu propia plata
  // regresando). Cada préstamo cobra su interés de forma pareja en cada cuota,
  // así que la fracción de interés de cualquier abono es interés% / (100 + interés%).
  const gananciaBruta = await calcularGananciaPorIntereses(inicio, fin);
  const moraCobrada = await calcularMoraCobrada(inicio, fin);
  const gananciaNeta = (gananciaBruta + moraCobrada) - totalGastos;
  const claseGanancia = gananciaNeta >= 0 ? "tono-exito" : "tono-peligro";

  document.getElementById("resumen-mes").innerHTML = `
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(totalPrestadoNuevo)}</span><span class="etiqueta">Desembolso nuevo</span></div>
    <div class="resumen-caja tono-exito"><span class="numero">${formatoPesos(totalCobrado)}</span><span class="etiqueta">Cobrado en ${etiquetaPeriodo}</span></div>
    <div class="resumen-caja tono-peligro"><span class="numero">${formatoPesos(totalGastos)}</span><span class="etiqueta">Gastos</span></div>
    <div class="resumen-caja ${claseFlujo}"><span class="numero">${flujoNeto >= 0 ? "+" : ""}${formatoPesos(flujoNeto)}</span><span class="etiqueta">Flujo de caja</span></div>
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(gananciaBruta)}</span><span class="etiqueta">Ganancia por intereses</span><span class="subetiqueta">Sin contar capital recuperado</span></div>
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(moraCobrada)}</span><span class="etiqueta">Mora cobrada</span><span class="subetiqueta">Recargos aplicados de verdad en ${etiquetaPeriodo}</span></div>
    <div class="resumen-caja ${claseGanancia}"><span class="numero">${gananciaNeta >= 0 ? "+" : ""}${formatoPesos(gananciaNeta)}</span><span class="etiqueta">Ganancia neta</span><span class="subetiqueta">Intereses + mora, menos gastos</span></div>`;

  ultimoReporteExportable = { inicio, fin, etiquetaPeriodo, totalPrestadoNuevo, totalCobrado, totalGastos, flujoNeto, gananciaBruta, moraCobrada, gananciaNeta, pagosPeriodo: pagosPeriodo || [] };

  await cargarRefinanciamientosPeriodo(refinanciados, inicio, fin);
  await cargarTendenciaCartera();
  await cargarComparativoRutas(inicio, fin);
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

  const [{ data: caja }, { data: pagos }, { data: gastos }, { data: prestamos }, { data: aportes }, { data: cargosMora }, capitalInicial] = await Promise.all([
    supabaseClient.from("caja_diaria").select("fecha, base_inicial").gte("fecha", inicio).lt("fecha", fin),
    supabaseClient.from("pagos").select("fecha_pago, monto_pagado, prestamos(interes_porcentaje)").gte("fecha_pago", inicio).lt("fecha_pago", fin),
    supabaseClient.from("gastos").select("fecha, monto").gte("fecha", inicio).lt("fecha", fin),
    supabaseClient.from("prestamos").select("monto_prestado, prestamo_anterior_id, fecha_inicio").gte("fecha_inicio", inicio).lt("fecha_inicio", fin),
    supabaseClient.from("aportes_capital").select("fecha, monto").gte("fecha", inicio).lt("fecha", fin),
    supabaseClient.from("cargos_mora").select("fecha, monto").gte("fecha", inicio).lt("fecha", fin),
    obtenerCapitalInicial()
  ]);

  const baseGuardada = {};
  (caja || []).forEach(c => baseGuardada[c.fecha] = Number(c.base_inicial));
  const cobroPorDia = {}, utilidadPorDia = {};
  (pagos || []).forEach(p => {
    const interes = Number(p.prestamos?.interes_porcentaje) || 0;
    const fraccion = interes / (100 + interes);
    cobroPorDia[p.fecha_pago] = (cobroPorDia[p.fecha_pago] || 0) + Number(p.monto_pagado);
    utilidadPorDia[p.fecha_pago] = (utilidadPorDia[p.fecha_pago] || 0) + Number(p.monto_pagado) * fraccion;
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

  while (fechaCursor < fin) {
    const base = baseGuardada[fechaCursor] !== undefined ? baseGuardada[fechaCursor] : baseCorriente;
    const prestamosDia = prestamosPorDia[fechaCursor] || [];
    const prestado = await calcularDesembolsoReal(prestamosDia);
    const cobro = cobroPorDia[fechaCursor] || 0;
    const gasto = gastoPorDia[fechaCursor] || 0;
    const aporte = aportePorDia[fechaCursor] || 0;
    const utilidad = utilidadPorDia[fechaCursor] || 0;
    const cierre = base + cobro + aporte - gasto - prestado;
    const utilidadPct = cobro > 0 ? (utilidad / cobro) * 100 : 0;

    filas.push({ fecha: fechaCursor, base, prestado, cobro, gasto, utilidad, utilidadPct, cierre });
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
      <span>Fecha</span><span>Base</span><span>Préstamos</span><span>Cobro</span><span>Gasto</span><span>Utilidad</span><span>Utilidad %</span><span>Cierre</span>
    </div>
    ${filas.map(f => `
      <div class="fila-libro-diario">
        <span>${formatoFecha(f.fecha)}</span>
        <span>${formatoPesos(f.base)}</span>
        <span>${f.prestado > 0 ? "-" + formatoPesos(f.prestado) : formatoPesos(0)}</span>
        <span>${formatoPesos(f.cobro)}</span>
        <span>${f.gasto > 0 ? "-" + formatoPesos(f.gasto) : formatoPesos(0)}</span>
        <span class="${f.utilidad >= 0 ? "tono-exito-texto" : "tono-peligro-texto"}">${formatoPesos(f.utilidad)}</span>
        <span>${f.utilidadPct.toFixed(1)}%</span>
        <span><b>${formatoPesos(f.cierre)}</b></span>
      </div>`).join("")}`;

  const utilidadPctTotal = totales.cobro > 0 ? (totales.utilidad / totales.cobro) * 100 : 0;
  totalesEl.innerHTML = `
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(totales.prestado)}</span><span class="etiqueta">Total prestado</span></div>
    <div class="resumen-caja tono-exito"><span class="numero">${formatoPesos(totales.cobro)}</span><span class="etiqueta">Total cobrado</span></div>
    <div class="resumen-caja tono-peligro"><span class="numero">${formatoPesos(totales.gasto)}</span><span class="etiqueta">Total gastos</span></div>
    <div class="resumen-caja ${totales.utilidad >= 0 ? "tono-exito" : "tono-peligro"}"><span class="numero">${formatoPesos(totales.utilidad)}</span><span class="etiqueta">Utilidad total</span><span class="subetiqueta">${utilidadPctTotal.toFixed(1)}% de lo cobrado</span></div>
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(filas[filas.length - 1].cierre)}</span><span class="etiqueta">Cierre del período</span><span class="subetiqueta">Flujo de caja al final de ${formatoFecha(filas[filas.length - 1].fecha)}</span></div>`;
}

// --- CLIENTES DEL DÍA (solo para el reporte tipo "día") ---
// Lista, cliente por cliente, lo que pasó ese día puntual: cuánto cobró,
// cuánto lleva pagado en total de ese crédito hasta esa fecha, cuánto le
// falta para terminarlo, y si pagó completo / parcial / no pagó — con el
// mismo color que ya usa la pantalla de "Cobrar" (verde/amarillo/rojo), para
// que se lea igual de rápido. Solo tiene sentido para UN día puntual — en
// semana/mes/año/rango se vería una lista enorme mezclando muchos días, así
// que ahí se oculta y basta con el Libro diario de más abajo.
// OJO: "Le falta" usa la mora ACTUAL del crédito (no una foto histórica de
// cómo estaba la mora justo ese día), porque es el dato que de verdad importa
// al revisar el reporte: cuánto falta HOY, no cuánto faltaba en ese momento.
async function cargarDetalleClientesDelDia(inicio, fin, esReporteDeUnDia) {
  const envoltura = document.getElementById("detalle-clientes-dia-envoltura");
  const contenedor = document.getElementById("detalle-clientes-dia");
  if (!envoltura || !contenedor) return;

  if (!esReporteDeUnDia) { envoltura.classList.add("oculto"); contenedor.innerHTML = ""; return; }
  envoltura.classList.remove("oculto");
  contenedor.innerHTML = '<div class="cargando">⏳ Cargando clientes del día...</div>';

  const { data: pagosDia, error } = await supabaseClient
    .from("pagos")
    .select("id, monto_pagado, estado, prestamo_id, prestamos(id, monto_prestado, interes_porcentaje, mora_acumulada, cuota, clientes(id, nombre))")
    .gte("fecha_pago", inicio).lt("fecha_pago", fin);
  if (error) { contenedor.innerHTML = '<p class="texto-ayuda">No fue posible cargar el detalle de clientes de este día.</p>'; return; }

  if (!pagosDia || pagosDia.length === 0) {
    contenedor.innerHTML = '<div class="estado-vacio">No hay pagos registrados este día.</div>';
    return;
  }

  // Cuánto llevaba pagado cada crédito HASTA (e incluyendo) este día, para
  // mostrar "lleva pagado" e "saldo pendiente" tal como quedaron al cierre
  // de ese día — no el acumulado de hoy si estás viendo un día pasado.
  const idsPrestamos = [...new Set(pagosDia.map(p => p.prestamo_id))];
  const { data: pagosHastaEseDia } = await supabaseClient
    .from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", idsPrestamos).lt("fecha_pago", fin);
  const pagadoAcumulado = {};
  (pagosHastaEseDia || []).forEach(pg => pagadoAcumulado[pg.prestamo_id] = (pagadoAcumulado[pg.prestamo_id] || 0) + Number(pg.monto_pagado));

  const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌" };
  // Mismos colores que ya usa la pantalla de Cobrar: verde = al día, amarillo
  // = parcial, rojo = no pagó — para que el ojo no tenga que aprender un
  // código de colores nuevo.
  const clases = { pago: "estado-al-dia", parcial: "estado-atencion", no_pago: "estado-mora" };
  const orden = { no_pago: 0, parcial: 1, pago: 2 };

  const filasOrdenadas = [...pagosDia].sort((a, b) => (orden[a.estado] ?? 3) - (orden[b.estado] ?? 3));
  let cantidadPago = 0, cantidadParcial = 0, cantidadNoPago = 0;

  const filasHtml = filasOrdenadas.map(pg => {
    const prestamo = pg.prestamos;
    const nombre = prestamo?.clientes?.nombre || "Cliente eliminado";
    const clienteId = prestamo?.clientes?.id;
    const totalPagado = pagadoAcumulado[pg.prestamo_id] || 0;
    const saldoPendiente = prestamo ? calcularSaldoPendiente(prestamo, totalPagado) : 0;
    if (pg.estado === "pago") cantidadPago++; else if (pg.estado === "parcial") cantidadParcial++; else cantidadNoPago++;

    return `
      <div class="subtarjeta fila-cliente-dia ${clases[pg.estado] || ""}" ${clienteId ? `onclick="abrirDetalleCliente(${clienteId})"` : ""}>
        <div class="fila-resumen-credito">
          <span class="nombre-cliente-dia">${escaparHtml(nombre)}</span>
          <span class="badge-estado">${etiquetas[pg.estado] || escaparHtml(pg.estado)}</span>
        </div>
        <div class="fila-cliente-dia-datos">
          <span>Cobrado hoy <b>${formatoPesos(pg.monto_pagado)}</b></span>
          <span>Lleva pagado <b>${formatoPesos(totalPagado)}</b></span>
          <span>Le falta <b>${formatoPesos(saldoPendiente)}</b></span>
        </div>
      </div>`;
  }).join("");

  contenedor.innerHTML = `
    <div class="resumen-clientes-dia">
      <span class="tono-exito-texto">✅ ${cantidadPago} pagaron</span>
      <span class="tono-advertencia-texto">⚠️ ${cantidadParcial} parcial</span>
      <span class="tono-peligro-texto">❌ ${cantidadNoPago} no pagaron</span>
    </div>
    ${filasHtml}`;
}

// --- COMPARAR RENDIMIENTO ENTRE RUTAS ---
// Agrupa el recaudo y el % de cumplimiento (pagos completos / total de registros
// de pago) por ruta dentro del período del reporte, para ver cuál ruta paga
// mejor y cuál tiene más mora.
async function cargarComparativoRutas(inicio, fin) {
  const contenedor = document.getElementById("comparativo-rutas");
  if (!contenedor) return;
  contenedor.innerHTML = '<div class="cargando">Calculando...</div>';

  const [{ data: clientes, error: errorClientes }, { data: prestamos, error: errorPrestamos }] = await Promise.all([
    supabaseClient.from("clientes").select("id, ruta_id, rutas(nombre)"),
    supabaseClient.from("prestamos").select("id, cliente_id")
  ]);
  if (errorClientes || errorPrestamos) { contenedor.innerHTML = '<p class="texto-ayuda">No fue posible calcular el comparativo por ruta.</p>'; return; }

  const rutaPorCliente = {};
  const nombreRuta = {};
  (clientes || []).forEach(c => {
    rutaPorCliente[c.id] = c.ruta_id || "sin_ruta";
    nombreRuta[c.ruta_id || "sin_ruta"] = c.rutas?.nombre || "Sin ruta asignada";
  });
  const clientePorPrestamo = {};
  (prestamos || []).forEach(p => clientePorPrestamo[p.id] = p.cliente_id);

  const idsPrestamos = (prestamos || []).map(p => p.id);
  const { data: pagos, error: errorPagos } = idsPrestamos.length
    ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado, estado").gte("fecha_pago", inicio).lt("fecha_pago", fin).in("prestamo_id", idsPrestamos)
    : { data: [] };
  if (errorPagos) { contenedor.innerHTML = '<p class="texto-ayuda">No fue posible calcular el comparativo por ruta.</p>'; return; }

  const porRuta = {};
  (pagos || []).forEach(pg => {
    const clienteId = clientePorPrestamo[pg.prestamo_id];
    const rutaId = rutaPorCliente[clienteId] ?? "sin_ruta";
    if (!porRuta[rutaId]) porRuta[rutaId] = { cobrado: 0, total: 0, pagados: 0 };
    porRuta[rutaId].cobrado += Number(pg.monto_pagado);
    porRuta[rutaId].total++;
    if (pg.estado === "pago") porRuta[rutaId].pagados++;
  });

  const filas = Object.entries(porRuta)
    .map(([rutaId, r]) => ({ nombre: nombreRuta[rutaId] || "Sin ruta asignada", cobrado: r.cobrado, pct: r.total ? (r.pagados / r.total) * 100 : 0 }))
    .sort((a, b) => b.cobrado - a.cobrado);

  contenedor.innerHTML = filas.length === 0
    ? '<div class="estado-vacio">Aún no hay pagos registrados en este período para comparar rutas.</div>'
    : filas.map(f => `
        <div class="comparar-rutas-fila">
          <span class="nombre-ruta">📍 ${escaparHtml(f.nombre)}</span>
          <span>${formatoPesos(f.cobrado)} cobrado</span>
          <span class="${f.pct >= 80 ? "mora-baja" : f.pct < 60 ? "mora-alta" : ""}">${f.pct.toFixed(0)}% cumplimiento</span>
        </div>`).join("");
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
    ["Ganancia por intereses", r.gananciaBruta], ["Mora cobrada", r.moraCobrada],
    ["Ganancia neta", r.gananciaNeta], [],
    ["Flujo de caja día por día"],
    ["Fecha", "Base", "Préstamos", "Cobro", "Gasto", "Utilidad", "Utilidad %", "Cierre"],
    ...(ultimoLibroDiario?.filas || []).map(f => [formatoFecha(f.fecha), f.base, f.prestado, f.cobro, f.gasto, f.utilidad.toFixed(0), f.utilidadPct.toFixed(1), f.cierre]),
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

// Calcula cuánto de lo cobrado en el período es GANANCIA real (solo intereses).
// Cada préstamo reparte su interés de forma pareja en todas sus cuotas (interés
// simple sobre el monto, dividido en partes iguales), así que la fracción de
// cualquier abono que es ganancia = interés% / (100 + interés%). El resto del
// abono es el capital propio que estás recuperando, no es ganancia.
async function calcularGananciaPorIntereses(inicio, fin) {
  const { data: pagos, error } = await supabaseClient
    .from("pagos")
    .select("monto_pagado, prestamos(interes_porcentaje)")
    .gte("fecha_pago", inicio).lt("fecha_pago", fin);
  if (error || !pagos) return 0;
  return pagos.reduce((total, p) => {
    const interes = Number(p.prestamos?.interes_porcentaje) || 0;
    const fraccionGanancia = interes / (100 + interes);
    return total + Number(p.monto_pagado) * fraccionGanancia;
  }, 0);
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

// --- CARTERA ACTIVA POR SEMANA: reconstruye el saldo total pendiente en cada corte semanal ---
async function cargarTendenciaCartera() {
  const contenedor = document.getElementById("grafico-cartera");
  const deltaEl = document.getElementById("delta-cartera");
  const hoy = obtenerFechaLocal();
  const lunesActual = obtenerLunesDeSemana(hoy);

  const fechasCorte = [];
  for (let i = 5; i >= 0; i--) fechasCorte.push(sumarDias(lunesActual, -7 * i));

  const valores = [];
  for (const fecha of fechasCorte) {
    const { data, error } = await supabaseClient.rpc("cartera_activa_en_fecha", { p_fecha: fecha });
    valores.push(error ? 0 : Number(data) || 0);
  }

  const maximo = Math.max(...valores, 1);
  contenedor.innerHTML = valores.map((valor, i) => {
    const alturaPct = Math.max((valor / maximo) * 100, 3);
    const anterior = i > 0 ? valores[i - 1] : valor;
    const clase = i === 0 ? "igual" : valor > anterior ? "sube" : valor < anterior ? "baja" : "igual";
    const [a, m, d] = fechasCorte[i].split("-");
    return `
      <div class="barra-semana" title="Semana del ${d}/${m}: ${formatoPesos(valor)}">
        <div class="barra ${clase}" style="height:${alturaPct}%"></div>
        <span class="etiqueta-semana">${d}/${m}</span>
      </div>`;
  }).join("");

  const inicial = valores[0], final = valores[valores.length - 1];
  if (inicial > 0) {
    const variacion = ((final - inicial) / inicial) * 100;
    const sube = variacion >= 0;
    deltaEl.className = sube ? "tendencia-sube" : "tendencia-baja";
    deltaEl.textContent = `${sube ? "↗" : "↘"} ${Math.abs(variacion).toFixed(1)}% en 6 semanas`;
  } else {
    deltaEl.textContent = "";
  }
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
function construirHojaEstilizada(filas, columnas, colorHex) {
  const encabezado = columnas.map(c => ({
    v: c.header, t: "s",
    s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: colorHex } }, alignment: { horizontal: "center", vertical: "center" }, border: BORDE_FINO_EXCEL }
  }));

  const filasCuerpo = filas.map((fila, i) => columnas.map(c => {
    const valor = fila[c.key];
    const esNumero = c.tipo === "moneda" || c.tipo === "porcentaje" || c.tipo === "entero";
    const estilo = { border: BORDE_FINO_EXCEL, alignment: { horizontal: esNumero ? "right" : "left", vertical: "center" } };
    if (i % 2 === 1) estilo.fill = { fgColor: { rgb: "F4F5FB" } };
    if (c.tipo === "moneda") estilo.numFmt = '"$"#,##0';
    if (c.tipo === "porcentaje") estilo.numFmt = '0.00"%"';
    return { v: esNumero ? Number(valor) || 0 : (valor ?? ""), t: esNumero ? "n" : "s", s: estilo };
  }));

  const ws = XLSX.utils.aoa_to_sheet([encabezado, ...filasCuerpo]);
  ws["!cols"] = columnas.map(c => ({ wch: c.ancho || 18 }));
  if (filasCuerpo.length > 0) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filasCuerpo.length, c: columnas.length - 1 } }) };
  }
  return ws;
}

async function exportarExcel(evento) {
  const boton = evento?.currentTarget;
  const textoOriginal = boton ? boton.innerHTML : "";
  if (boton) { boton.disabled = true; boton.innerHTML = "⏳ Generando Excel..."; }

  try {
    await cargarLibreriaExcel();

    const [clientes, prestamos, pagos, gastos] = await Promise.all([
      supabaseClient.from("clientes").select("id, nombre, telefono, direccion, archivado, rutas(nombre)").order("nombre"),
      supabaseClient.from("prestamos").select("id, monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, prestamo_anterior_id, clientes(nombre)").order("fecha_inicio", { ascending: false }),
      supabaseClient.from("pagos").select("fecha_pago, monto_pagado, estado, prestamos(interes_porcentaje, clientes(nombre))").order("fecha_pago", { ascending: false }),
      supabaseClient.from("gastos").select("fecha, concepto, monto").order("fecha", { ascending: false })
    ]);
    const conError = [clientes, prestamos, pagos, gastos].find(r => r.error);
    if (conError) { mostrarAlerta("No fue posible exportar a Excel: " + traducirErrorSupabase(conError.error)); return; }
    await calcularRiesgoTodosClientes();

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
          fecha: formatoFecha(f.fecha), prestamos: f.prestado, utilidad: f.utilidad,
          utilidadPct: f.utilidadPct, cobro: f.cobro, gasto: f.gasto, base: f.base, cierre: f.cierre
        })),
        [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Préstamos", key: "prestamos", tipo: "moneda", ancho: 16 },
         { header: "Utilidad", key: "utilidad", tipo: "moneda", ancho: 16 }, { header: "Utilidad %", key: "utilidadPct", tipo: "porcentaje", ancho: 14 },
         { header: "Cobro", key: "cobro", tipo: "moneda", ancho: 16 }, { header: "Gasto", key: "gasto", tipo: "moneda", ancho: 16 },
         { header: "Base", key: "base", tipo: "moneda", ancho: 16 }, { header: "Cierre (flujo de caja)", key: "cierre", tipo: "moneda", ancho: 20 }],
        "0EA5E9"
      ), "Libro diario");
    }

    // --- Hoja "Resumen": totales generales de todo lo exportado, con la
    // ganancia neta real (solo intereses cobrados, menos gastos operativos).
    const totalCobradoTodo = (pagos.data || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
    const totalGastosTodo = (gastos.data || []).reduce((s, g) => s + Number(g.monto), 0);
    const gananciaBrutaTodo = (pagos.data || []).reduce((s, p) => {
      const interes = Number(p.prestamos?.interes_porcentaje) || 0;
      return s + Number(p.monto_pagado) * (interes / (100 + interes));
    }, 0);
    const totalDesembolsadoTodo = await calcularDesembolsoReal((prestamos.data || []).map(p => ({ monto_prestado: p.monto_prestado, prestamo_anterior_id: p.prestamo_anterior_id, fecha_inicio: p.fecha_inicio })));
    const totalSaldoRenovadoTodo = refinanciamientosDetalle.reduce((s, r) => s + r.saldoRenovado, 0);

    const filasResumen = [
      { concepto: "Total desembolsado en efectivo (sin contar saldos renovados)", monto: totalDesembolsadoTodo },
      { concepto: "Total cobrado (capital + interés)", monto: totalCobradoTodo },
      { concepto: "Ganancia por intereses (ganancia real)", monto: gananciaBrutaTodo },
      { concepto: "Gastos operativos", monto: totalGastosTodo },
      { concepto: "Ganancia neta (intereses - gastos)", monto: gananciaBrutaTodo - totalGastosTodo },
      { concepto: "Saldo renovado en refinanciamientos (no es plata nueva)", monto: totalSaldoRenovadoTodo }
    ];
    const hojaResumen = construirHojaEstilizada(
      filasResumen,
      [{ header: "Concepto", key: "concepto", ancho: 50 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 20 }],
      "252F86"
    );
    XLSX.utils.book_append_sheet(libro, hojaResumen, "Resumen");
    // Se reordena para que "Resumen" quede como primera hoja al abrir el archivo.
    libro.SheetNames.unshift(libro.SheetNames.pop());

    XLSX.writeFile(libro, `cobros-excel-${obtenerFechaLocal()}.xlsx`);
  } catch (error) {
    mostrarAlerta(error ? traducirErrorSupabase(error) : "No fue posible generar el Excel.");
  } finally {
    if (boton) { boton.disabled = false; boton.innerHTML = textoOriginal; }
  }
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

