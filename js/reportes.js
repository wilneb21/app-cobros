function cambiarTipoReporte() {
  const tipo = document.getElementById("reporte-tipo").value;
  document.getElementById("reporte-fecha-dia").classList.add("oculto");
  document.getElementById("reporte-mes").classList.add("oculto");
  document.getElementById("reporte-anio").classList.add("oculto");
  if (tipo === "dia") document.getElementById("reporte-fecha-dia").classList.remove("oculto");
  if (tipo === "mes") document.getElementById("reporte-mes").classList.remove("oculto");
  if (tipo === "anio") document.getElementById("reporte-anio").classList.remove("oculto");
  // "semana" no necesita selector propio: siempre es la semana actual (lunes a domingo)
  cargarReporteMes();
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

  document.getElementById("resumen-mes").innerHTML = `
    <div class="resumen-caja tono-primario"><span class="numero">${formatoPesos(totalPrestadoNuevo)}</span><span class="etiqueta">Desembolso nuevo</span></div>
    <div class="resumen-caja tono-exito"><span class="numero">${formatoPesos(totalCobrado)}</span><span class="etiqueta">Cobrado en ${etiquetaPeriodo}</span></div>
    <div class="resumen-caja tono-peligro"><span class="numero">${formatoPesos(totalGastos)}</span><span class="etiqueta">Gastos</span></div>
    <div class="resumen-caja ${claseFlujo}"><span class="numero">${flujoNeto >= 0 ? "+" : ""}${formatoPesos(flujoNeto)}</span><span class="etiqueta">Flujo neto</span></div>`;

  await cargarRefinanciamientosPeriodo(refinanciados, inicio, fin);
  await cargarTendenciaCartera();
  verificarRecordatorioRespaldo();
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
    const { data: viejo } = await supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje").eq("id", nuevo.prestamo_anterior_id).single();
    if (!viejo) continue;
    const { data: pagosViejo } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", nuevo.prestamo_anterior_id).lte("fecha_pago", nuevo.fecha_inicio);
    const pagadoViejo = (pagosViejo || []).reduce((s, p) => s + Number(p.monto_pagado), 0);
    const saldoViejo = Math.max(Number(viejo.monto_prestado) * (1 + Number(viejo.interes_porcentaje) / 100) - pagadoViejo, 0);
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
      supabaseClient.from("clientes").select("nombre, telefono, direccion, riesgo, archivado, rutas(nombre)").order("nombre"),
      supabaseClient.from("prestamos").select("monto_prestado, interes_porcentaje, cuota, numero_cuotas, frecuencia, fecha_inicio, estado, clientes(nombre)").order("fecha_inicio", { ascending: false }),
      supabaseClient.from("pagos").select("fecha_pago, monto_pagado, estado, prestamos(clientes(nombre))").order("fecha_pago", { ascending: false }),
      supabaseClient.from("gastos").select("fecha, concepto, monto").order("fecha", { ascending: false })
    ]);
    const conError = [clientes, prestamos, pagos, gastos].find(r => r.error);
    if (conError) { mostrarAlerta("No fue posible exportar a Excel: " + conError.error.message); return; }

    const etiquetasEstado = { pago: "Pagó", parcial: "Parcial", no_pago: "No pagó" };
    const etiquetasRiesgo = { bueno: "Bueno", regular: "Regular", riesgoso: "Riesgoso" };
    const libro = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (clientes.data || []).map(c => ({
        nombre: c.nombre, telefono: c.telefono || "", direccion: c.direccion || "",
        ruta: c.rutas?.nombre || "sin ruta", riesgo: etiquetasRiesgo[c.riesgo] || "Bueno", archivado: c.archivado ? "Sí" : "No"
      })),
      [{ header: "Nombre", key: "nombre", ancho: 24 }, { header: "Teléfono", key: "telefono", ancho: 16 },
       { header: "Dirección", key: "direccion", ancho: 28 }, { header: "Ruta", key: "ruta", ancho: 18 },
       { header: "Riesgo", key: "riesgo", ancho: 12 }, { header: "Archivado", key: "archivado", ancho: 12 }],
      "4056D6"
    ), "Clientes");

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (prestamos.data || []).map(p => ({
        cliente: p.clientes?.nombre || "", monto: p.monto_prestado, interes: p.interes_porcentaje, cuota: p.cuota,
        cuotas: p.numero_cuotas, frecuencia: p.frecuencia, fecha: p.fecha_inicio, estado: p.estado
      })),
      [{ header: "Cliente", key: "cliente", ancho: 24 }, { header: "Monto prestado", key: "monto", tipo: "moneda", ancho: 16 },
       { header: "Interés %", key: "interes", tipo: "porcentaje", ancho: 12 }, { header: "Cuota", key: "cuota", tipo: "moneda", ancho: 14 },
       { header: "Cuotas", key: "cuotas", tipo: "entero", ancho: 10 }, { header: "Frecuencia", key: "frecuencia", ancho: 12 },
       { header: "Fecha inicio", key: "fecha", ancho: 14 }, { header: "Estado", key: "estado", ancho: 14 }],
      "8B5CF6"
    ), "Préstamos");

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (pagos.data || []).map(p => ({ fecha: p.fecha_pago, cliente: p.prestamos?.clientes?.nombre || "", estado: etiquetasEstado[p.estado] || p.estado, monto: p.monto_pagado })),
      [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Cliente", key: "cliente", ancho: 24 },
       { header: "Estado", key: "estado", ancho: 14 }, { header: "Monto", key: "monto", tipo: "moneda", ancho: 16 }],
      "16A36F"
    ), "Pagos");

    XLSX.utils.book_append_sheet(libro, construirHojaEstilizada(
      (gastos.data || []).map(g => ({ fecha: g.fecha, concepto: g.concepto, monto: g.monto })),
      [{ header: "Fecha", key: "fecha", ancho: 14 }, { header: "Concepto", key: "concepto", ancho: 28 },
       { header: "Monto", key: "monto", tipo: "moneda", ancho: 16 }],
      "E11D48"
    ), "Gastos");

    XLSX.writeFile(libro, `cobros-excel-${obtenerFechaLocal()}.xlsx`);
  } catch (error) {
    mostrarAlerta(error.message || "No fue posible generar el Excel.");
  } finally {
    if (boton) { boton.disabled = false; boton.innerHTML = textoOriginal; }
  }
}

