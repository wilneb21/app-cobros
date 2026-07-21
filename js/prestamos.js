function toggleCampoMora() {
  const check = document.getElementById("prestamo-mora-check");
  document.getElementById("prestamo-mora-porcentaje").classList.toggle("oculto", !check.checked);
}

function actualizarVistaPreviaPrestamo() {
  const monto = obtenerValorNumerico(document.getElementById("prestamo-monto"));
  const interes = parseFloat(document.getElementById("prestamo-interes").value) || 0;
  const cuotas = parseInt(document.getElementById("prestamo-cuotas").value, 10);
  const vista = document.getElementById("vista-previa-prestamo");
  if (!monto || !cuotas || cuotas <= 0 || interes < 0) {
    vista.textContent = "Ingresa monto, interés y cuotas para ver el valor aproximado de cada cuota.";
    return;
  }
  const total = calcularTotalConInteres(monto, interes);
  const cuota = total / cuotas;
  vista.innerHTML = `<strong>Total a cobrar: ${formatoPesos(total)}</strong><span>${cuotas} cuotas aproximadas de ${formatoPesos(cuota)}</span>`;
}

async function cargarClientesEnSelector(clienteSeleccionadoId = "") {
  const { data, error } = await supabaseClient.from("clientes").select("id, nombre").eq("archivado", false).order("nombre");
  if (error) { console.error(error); return; }
  const selector = document.getElementById("prestamo-cliente");
  selector.innerHTML = '<option value="">Selecciona un cliente</option>';
  data.forEach(c => selector.innerHTML += `<option value="${c.id}">${escaparHtml(c.nombre)}</option>`);
  if (!document.getElementById("prestamo-fecha").value) document.getElementById("prestamo-fecha").value = obtenerFechaLocal();
  if (clienteSeleccionadoId) selector.value = String(clienteSeleccionadoId);
}

async function crearPrestamo(event) {
  event.preventDefault();
  if (!navigator.onLine) {
    mostrarAlerta("📴 Sin conexión. Crear un préstamo nuevo necesita señal — el modo offline solo guarda cobros de préstamos que ya existen. Intenta de nuevo cuando vuelva la señal.");
    return;
  }
  let clienteId = document.getElementById("prestamo-cliente").value;
  const monto = obtenerValorNumerico(document.getElementById("prestamo-monto"));
  const interes = parseFloat(document.getElementById("prestamo-interes").value) || 0;
  const numeroCuotas = parseInt(document.getElementById("prestamo-cuotas").value);
  const frecuencia = document.getElementById("prestamo-frecuencia").value;
  const fechaInicio = document.getElementById("prestamo-fecha").value;
  const moraHabilitada = document.getElementById("prestamo-mora-check").checked;
  const moraPorcentaje = moraHabilitada ? (parseFloat(document.getElementById("prestamo-mora-porcentaje").value) || 0) : 0;
  if (!fechaInicio || !validarMontoPositivo(monto, "El monto prestado") || !Number.isInteger(numeroCuotas) || numeroCuotas <= 0 || interes < 0 || moraPorcentaje < 0) {
    mostrarAlerta("Revisa los valores del préstamo: cuotas enteras y porcentajes no negativos.");
    return;
  }

  const totalConInteres = calcularTotalConInteres(monto, interes);
  const cuota = Math.round((totalConInteres / numeroCuotas) * 100) / 100;
  const user = await obtenerUsuarioActual();

  if (!clienteId) { mostrarAlerta("Selecciona un cliente. Si aún no existe, créalo primero desde la pestaña Clientes."); return; }

  const { error } = await supabaseClient.from("prestamos").insert({
    cliente_id: clienteId, monto_prestado: monto, interes_porcentaje: interes,
    cuota, numero_cuotas: numeroCuotas, frecuencia, fecha_inicio: fechaInicio,
    estado: "activo", user_id: user.id,
    interes_mora_habilitado: moraHabilitada, interes_mora_porcentaje: moraPorcentaje
  });

  if (error) {
    mostrarAlerta("Error al crear préstamo: " + traducirErrorSupabase(error));
    return;
  }

  document.getElementById("prestamo-monto").value = "";
  document.getElementById("prestamo-interes").value = "";
  document.getElementById("prestamo-cuotas").value = "";
  document.getElementById("prestamo-fecha").value = "";
  document.getElementById("prestamo-mora-check").checked = false;
  document.getElementById("prestamo-mora-porcentaje").value = "";
  document.getElementById("prestamo-mora-porcentaje").classList.add("oculto");
  document.getElementById("prestamo-cliente").value = "";
  cargarClientesEnSelector();
  cargarClientes();
  mostrarAlerta("✅ Préstamo registrado con éxito");
}

