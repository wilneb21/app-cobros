// --- GANANCIA POR INTERESES (tarjeta de Inicio) ---
// Muestra dos cosas, ambas con selector Diaria / Semanal / Mensual:
//  1) Cuánto ganaste por intereses en el período elegido (valor bruto: solo
//     la parte de interés de cada pago, sin restar gastos).
//  2) Si la cartera activa (lo que la calle todavía te debe) subió o bajó
//     comparando el día de hoy contra el inicio del período elegido.
// Además muestra, aparte, la ganancia bruta ACUMULADA desde el primer pago
// que registraste en la app (desde que "empezaste con los créditos").

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

// Ganancia bruta acumulada de TODA la vida de la cuenta (desde el primer pago
// registrado), sin límite de fechas. Es la misma fórmula que usa Reportes:
// de cada pago, solo la fracción interés% / (100 + interés%) es ganancia real;
// el resto es capital propio que regresa.
async function calcularGananciaAcumuladaTotal() {
  const { data: pagos, error } = await supabaseClient
    .from("pagos").select("monto_pagado, prestamos(interes_porcentaje)");
  if (error || !pagos) return 0;
  const gananciaIntereses = pagos.reduce((total, p) => {
    const interes = Number(p.prestamos?.interes_porcentaje) || 0;
    const fraccionGanancia = interes / (100 + interes);
    return total + Number(p.monto_pagado) * fraccionGanancia;
  }, 0);
  // La mora aplicada de verdad (no el estimado en pantalla) también es ganancia,
  // igual que en Reportes. Si la migración 20260720 no está instalada, se ignora.
  const { data: cargosMora } = await supabaseClient.from("cargos_mora").select("monto");
  const gananciaMora = (cargosMora || []).reduce((s, c) => s + Number(c.monto), 0);
  return gananciaIntereses + gananciaMora;
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

  const [gananciaIntereses, moraDelPeriodo, gananciaTotal, carteraHoy, carteraAnterior] = await Promise.all([
    calcularGananciaPorIntereses(rango.inicio, rango.fin),
    calcularMoraCobrada(rango.inicio, rango.fin),
    calcularGananciaAcumuladaTotal(),
    supabaseClient.rpc("cartera_activa_en_fecha", { p_fecha: hoy }),
    supabaseClient.rpc("cartera_activa_en_fecha", { p_fecha: rango.fechaCarteraAnterior })
  ]);
  const gananciaPeriodo = gananciaIntereses + moraDelPeriodo;

  cajaPeriodo.innerHTML = `
    <div class="resumen-caja tono-primario">
      <span class="numero">${formatoPesos(gananciaPeriodo)}</span>
      <span class="etiqueta">Ganancia bruta · ${rango.etiqueta}</span>
      <span class="subetiqueta">Intereses + mora cobrada, sin restar gastos</span>
    </div>`;

  cajaAcumulada.innerHTML = `💰 Ganancia bruta acumulada desde que empezaste: <strong>${formatoPesos(gananciaTotal)}</strong>`;

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
