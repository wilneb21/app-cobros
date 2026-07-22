// --- CAJA DIARIA Y EFECTIVO PROPIO ---
// Cuadre automático/manual de caja, base sugerida, y aportes de efectivo
// propio del cobrador (separado de los cobros de cartera).

// --- CUADRE AUTOMÁTICO DE CAJA ---
// La caja siempre trabaja en modo AUTOMÁTICO: cada día abre sola, usando la
// fórmula (base de ayer + cobros + aportes − gastos − prestado) como la base
// real de hoy, sin que nadie la confirme a mano ni cuente el efectivo físico.
// Ya no existe el modo manual ni un toggle en Configuración para volver a él;
// de todas formas se puede tocar "🧮 Contar caja física" cuando se quiera
// hacer una revisión puntual, sin que eso cambie el modo.
async function obtenerPreferenciaCajaAutomatica() {
  return true;
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
    supabaseClient.from("pagos").select("id, monto_pagado, estado, prestamos(clientes(nombre))").eq("fecha_pago", fechaVista),
    supabaseClient.from("gastos").select("id, concepto, monto").eq("fecha", fechaVista),
    supabaseClient.from("prestamos").select("id, monto_prestado, prestamo_anterior_id, fecha_inicio, clientes(nombre)").eq("fecha_inicio", fechaVista),
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
    : `<span class="caja-fecha-vista">📅 ${formatoFecha(fechaVista)} (solo lectura)</span> <button type="button" class="link-ver-otro-dia" onclick="volverACajaDeHoy()">← Volver a hoy</button>`;

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

  // --- MOVIMIENTOS DEL DÍA: préstamos entregados, cobros recibidos (uno por
  // cliente), gastos y aportes propios, todos juntos en un solo detalle. Va
  // escondido por defecto (<details> nativo) para no llenar la pantalla — el
  // cobrador lo despliega solo si quiere ver el detalle completo del día.
  const listaPagosMov = (pagos.data || []).filter(p => Number(p.monto_pagado) > 0);
  const listaGastosMov = gastos.data || [];
  const listaPrestamosMov = prestamos.data || [];
  // Los aportes propios NO se repiten aquí — ya se ven justo abajo, en su
  // propia lista editable (con ✏️/🗑️). Este detalle es para lo que hoy NO
  // tenía forma de verse uno por uno: préstamos entregados, cada cobro
  // recibido y cada gasto.
  const totalMovimientos = listaPrestamosMov.length + listaPagosMov.length + listaGastosMov.length;
  const movimientosHtml = totalMovimientos === 0 ? "" : `
    <details class="detalle-movimientos-dia">
      <summary>▸ Ver movimientos de ${esHoy ? "hoy" : "este día"} (${totalMovimientos})</summary>
      <div class="lista-movimientos-dia">
        ${listaPrestamosMov.map(p => `
          <div class="fila-movimiento"><span>📤 Préstamo a ${escaparHtml(p.clientes?.nombre || "Cliente eliminado")}${p.prestamo_anterior_id ? " (renovación)" : ""}</span><span class="tono-peligro-texto">-${formatoPesos(p.monto_prestado)}</span></div>`).join("")}
        ${listaPagosMov.map(p => `
          <div class="fila-movimiento"><span>💰 Cobro a ${escaparHtml(p.prestamos?.clientes?.nombre || "Cliente eliminado")}</span><span class="tono-exito-texto">+${formatoPesos(p.monto_pagado)}</span></div>`).join("")}
        ${listaGastosMov.map(g => `
          <div class="fila-movimiento"><span>💸 Gasto: ${escaparHtml(g.concepto || "Sin concepto")}</span><span class="tono-peligro-texto">-${formatoPesos(g.monto)}</span></div>`).join("")}
      </div>
    </details>`;

  const listaAportesHtml = listaAportes.length === 0 ? "" : `
    <div class="caja-lista-aportes">
      ${listaAportes.map(a => `
        <div class="fila-aporte">
          <span>+${formatoPesos(a.monto)}${a.nota ? ` · ${escaparHtml(a.nota)}` : ""}</span>
          ${esHoy ? `<span class="acciones-aporte">
            <span onclick="editarAportePropio(${a.id})" title="Editar" role="button" tabindex="0" aria-label="Editar aporte">✏️</span>
            <span onclick="eliminarAportePropio(${a.id})" title="Eliminar" role="button" tabindex="0" aria-label="Eliminar aporte">🗑️</span>
          </span>` : ""}
        </div>`).join("")}
    </div>`;

  contenedor.innerHTML = `
    <div class="caja-cabecera"><div><span>Caja diaria</span><strong>${!caja.data ? "Sin abrir" : !esHoy ? "Cerrada" : automatica ? (hayConteo ? "🧮 Automática · ✅ Verificada hoy" : "🧮 Automática · ⏳ Sin verificar hoy") : "Jornada en curso"}</strong></div>${botonAccion}</div>
    <div class="caja-subcabecera">${encabezadoFecha}${botonReabrir}</div>
    ${avisoOffline}
    ${avisoRacha}
    <div class="caja-metricas"><span>Base <b>${formatoPesos(base)}</b>${editarBase}</span><span>Cobros <b>${formatoPesos(cobros)}</b></span>${aportesDia > 0 ? `<span>Aporte propio <b>+${formatoPesos(aportesDia)}</b></span>` : ""}<span>Prestado (efectivo) <b>-${formatoPesos(prestado)}</b></span><span>Gastos <b>-${formatoPesos(gastosDia)}</b></span></div>
    ${movimientosHtml}
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

// Recalcula hacia ADELANTE la base de cada día de caja, empezando desde el
// capital inicial configurado — para cuando corriges el capital inicial
// (monto o fecha) DESPUÉS de que la caja ya llevaba días abriéndose sola sin
// ese dato, y quieres que esos días queden acordes con la fecha correcta.
// Reglas para no pisar nada real:
//  - Si un día YA se cerró (tiene efectivo_final contado), no se le toca la
//    base: se usa su efectivo_final real como punto de partida del día
//    siguiente, igual que hace el cálculo automático normal.
//  - Si un día está abierto pero sin contar, se recalcula su base.
//  - Si faltan días sin ningún registro de caja en el rango, se crean.
async function recalcularCajaDesdeCapitalInicial(pedirConfirmacion = true) {
  if (!requiereConexion()) return;
  const capital = await obtenerCapitalInicial(true);
  if (!capital || !capital.fecha) { mostrarAlerta("Primero configura tu capital inicial (con fecha) en Configuración > Cartera / capital inicial."); return; }

  const hoy = obtenerFechaLocal();
  if (capital.fecha > hoy) { mostrarAlerta("La fecha de tu capital inicial es futura — no hay nada que recalcular todavía."); return; }

  if (pedirConfirmacion) {
    const confirmado = await mostrarConfirmacion(`Esto revisa la caja día por día desde el ${formatoFecha(capital.fecha)} hasta hoy, y ajusta la base de los días que NO hayas cerrado a mano (los que ya contaste el efectivo no se tocan). ¿Continuar?`);
    if (!confirmado) return;
  }

  const [{ data: cajaExistente }, { data: pagosRango }, { data: gastosRango }, { data: prestamosRango }, { data: aportesRango }] = await Promise.all([
    supabaseClient.from("caja_diaria").select("*").gte("fecha", capital.fecha).lte("fecha", hoy),
    supabaseClient.from("pagos").select("monto_pagado, fecha_pago").gte("fecha_pago", capital.fecha).lte("fecha_pago", hoy),
    supabaseClient.from("gastos").select("monto, fecha").gte("fecha", capital.fecha).lte("fecha", hoy),
    supabaseClient.from("prestamos").select("monto_prestado, prestamo_anterior_id, fecha_inicio").gte("fecha_inicio", capital.fecha).lte("fecha_inicio", hoy),
    supabaseClient.from("aportes_capital").select("monto, fecha").gte("fecha", capital.fecha).lte("fecha", hoy)
  ]);

  const cajaPorFecha = {};
  (cajaExistente || []).forEach(c => cajaPorFecha[c.fecha] = c);
  const cobrosPorFecha = {};
  (pagosRango || []).forEach(p => cobrosPorFecha[p.fecha_pago] = (cobrosPorFecha[p.fecha_pago] || 0) + Number(p.monto_pagado));
  const gastosPorFecha = {};
  (gastosRango || []).forEach(g => gastosPorFecha[g.fecha] = (gastosPorFecha[g.fecha] || 0) + Number(g.monto));
  const aportesPorFecha = {};
  (aportesRango || []).forEach(a => aportesPorFecha[a.fecha] = (aportesPorFecha[a.fecha] || 0) + Number(a.monto));
  const prestamosPorFecha = {};
  (prestamosRango || []).forEach(p => (prestamosPorFecha[p.fecha_inicio] = prestamosPorFecha[p.fecha_inicio] || []).push(p));

  const user = await obtenerUsuarioActual();
  let diasActualizados = 0;
  let huboFaltante = false;
  let baseParaHoy = capital.monto; // arrastre entre iteraciones
  let fecha = capital.fecha;

  while (fecha <= hoy) {
    const filaExistente = cajaPorFecha[fecha];
    const verificado = filaExistente && filaExistente.efectivo_final !== null && filaExistente.efectivo_final !== undefined;

    let baseUsadaHoy;
    if (verificado) {
      // Día ya cerrado a mano: se respeta tal cual, no se toca.
      baseUsadaHoy = Number(filaExistente.base_inicial);
    } else {
      baseUsadaHoy = fecha === capital.fecha ? capital.monto : Math.max(0, Math.round(baseParaHoy));
      if (baseParaHoy < 0) huboFaltante = true;
      if (!filaExistente || Number(filaExistente.base_inicial) !== baseUsadaHoy) {
        await supabaseClient.from("caja_diaria").upsert(
          { user_id: user.id, fecha, base_inicial: baseUsadaHoy, efectivo_final: filaExistente?.efectivo_final ?? null },
          { onConflict: "user_id,fecha" }
        );
        diasActualizados++;
      }
    }

    const cobros = cobrosPorFecha[fecha] || 0;
    const gastosDia = gastosPorFecha[fecha] || 0;
    const aportesDia = aportesPorFecha[fecha] || 0;
    const prestado = await calcularDesembolsoReal(prestamosPorFecha[fecha]);
    baseParaHoy = verificado ? Number(filaExistente.efectivo_final) : baseUsadaHoy + cobros + aportesDia - gastosDia - prestado;

    fecha = sumarDias(fecha, 1);
  }

  mostrarAlerta(`✅ Caja recalculada: ${diasActualizados} día(s) ajustado(s) desde el ${formatoFecha(capital.fecha)}.${huboFaltante ? " ⚠️ En algún punto el cálculo dio negativo (prestaste/gastaste más efectivo del que había) — revisa esos días." : ""}`);
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