// --- COBRAR ---
let clientesCobrarCache = [];
let clientesConSaldoIds = new Set();
let filtroEstadoCobrar = "todos";

async function cargarClientesParaCobrar() {
  mostrarCargando("lista-clientes-cobrar");
  const { data: clientes, error } = await supabaseClient.from("clientes").select("*, rutas(nombre)").eq("archivado", false).order("nombre");
  if (error) { mostrarAlerta("No fue posible cargar los clientes para cobrar."); return; }
  clientes.sort(compararClientesPorRutaYOrden);
  clientesCobrarCache = clientes;
  const ids = (clientes || []).map(cliente => cliente.id);
  const { data: prestamosActivos } = ids.length
    ? await supabaseClient.from("prestamos").select("cliente_id").in("cliente_id", ids).eq("estado", "activo")
    : { data: [] };
  clientesConSaldoIds = new Set((prestamosActivos || []).map(prestamo => prestamo.cliente_id));
  actualizarSelectorFiltroRuta(clientes);
  filtrarClientesCobrar();
}

async function cargarCuentasPorCobrar() {
  const activas = document.getElementById("lista-cuentas-activas");
  const pagados = document.getElementById("lista-clientes-pagados");
  activas.innerHTML = '<div class="cargando">Cargando cuentas...</div>';
  const { data: prestamos, error } = await supabaseClient
    .from("prestamos").select("id, cliente_id, monto_prestado, interes_porcentaje, mora_acumulada, cuota, frecuencia, fecha_inicio, clientes(id, nombre, telefono, rutas(nombre))")
    .eq("estado", "activo").order("fecha_inicio");
  if (error) { activas.textContent = "No fue posible cargar las cuentas por cobrar."; return; }
  const ids = (prestamos || []).map(p => p.id);
  const { data: pagos } = ids.length ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", ids) : { data: [] };
  const acumulados = {};
  (pagos || []).forEach(p => acumulados[p.prestamo_id] = (acumulados[p.prestamo_id] || 0) + Number(p.monto_pagado));

  activas.innerHTML = !prestamos?.length ? '<div class="estado-vacio">🎉 No tienes cuentas activas por cobrar.</div>' : prestamos.map(p => {
    const saldo = calcularSaldoPendiente(p, acumulados[p.id] || 0);
    return `<div class="tarjeta tarjeta-cuenta" onclick="abrirDetalleCliente(${p.cliente_id})"><div><strong>${escaparHtml(p.clientes?.nombre || "Cliente")}</strong><span>${escaparHtml(p.clientes?.rutas?.nombre || "Sin ruta")} · ${p.frecuencia}</span></div><div class="cuenta-saldo"><small>Saldo</small><b>${formatoPesos(saldo)}</b><span>Cuota: ${formatoPesos(p.cuota)}</span></div></div>`;
  }).join("");

  const { data: finalizados, error: errorFinalizados } = await supabaseClient
    .from("prestamos").select("cliente_id, clientes(id, nombre, telefono, rutas(nombre))").eq("estado", "pagado");
  if (errorFinalizados) { pagados.textContent = "No fue posible cargar los clientes finalizados."; return; }
  const clientesUnicos = [...new Map((finalizados || []).filter(p => p.clientes).map(p => [p.cliente_id, p.clientes])).values()];
  pagados.innerHTML = !clientesUnicos.length ? '<div class="estado-vacio">Aún no hay clientes con cuentas finalizadas.</div>' : clientesUnicos.map(c => `<div class="fila-finalizada" onclick="abrirDetalleCliente(${c.id})"><span>✓</span><div><strong>${escaparHtml(c.nombre)}</strong><small>${escaparHtml(c.rutas?.nombre || "Sin ruta")}</small></div><b>Ver historial</b></div>`).join("");
}

