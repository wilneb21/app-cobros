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
  // ver "Usar capital inicial" en la caja diaria para aplicarlo a un día.
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
