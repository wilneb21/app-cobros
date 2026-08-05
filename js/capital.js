// --- CARTERA / CAPITAL INICIAL DEL NEGOCIO ---
// Esto NO es la base diaria de la caja (esa cambia cada día, ver caja.js).
// Es el monto de una sola vez con el que el negocio empezó a operar —por
// ejemplo, los $500.000 con los que arrancaste a prestar la primera vez—,
// para que todos los reportes puedan mostrar "desde cuánto" partió todo.
// Vive en preferencias_usuario (capital_inicial, capital_inicial_fecha).

let capitalInicialCache = null; // { monto, fecha } | null si nunca se ha configurado

async function obtenerCapitalInicial(forzar) {
  if (capitalInicialCache && !forzar) return capitalInicialCache;
  const user = await obtenerUsuarioActual();
  const { data, error } = await supabaseClient
    .from("preferencias_usuario").select("capital_inicial, capital_inicial_fecha").eq("user_id", user.id).maybeSingle();
  if (error) { capitalInicialCache = null; return null; }
  if (data?.capital_inicial === null || data?.capital_inicial === undefined) { capitalInicialCache = null; return null; }
  capitalInicialCache = { monto: Number(data.capital_inicial), fecha: data.capital_inicial_fecha };
  return capitalInicialCache;
}

// Pinta la tarjeta de Reportes y la línea de Configuración con el valor actual.
async function pintarCapitalInicial() {
  const capital = await obtenerCapitalInicial(true);
  const tarjeta = document.getElementById("tarjeta-capital-inicial");
  const detalleConfig = document.getElementById("fila-config-capital-detalle");

  if (!capital) {
    if (tarjeta) tarjeta.classList.add("oculto");
    if (detalleConfig) detalleConfig.textContent = "Aún no la has configurado — tócala para hacerlo";
    return;
  }

  if (tarjeta) {
    tarjeta.classList.remove("oculto");
    document.getElementById("capital-inicial-monto").textContent = formatoPesos(capital.monto);
    document.getElementById("capital-inicial-fecha").textContent = capital.fecha ? `desde el ${formatoFecha(capital.fecha)}` : "";
  }
  if (detalleConfig) detalleConfig.textContent = `${formatoPesos(capital.monto)}${capital.fecha ? ` · desde el ${formatoFecha(capital.fecha)}` : ""}`;
}

// Configura o corrige el capital inicial. Se puede tocar más de una vez (por
// ejemplo si te equivocaste la primera vez); cada cambio queda fechado en
// historial_capital_inicial, igual que el historial de orden de rutas.
async function configurarCapitalInicial() {
  if (!requiereConexion()) return;
  const actual = await obtenerCapitalInicial(true);

  const monto = await mostrarPrompt(
    actual ? "Corrige la cartera con la que empezó el negocio:" : "¿Con cuánto dinero empezaste a operar el negocio? Este es el punto de partida de todos tus reportes (por ejemplo, $500.000). Solo se configura una vez, pero puedes corregirlo después.",
    actual ? Math.round(actual.monto) : "0", true
  );
  if (monto === null) return;
  const montoLimpio = Number(String(monto).replace(/\D/g, "")) || 0;
  if (montoLimpio < 0) { mostrarAlerta("Ingresa un valor válido."); return; }

  // La fecha también se puede corregir cada vez (no solo la primera vez):
  // si te equivocaste al escribirla, aquí se ajusta sin dejar rastros raros.
  // OJO: esto NO reacomoda solos los días de caja que ya se hayan abierto —
  // por eso, al guardar, se ofrece "recalcularCajaDesdeCapitalInicial" abajo
  // para ajustar automáticamente los días no cerrados.
  const fechaTexto = await mostrarPrompt(
    "¿Desde qué fecha? (formato AAAA-MM-DD)",
    actual?.fecha || obtenerFechaLocal()
  );
  if (fechaTexto === null) return;
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(String(fechaTexto).trim());
  if (!valida) { mostrarAlerta("Escribe la fecha en formato AAAA-MM-DD, por ejemplo 2026-07-15."); return; }
  const fecha = fechaTexto.trim();

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("preferencias_usuario")
    .upsert({ user_id: user.id, capital_inicial: montoLimpio, capital_inicial_fecha: fecha }, { onConflict: "user_id" });
  if (error) { mostrarAlerta("No fue posible guardar la cartera inicial: " + traducirErrorSupabase(error)); return; }

  await supabaseClient.from("historial_capital_inicial").insert({
    user_id: user.id, monto_anterior: actual ? actual.monto : null, monto_nuevo: montoLimpio
  });

  mostrarAlerta("✅ Cartera inicial guardada.");
  await pintarCapitalInicial();
  if (typeof cargarReporteMes === "function" && !document.getElementById("seccion-reportes").classList.contains("oculto")) cargarReporteMes();

  // Si ya existía capital inicial y lo estás corrigiendo (monto o fecha), lo
  // más probable es que la caja de esos días ya se haya abierto sin este
  // dato — se ofrece ajustarla de una vez para que quede acorde, sin
  // tocar los días que ya cerraste a mano.
  if (typeof recalcularCajaDesdeCapitalInicial === "function") {
    const quiereRecalcular = await mostrarConfirmacion("¿Quieres que ajuste también la caja de los días desde esa fecha, para que coincida con este capital inicial? (los días que ya cerraste a mano no se tocan)");
    if (quiereRecalcular) await recalcularCajaDesdeCapitalInicial(false);
  }
}