// Llena el selector de "filtrar por ruta" con las rutas que realmente tienen clientes
function actualizarSelectorFiltroRuta(clientes) {
  const selector = document.getElementById("filtro-ruta-cobrar");
  const valorPrevio = selector.value;
  const rutasUnicas = [...new Map(
    clientes.filter(c => c.rutas).map(c => [c.ruta_id, c.rutas.nombre])
  ).entries()];

  selector.innerHTML = '<option value="">Todas las rutas</option>';
  rutasUnicas.forEach(([id, nombre]) => {
    selector.innerHTML += `<option value="${id}">${escaparHtml(nombre)}</option>`;
  });
  selector.value = valorPrevio;
}

function pintarClientesCobrar(clientes) {
  const contenedor = document.getElementById("lista-clientes-cobrar");

  if (clientes.length === 0) {
    contenedor.innerHTML = `<div class="estado-vacio">🔍 No se encontraron clientes con ese filtro.</div>`;
    return;
  }

  contenedor.innerHTML = "";
  let rutaAnterior = undefined;
  for (const cliente of clientes) {
    const nombreRuta = cliente.rutas ? cliente.rutas.nombre : null;
    if (nombreRuta !== rutaAnterior) {
      contenedor.innerHTML += `<div class="grupo-ruta-titulo">📍 ${nombreRuta ? escaparHtml(nombreRuta) : "Sin ruta asignada"}</div>`;
      rutaAnterior = nombreRuta;
    }
    contenedor.innerHTML += `
      <div class="tarjeta">
        <strong>${escaparHtml(cliente.nombre)}</strong>
        <div id="prestamos-cliente-${cliente.id}" class="prestamos-cliente">Cargando préstamos...</div>
      </div>`;
  }
  for (const cliente of clientes) cargarPrestamosDeCliente(cliente.id);
}

function filtrarClientesCobrar() {
  const texto = document.getElementById("buscar-cliente-cobrar").value.toLowerCase();
  const rutaId = document.getElementById("filtro-ruta-cobrar").value;

  let filtrados = clientesCobrarCache.filter(c => c.nombre.toLowerCase().includes(texto) || (c.cedula || "").includes(texto));
  if (rutaId) filtrados = filtrados.filter(c => String(c.ruta_id) === rutaId);
  if (filtroEstadoCobrar === "saldo") filtrados = filtrados.filter(c => clientesConSaldoIds.has(c.id));
  if (filtroEstadoCobrar === "aldia") filtrados = filtrados.filter(c => !clientesConSaldoIds.has(c.id));

  pintarClientesCobrar(filtrados);
}

function cambiarFiltroCobrar(estado) {
  filtroEstadoCobrar = estado;
  document.querySelectorAll(".chip-cobrar").forEach(chip => chip.classList.toggle("activo", chip.dataset.estadoCobro === estado));
  filtrarClientesCobrar();
}

