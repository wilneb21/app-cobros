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

  const { data: prestamosPeriodo } = await supabaseClient.from("prestamos").select("monto_prestado").gte("fecha_inicio", inicio).lt("fecha_inicio", fin);
  const totalPrestado = prestamosPeriodo ? prestamosPeriodo.reduce((s, p) => s + Number(p.monto_prestado), 0) : 0;

  const { data: pagosPeriodo } = await supabaseClient.from("pagos").select("monto_pagado").gte("fecha_pago", inicio).lt("fecha_pago", fin);
  const totalCobrado = pagosPeriodo ? pagosPeriodo.reduce((s, p) => s + Number(p.monto_pagado), 0) : 0;

  const totalGastos = await cargarGastosDelPeriodo(inicio, fin);
  const gananciaNeta = totalCobrado - totalGastos;

  document.getElementById("resumen-mes").innerHTML = `
    <div class="resumen-caja"><span class="numero">${formatoPesos(totalPrestado)}</span><span class="etiqueta">Prestado en ${etiquetaPeriodo}</span></div>
    <div class="resumen-caja"><span class="numero">${formatoPesos(totalCobrado)}</span><span class="etiqueta">Cobrado en ${etiquetaPeriodo}</span></div>
    <div class="resumen-caja"><span class="numero">${formatoPesos(gananciaNeta)}</span><span class="etiqueta">Ganancia neta</span></div>`;

  verificarRecordatorioRespaldo();
}

document.getElementById("reporte-fecha-dia").addEventListener("change", cargarReporteMes);
document.getElementById("reporte-mes").addEventListener("change", cargarReporteMes);
document.getElementById("reporte-anio").addEventListener("change", cargarReporteMes);

async function descargarRespaldo() {
  const { data: pagos, error } = await supabaseClient
    .from("pagos").select("fecha_pago, monto_pagado, estado, prestamos(clientes(nombre))").order("fecha_pago", { ascending: false });
  if (error) { mostrarAlerta("Error al generar el respaldo: " + error.message); return; }

  const etiquetas = { pago: "Pago completo", parcial: "Pago parcial", no_pago: "No pago" };
  let contenidoCSV = "Fecha;Cliente;Estado;Monto Pagado\n";
  pagos.forEach(p => {
    const nombreCliente = p.prestamos && p.prestamos.clientes ? p.prestamos.clientes.nombre : "Sin nombre";
    contenidoCSV += `${p.fecha_pago};"${nombreCliente}";${etiquetas[p.estado] || p.estado};${p.monto_pagado}\n`;
  });

  const blob = new Blob(["\uFEFF" + contenidoCSV], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `respaldo-cobros-${obtenerFechaLocal()}.csv`;
  enlace.click();
  URL.revokeObjectURL(url);

  localStorage.setItem("ultimoRespaldo", obtenerFechaLocal());
  document.getElementById("respaldo-recordatorio").classList.add("oculto");
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

