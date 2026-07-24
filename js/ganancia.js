// --- UTILIDAD POR PRÉSTAMOS (tarjeta de Inicio) ---
// Muestra dos cosas, ambas con selector Diaria / Semanal / Mensual:
//  1) La utilidad "al estilo libro de William": se cuenta desde el día en
//     que se ENTREGA el préstamo, no cuando el cliente lo va pagando poco a
//     poco. Si hoy prestas $500.000 con 20% de interés, la utilidad de HOY
//     es $100.000 completos — sin importar cuándo termine de pagar. Misma
//     fórmula que ya usa la pantalla de Reportes (calcularUtilidadPorPrestamos
//     en reportes.js), para que los dos números siempre cuadren entre sí.
//  2) Si la cartera activa (lo que la calle todavía te debe) subió o bajó
//     comparando el día de hoy contra el inicio del período elegido.
// Además muestra, aparte, la utilidad ACUMULADA de todos los préstamos
// hechos desde siempre (calcularUtilidadHistoricaTotal, también compartida
// con Reportes).

let periodoGananciaActivo = "diaria";

function cambiarPeriodoGanancia(periodo) {
  periodoGananciaActivo = periodo;
  document.querySelectorAll("[data-periodo-ganancia]").forEach(btn =>
    btn.classList.toggle("activa", btn.dataset.periodoGanancia === periodo)
  );
  cargarGananciaInicio();
}

// Calcula el rango de fechas del período elegido y la fecha "anterior" contra
// la que se compara la cartera para saber si aumentó o disminuyó.
function obtenerRangoGanancia(periodo) {
  const hoy = obtenerFechaLocal();
  const finExclusivo = sumarDias(hoy, 1); // límite superior exclusivo para incluir "hoy" completo

  if (periodo === "semanal") {
    const lunes = obtenerLunesDeSemana(hoy);
    return { inicio: lunes, fin: finExclusivo, etiqueta: "esta semana", etiquetaCorta: "semana", fechaCarteraAnterior: sumarDias(lunes, -1) };
  }
  if (periodo === "mensual") {
    const inicioMes = hoy.substring(0, 7) + "-01";
    return { inicio: inicioMes, fin: finExclusivo, etiqueta: "este mes", etiquetaCorta: "mes", fechaCarteraAnterior: sumarDias(inicioMes, -1) };
  }
  return { inicio: hoy, fin: finExclusivo, etiqueta: "hoy", etiquetaCorta: "día", fechaCarteraAnterior: sumarDias(hoy, -1) };
}

async function cargarGananciaInicio() {
  const cajaPeriodo = document.getElementById("ganancia-periodo-caja");
  const cajaAcumulada = document.getElementById("ganancia-acumulada");
  const cajaCartera = document.getElementById("cartera-tendencia-periodo");
  if (!cajaPeriodo) return;

  cajaPeriodo.innerHTML = `<div class="cargando">⏳ Cargando...</div>`;
  cajaCartera.innerHTML = "";

  const rango = obtenerRangoGanancia(periodoGananciaActivo);
  const hoy = obtenerFechaLocal();

  // calcularUtilidadPorPrestamos y calcularUtilidadHistoricaTotal viven en
  // reportes.js: es la misma cuenta que ya usa la pantalla de Reportes, para
  // no tener dos fórmulas distintas de "utilidad" en la app.
  const [utilidadPeriodo, utilidadTotal, carteraHoy, carteraAnterior] = await Promise.all([
    calcularUtilidadPorPrestamos(rango.inicio, rango.fin),
    calcularUtilidadHistoricaTotal(),
    supabaseClient.rpc("cartera_activa_en_fecha", { p_fecha: hoy }),
    supabaseClient.rpc("cartera_activa_en_fecha", { p_fecha: rango.fechaCarteraAnterior })
  ]);

  cajaPeriodo.innerHTML = `
    <div class="resumen-caja tono-primario">
      <span class="numero">${formatoPesos(utilidadPeriodo)}</span>
      <span class="etiqueta">Utilidad · ${rango.etiqueta}</span>
      <span class="subetiqueta">Interés de lo prestado ${rango.etiqueta}, sin restar gastos</span>
    </div>`;

  cajaAcumulada.innerHTML = `💰 Utilidad total acumulada desde que empezaste: <strong>${formatoPesos(utilidadTotal)}</strong>`;

  if (carteraHoy.error || carteraAnterior.error) {
    cajaCartera.innerHTML = `<span class="texto-ayuda">No fue posible calcular la tendencia de cartera. Verifica que la función "cartera_activa_en_fecha" esté instalada en Supabase.</span>`;
    return;
  }

  const valorCarteraHoy = Number(carteraHoy.data) || 0;
  const valorCarteraAnterior = Number(carteraAnterior.data) || 0;
  const diferencia = valorCarteraHoy - valorCarteraAnterior;
  const sube = diferencia >= 0;
  const variacionTexto = valorCarteraAnterior > 0
    ? `${Math.abs((diferencia / valorCarteraAnterior) * 100).toFixed(1)}%`
    : (diferencia === 0 ? "0%" : formatoPesos(Math.abs(diferencia)));
  const referencia = periodoGananciaActivo === "diaria" ? "desde ayer" : `desde el inicio del ${rango.etiquetaCorta}`;

  cajaCartera.innerHTML = `
    <span class="${sube ? "tendencia-sube" : "tendencia-baja"}">${sube ? "↗" : "↘"} La cartera ${sube ? "aumentó" : "disminuyó"} ${variacionTexto} ${referencia}</span>
    <small>Cartera activa hoy: ${formatoPesos(valorCarteraHoy)}</small>`;
}