async function cargarPrestamosDeCliente(clienteId) {
  const { data: prestamos, error } = await supabaseClient
    .from("prestamos").select("*").eq("cliente_id", clienteId).eq("estado", "activo");

  const contenedor = document.getElementById("prestamos-cliente-" + clienteId);
  if (!contenedor) return;
  if (error) { contenedor.innerHTML = "Error al cargar."; return; }
  if (prestamos.length === 0) { contenedor.innerHTML = "<span>Sin préstamos activos</span>"; return; }

  // Antes se pedían los pagos de cada préstamo UNO POR UNO en fila (await dentro
  // de un for): con varios créditos activos y señal de celular lenta, la espera
  // se sumaba por cada uno y la pestaña se podía quedar "Cargando..." mucho
  // tiempo. Ahora se piden todos al mismo tiempo con Promise.all.
  const resultados = await Promise.all(prestamos.map(p =>
    supabaseClient.from("pagos").select("monto_pagado, fecha_pago, estado")
      .eq("prestamo_id", p.id).order("fecha_pago", { ascending: false })
  ));

  if (resultados.some(r => r.error)) { contenedor.textContent = "No fue posible cargar los pagos."; return; }

  const tarjetas = prestamos.map((p, indice) => {
    const pagos = resultados[indice].data;

    const totalPagado = pagos ? pagos.reduce((s, pg) => s + Number(pg.monto_pagado), 0) : 0;
    const moraAcumulada = Number(p.mora_acumulada) || 0;
    const saldoPendiente = calcularSaldoPendiente(p, totalPagado);

    const ultimoPago = pagos && pagos.length > 0 ? pagos[0] : null;
    const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌" };
    const textoUltimo = ultimoPago ? `Último registro: ${formatoFecha(ultimoPago.fecha_pago)} — ${etiquetas[ultimoPago.estado]}` : "Sin pagos registrados";

    let rachaSinPagar = 0;
    if (pagos) for (const pg of pagos) { if (pg.estado === "no_pago") rachaSinPagar++; else break; }
    const textoRacha = rachaSinPagar > 0
      ? `<span class="racha-sin-pagar">⚠️ ${rachaSinPagar} ${rachaSinPagar === 1 ? "día seguido" : "días seguidos"} sin pagar</span>` : "";

    const hoy = new Date(obtenerFechaLocal() + "T00:00:00");
    const fechaInicio = new Date(p.fecha_inicio + "T00:00:00");
    const diasTranscurridos = Math.floor((hoy - fechaInicio) / (1000 * 60 * 60 * 24));
    let cuotasEsperadas = p.frecuencia === "diario" ? diasTranscurridos + 1 : Math.floor(diasTranscurridos / 7) + 1;
    cuotasEsperadas = Math.min(cuotasEsperadas, p.numero_cuotas);
    const montoEsperado = cuotasEsperadas * Number(p.cuota);
    const diferencia = totalPagado - montoEsperado;

    let claseMora, textoMora, recargoTexto = "", montoDebe = 0;
    if (diferencia >= 0) {
      claseMora = "estado-al-dia";
      textoMora = diferencia > 0 ? `🟢 Al día (adelantado ${formatoPesos(diferencia)})` : "🟢 Al día";
    } else {
      montoDebe = Math.round(Math.abs(diferencia));
      claseMora = montoDebe < Number(p.cuota) * 2 ? "estado-atencion" : "estado-mora";
      textoMora = `${claseMora === "estado-atencion" ? "🟡" : "🔴"} Debe ${formatoPesos(montoDebe)}`;

      if (p.interes_mora_habilitado && p.interes_mora_porcentaje > 0) {
        const recargo = Math.round(montoDebe * (p.interes_mora_porcentaje / 100));
        recargoTexto = `<span class="recargo-mora">+ Recargo por mora estimado: ${formatoPesos(recargo)}
          <button type="button" class="btn-aplicar-mora" onclick="aplicarRecargoMora(${p.id}, ${recargo}, ${clienteId})">Aplicar recargo al saldo</button></span>`;
      }
    }
    const moraTexto = moraAcumulada > 0
      ? `<span class="recargo-mora-aplicado">Mora ya aplicada a este crédito: ${formatoPesos(moraAcumulada)}</span>` : "";

    // Antes esta tarjeta mostraba hasta 6 cifras de dinero a la vez (saldo,
    // cuota, debe, recargo estimado, mora aplicada, adelantado). Ahora solo
    // quedan visibles el estado y la cuota — lo mínimo para decidir qué
    // botón tocar — y el resto vive detrás de "Más opciones".
    return `
      <div class="subtarjeta ${claseMora}" id="subtarjeta-${p.id}">
        <div class="fila-resumen-credito">
          <span class="badge-estado">${textoMora}</span>
          <strong class="saldo-credito">Cuota ${formatoPesos(p.cuota)}</strong>
        </div>
        <div class="fila-saldo-restante">
          <span>Saldo para terminar</span>
          <b>${formatoPesos(saldoPendiente)}</b>
        </div>
        <div class="botones-pago">
          <button class="btn-pago pago-si" onclick="registrarPago(${p.id}, ${p.cuota}, 'pago', ${clienteId})">Pagó ✅</button>
          <button class="btn-pago pago-parcial" onclick="abrirRegistrarPago(${p.id}, ${clienteId}, ${montoDebe})">${montoDebe > 0 ? "Registrar pago 💰" : "Parcial ⚠️"}</button>
          <button class="btn-pago pago-no" onclick="registrarPago(${p.id}, 0, 'no_pago', ${clienteId})">No pagó ❌</button>
        </div>
        <button class="btn-pago-completo" onclick="confirmarPagoCompleto(${p.id}, ${saldoPendiente}, ${clienteId})">💯 Pagar saldo total y terminar</button>
        <p class="link-mas-opciones" onclick="toggleMasOpciones(${p.id})">⋯ Más opciones</p>
        <div id="mas-opciones-${p.id}" class="mas-opciones oculto">
          <div class="subinfo-credito">
            <span class="ultimo-registro">${textoUltimo}</span>
            ${textoRacha}
          </div>
          ${recargoTexto}
          ${moraTexto}
          <button class="btn-historial" onclick="verHistorial(${p.id}, ${clienteId})">Ver historial completo</button>
          <div id="historial-${p.id}" class="historial oculto"></div>
          <button class="btn-refinanciar" onclick="refinanciarPrestamo(${p.id}, ${clienteId}, ${saldoPendiente}, ${p.interes_porcentaje}, '${p.frecuencia}')">🔄 Refinanciar crédito</button>
          <button class="btn-eliminar-prestamo" onclick="eliminarPrestamo(${p.id}, ${clienteId})">🗑️ Eliminar préstamo</button>
        </div>
      </div>`;
  });

  contenedor.innerHTML = tarjetas.join("");
}