// --- DÍA DE CORTE DEL CICLO DE UTILIDAD ---
// Algunos negocios no cierran cuentas el día 1 de cada mes calendario, sino
// en una fecha propia (ej. del 29 al 28, o del 30 al 29). Este valor le dice
// a Reportes en qué día reiniciar a $0 la columna "Utilidad acum." del Libro
// diario. Por defecto es 1 (día 1 de cada mes), que es como ya venía
// funcionando la app. Vive en preferencias_usuario.dia_corte_utilidad.

let diaCorteUtilidadCache = null; // número 1-31, null si aún no se ha cargado

async function obtenerDiaCorteUtilidad(forzar) {
  if (diaCorteUtilidadCache !== null && !forzar) return diaCorteUtilidadCache;
  const user = await obtenerUsuarioActual();
  const { data, error } = await supabaseClient
    .from("preferencias_usuario").select("dia_corte_utilidad").eq("user_id", user.id).maybeSingle();
  // Si no hay error pero tampoco hay fila/columna aún (cuenta nueva, o la
  // migración no se ha corrido), se asume el día 1 — mismo comportamiento
  // de siempre, para que nadie note el cambio hasta que lo configure.
  diaCorteUtilidadCache = (!error && data?.dia_corte_utilidad) ? Number(data.dia_corte_utilidad) : 1;
  return diaCorteUtilidadCache;
}

// Pinta la línea de Configuración con el valor actual.
async function pintarDiaCorteUtilidad() {
  const dia = await obtenerDiaCorteUtilidad(true);
  const detalleConfig = document.getElementById("fila-config-corte-utilidad-detalle");
  if (detalleConfig) {
    detalleConfig.textContent = dia === 1
      ? "Día 1 de cada mes (por defecto)"
      : `Día ${dia} de cada mes`;
  }
}

// Configura el día en que "Utilidad acum." se reinicia a $0 cada ciclo.
async function configurarDiaCorteUtilidad() {
  if (!requiereConexion()) return;
  const actual = await obtenerDiaCorteUtilidad(true);

  const diaTexto = await mostrarPrompt(
    "¿Qué día del mes cierra tu ciclo de cuentas? Por ejemplo, si cierras del 29 al 28, escribe 29. \"Utilidad acum.\" se reiniciará a $0 ese día de cada mes. Si eliges 29, 30 o 31 y algún mes no tiene ese día (ej. febrero), se usa automáticamente el último día disponible de ese mes.",
    String(actual)
  );
  if (diaTexto === null) return;
  const dia = Number(String(diaTexto).trim());
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    mostrarAlerta("Escribe un número entre 1 y 31.");
    return;
  }

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("preferencias_usuario")
    .upsert({ user_id: user.id, dia_corte_utilidad: dia }, { onConflict: "user_id" });
  if (error) { mostrarAlerta("No fue posible guardar el día de corte: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("✅ Día de corte guardado.");
  await pintarDiaCorteUtilidad();
  if (typeof cargarReporteMes === "function" && !document.getElementById("seccion-reportes").classList.contains("oculto")) cargarReporteMes();
}

// --- DÍA DE INICIO DE SEMANA (para el Reporte semanal) ---
// El Reporte semanal asumía siempre semana calendario lunes-domingo. Este
// valor permite que empiece cualquier otro día, para negocios cuyo ciclo de
// cobro no coincide con la semana calendario (ej. jueves a miércoles).
// 0 = domingo … 6 = sábado (estándar de Date.getDay()). Por defecto 1 (lunes).
const NOMBRES_DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

let diaInicioSemanaCache = null;

async function obtenerDiaInicioSemana(forzar) {
  if (diaInicioSemanaCache !== null && !forzar) return diaInicioSemanaCache;
  const user = await obtenerUsuarioActual();
  const { data, error } = await supabaseClient
    .from("preferencias_usuario").select("dia_inicio_semana").eq("user_id", user.id).maybeSingle();
  diaInicioSemanaCache = (!error && data?.dia_inicio_semana !== null && data?.dia_inicio_semana !== undefined)
    ? Number(data.dia_inicio_semana) : 1;
  return diaInicioSemanaCache;
}

async function pintarDiaInicioSemana() {
  const dia = await obtenerDiaInicioSemana(true);
  const detalleConfig = document.getElementById("fila-config-inicio-semana-detalle");
  if (detalleConfig) {
    detalleConfig.textContent = dia === 1
      ? "Lunes a domingo (por defecto)"
      : `${NOMBRES_DIAS_SEMANA[dia].charAt(0).toUpperCase()}${NOMBRES_DIAS_SEMANA[dia].slice(1)} a ${NOMBRES_DIAS_SEMANA[(dia + 6) % 7]}`;
  }
}

async function configurarDiaInicioSemana() {
  if (!requiereConexion()) return;
  const actual = await obtenerDiaInicioSemana(true);

  const opciones = NOMBRES_DIAS_SEMANA.map((n, i) => `${i} = ${n}`).join(", ");
  const diaTexto = await mostrarPrompt(
    `¿Qué día empieza tu semana de cobro para el "Reporte semanal"? Escribe el número: ${opciones}.`,
    String(actual)
  );
  if (diaTexto === null) return;
  const dia = Number(String(diaTexto).trim());
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
    mostrarAlerta("Escribe un número entre 0 (domingo) y 6 (sábado).");
    return;
  }

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("preferencias_usuario")
    .upsert({ user_id: user.id, dia_inicio_semana: dia }, { onConflict: "user_id" });
  if (error) { mostrarAlerta("No fue posible guardar el día de inicio de semana: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("✅ Día de inicio de semana guardado.");
  await pintarDiaInicioSemana();
  if (typeof cargarReporteMes === "function" && !document.getElementById("seccion-reportes").classList.contains("oculto")) cargarReporteMes();
}