async function descargarRespaldo() {
  const [rutas, clientes, prestamos, pagos, gastos, metas] = await Promise.all([
    supabaseClient.from("rutas").select("*").order("id"),
    supabaseClient.from("clientes").select("*").order("id"),
    supabaseClient.from("prestamos").select("*").order("id"),
    supabaseClient.from("pagos").select("*").order("fecha_pago", { ascending: false }),
    supabaseClient.from("gastos").select("*").order("fecha", { ascending: false }),
    supabaseClient.from("metas").select("*")
  ]);
  const resultadoConError = [rutas, clientes, prestamos, pagos, gastos, metas].find(resultado => resultado.error);
  if (resultadoConError) { mostrarAlerta("No fue posible generar el respaldo: " + resultadoConError.error.message); return; }

  const respaldo = {
    version: 1,
    generado_en: new Date().toISOString(),
    zona_horaria: "America/Bogota",
    datos: { rutas: rutas.data || [], clientes: clientes.data || [], prestamos: prestamos.data || [], pagos: pagos.data || [], gastos: gastos.data || [], metas: metas.data || [] }
  };
  const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `respaldo-cobros-completo-${obtenerFechaLocal()}.json`;
  enlace.click();
  URL.revokeObjectURL(url);

  localStorage.setItem("ultimoRespaldo", obtenerFechaLocal());
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
    const { data: prestamos, error } = await supabaseClient.from("prestamos").select("id, monto_prestado, interes_porcentaje, cuota, clientes(nombre)").eq("estado", "activo");
    if (error) return mostrarAlerta("No fue posible exportar la cartera.");
    const ids = (prestamos || []).map(p => p.id);
    const { data: pagos } = ids.length ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", ids) : { data: [] };
    const abonado = {}; (pagos || []).forEach(p => abonado[p.prestamo_id] = (abonado[p.prestamo_id] || 0) + Number(p.monto_pagado));
    descargarArchivoCsv("cartera", ["Cliente", "Monto inicial", "Interés %", "Cuota", "Abonado", "Saldo"], (prestamos || []).map(p => {
      const total = Number(p.monto_prestado) * (1 + Number(p.interes_porcentaje) / 100);
      return [p.clientes?.nombre, p.monto_prestado, p.interes_porcentaje, p.cuota, abonado[p.id] || 0, Math.max(total - (abonado[p.id] || 0), 0)];
    }));
  }
}

// --- Recordatorio de respaldo si han pasado más de 7 días ---
function verificarRecordatorioRespaldo() {
  const ultimo = localStorage.getItem("ultimoRespaldo");
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