// Despliega/oculta las acciones secundarias (historial, refinanciar, mora) de
// una tarjeta de cobro, para que la vista de "Cobrar" no se vea tan llena de
// botones — las 3 acciones del día a día (Pagó/Parcial/No pagó) quedan siempre
// visibles y el resto queda a un toque de distancia.
function toggleMasOpciones(prestamoId) {
  document.getElementById("mas-opciones-" + prestamoId)?.classList.toggle("oculto");
}

// Convierte el recargo por mora, hasta ahora solo un estimado en pantalla,
// en un cargo real: lo suma al saldo pendiente del préstamo (mora_acumulada)
// y queda registrado (auditable) en Supabase. Requiere conexión: es un
// cargo de dinero real, no se guarda en cola offline para evitar aplicarlo
// dos veces por accidente si el celular reintenta el envío.
async function aplicarRecargoMora(prestamoId, montoEstimado, clienteId) {
  if (!navigator.onLine) {
    mostrarAlerta("📴 Necesitas conexión para aplicar un recargo de mora, ya que es un cargo real al saldo del cliente.");
    return;
  }
  const confirmado = await mostrarConfirmacion(
    `¿Aplicar un recargo de mora de ${formatoPesos(montoEstimado)} al saldo de este préstamo?<br>Se sumará al saldo pendiente y quedará registrado.`
  );
  if (!confirmado) return;

  const { error } = await supabaseClient.rpc("aplicar_recargo_mora", {
    p_prestamo_id: prestamoId, p_monto: montoEstimado
  });
  if (error) { mostrarAlerta("No fue posible aplicar el recargo: " + traducirErrorSupabase(error)); return; }
  mostrarAlerta("✅ Recargo de mora aplicado al saldo.");
  cargarPrestamosDeCliente(clienteId);
}

// --- ELIMINAR UN PRÉSTAMO MAL REGISTRADO ---
// Igual que eliminarPago pero para el crédito completo: por ejemplo si se
// creó por error (cliente equivocado, monto equivocado, duplicado). Borra
// primero los pagos y cargos de mora asociados (para no dejar historial
// huérfano ni chocar con la relación en la base de datos) y al final el
// préstamo. Esto no se puede deshacer.
async function eliminarPrestamo(prestamoId, clienteId) {
  if (!requiereConexion()) return;
  const confirmado = await mostrarConfirmacion("⚠️ ¿Seguro que quieres eliminar este préstamo? Se borrará también todo su historial de pagos y recargos de mora. Esto no se puede deshacer.");
  if (!confirmado) return;

  const { error: errorPagos } = await supabaseClient.from("pagos").delete().eq("prestamo_id", prestamoId);
  if (errorPagos) { mostrarAlerta("No fue posible borrar el historial de pagos del préstamo: " + traducirErrorSupabase(errorPagos)); return; }

  await supabaseClient.from("cargos_mora").delete().eq("prestamo_id", prestamoId);

  const { error } = await supabaseClient.from("prestamos").delete().eq("id", prestamoId);
  if (error) { mostrarAlerta("No fue posible eliminar el préstamo: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("🗑️ Préstamo eliminado.");
  delete historialPagosCache[prestamoId];
  cargarPrestamosDeCliente(clienteId);
  cargarClientes();
}

async function verificarSiQuedoPagado(prestamoId) {
  const { data: prestamo } = await supabaseClient.from("prestamos").select("*").eq("id", prestamoId).single();
  if (!prestamo) return;
  const { data: pagos } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", prestamoId);
  const totalPagado = pagos ? pagos.reduce((s, p) => s + Number(p.monto_pagado), 0) : 0;
  // Antes esto no contaba la mora aplicada: un crédito con mora podía quedar
  // marcado como "pagado" sin que el cliente hubiera cubierto ese recargo.
  if (calcularSaldoPendiente(prestamo, totalPagado) <= 0) {
    await supabaseClient.from("prestamos").update({ estado: "pagado" }).eq("id", prestamoId);
  }
}

async function refinanciarPrestamo(prestamoIdViejo, clienteId, saldoPendiente, interesActual, frecuenciaActual) {
  if (!requiereConexion()) return;
  const cont = document.getElementById("modal-generico-contenido");
  cont.innerHTML = `
    <p class="modal-mensaje">Saldo pendiente actual: <strong>${formatoPesos(saldoPendiente)}</strong></p>
    <label class="etiqueta-select">¿Cuánto dinero ADICIONAL le vas a prestar? (deja $0 si solo renuevas)</label>
    <input type="text" id="refi-adicional" inputmode="numeric" value="$0">
    <label class="etiqueta-select">¿En cuántas cuotas nuevas va a pagar?</label>
    <input type="number" id="refi-cuotas" min="1" step="1" value="20">
    <label class="etiqueta-select">¿Qué interés % aplicamos?</label>
    <input type="number" id="refi-interes" min="0" step="0.01" value="${interesActual}">
    <div class="modal-botones">
      <button class="btn-modal-cancelar" id="refi-btn-cancelar">Cancelar</button>
      <button class="btn-modal-confirmar" id="refi-btn-confirmar">Refinanciar</button>
    </div>`;
  document.getElementById("modal-generico").classList.remove("oculto");
  formatearMoneda(document.getElementById("refi-adicional"));

  document.getElementById("refi-btn-cancelar").onclick = cerrarModalGenerico;
  document.getElementById("refi-btn-confirmar").onclick = async () => {
    const montoAdicional = obtenerValorNumerico(document.getElementById("refi-adicional"));
    const numeroCuotas = parseInt(document.getElementById("refi-cuotas").value, 10);
    const nuevoInteres = parseFloat(document.getElementById("refi-interes").value);
    if (!numeroCuotas || numeroCuotas <= 0) { mostrarAlerta("Número de cuotas inválido."); return; }
    if (!Number.isFinite(nuevoInteres) || nuevoInteres < 0 || montoAdicional < 0) { mostrarAlerta("Ingresa valores válidos y no negativos."); return; }

    cerrarModalGenerico();
    const nuevoMontoPrestado = Math.round(saldoPendiente + montoAdicional);
    const totalConInteres = nuevoMontoPrestado + (nuevoMontoPrestado * nuevoInteres / 100);
    const nuevaCuota = Math.round(totalConInteres / numeroCuotas);
    const { error } = await supabaseClient.rpc("refinanciar_prestamo", {
      p_prestamo_id: prestamoIdViejo,
      p_monto_adicional: montoAdicional,
      p_numero_cuotas: numeroCuotas,
      p_interes_porcentaje: nuevoInteres,
      p_fecha_inicio: obtenerFechaLocal()
    });

    if (error) { mostrarAlerta("Error al crear nuevo préstamo: " + traducirErrorSupabase(error)); return; }

    mostrarAlerta(`✅ Crédito refinanciado.<br>Nuevo monto: ${formatoPesos(nuevoMontoPrestado)}<br>Nueva cuota: ${formatoPesos(nuevaCuota)}`);
    cargarPrestamosDeCliente(clienteId);
  };
}
formatearMoneda(document.getElementById("prestamo-monto"));
document.getElementById("prestamo-monto").addEventListener("input", actualizarVistaPreviaPrestamo);
