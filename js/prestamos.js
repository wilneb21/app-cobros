function toggleCampoMora() {
  const check = document.getElementById("prestamo-mora-check");
  document.getElementById("prestamo-mora-porcentaje").classList.toggle("oculto", !check.checked);
}

async function cargarClientesEnSelector() {
  const { data, error } = await supabaseClient.from("clientes").select("id, nombre").eq("archivado", false).order("nombre");
  if (error) { console.error(error); return; }
  const selector = document.getElementById("prestamo-cliente");
  selector.innerHTML = '<option value="">Selecciona un cliente</option>';
  data.forEach(c => selector.innerHTML += `<option value="${c.id}">${c.nombre}</option>`);
}

async function crearPrestamo(event) {
  event.preventDefault();
  const clienteId = document.getElementById("prestamo-cliente").value;
  const monto = obtenerValorNumerico(document.getElementById("prestamo-monto"));
  const interes = parseFloat(document.getElementById("prestamo-interes").value) || 0;
  const numeroCuotas = parseInt(document.getElementById("prestamo-cuotas").value);
  const frecuencia = document.getElementById("prestamo-frecuencia").value;
  const fechaInicio = document.getElementById("prestamo-fecha").value;
  const moraHabilitada = document.getElementById("prestamo-mora-check").checked;
  const moraPorcentaje = moraHabilitada ? (parseFloat(document.getElementById("prestamo-mora-porcentaje").value) || 0) : 0;

  const totalConInteres = monto + (monto * interes / 100);
  const cuota = totalConInteres / numeroCuotas;
  const { data: userData } = await supabaseClient.auth.getUser();

  const { error } = await supabaseClient.from("prestamos").insert({
    cliente_id: clienteId, monto_prestado: monto, interes_porcentaje: interes,
    cuota, numero_cuotas: numeroCuotas, frecuencia, fecha_inicio: fechaInicio,
    estado: "activo", user_id: userData.user.id,
    interes_mora_habilitado: moraHabilitada, interes_mora_porcentaje: moraPorcentaje
  });

  if (error) { mostrarAlerta("Error al crear préstamo: " + error.message); return; }

  document.getElementById("prestamo-monto").value = "";
  document.getElementById("prestamo-interes").value = "";
  document.getElementById("prestamo-cuotas").value = "";
  document.getElementById("prestamo-fecha").value = "";
  document.getElementById("prestamo-mora-check").checked = false;
  document.getElementById("prestamo-mora-porcentaje").value = "";
  document.getElementById("prestamo-mora-porcentaje").classList.add("oculto");
  mostrarAlerta("✅ Préstamo registrado con éxito");
}

// --- COBRAR ---
let clientesCobrarCache = [];

async function cargarClientesParaCobrar() {
  mostrarCargando("lista-clientes-cobrar");
  const { data: clientes, error } = await supabaseClient.from("clientes").select("*, rutas(nombre)").eq("archivado", false).order("nombre");
  if (error) { console.error(error); return; }
  clientesCobrarCache = clientes;
  actualizarSelectorFiltroRuta(clientes);
  pintarClientesCobrar(clientes);
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
    selector.innerHTML += `<option value="${id}">${nombre}</option>`;
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
  for (const cliente of clientes) {
    contenedor.innerHTML += `
      <div class="tarjeta">
        <strong>${cliente.nombre}</strong>
        <span>📍 ${cliente.rutas ? cliente.rutas.nombre : "sin ruta"}</span>
        ${cliente.notas ? `<div class="nota-cliente">📝 ${cliente.notas}</div>` : ""}
        <div id="prestamos-cliente-${cliente.id}" class="prestamos-cliente">Cargando préstamos...</div>
      </div>`;
  }
  for (const cliente of clientes) cargarPrestamosDeCliente(cliente.id);
}

function filtrarClientesCobrar() {
  const texto = document.getElementById("buscar-cliente-cobrar").value.toLowerCase();
  const rutaId = document.getElementById("filtro-ruta-cobrar").value;

  let filtrados = clientesCobrarCache.filter(c => c.nombre.toLowerCase().includes(texto));
  if (rutaId) filtrados = filtrados.filter(c => String(c.ruta_id) === rutaId);

  pintarClientesCobrar(filtrados);
}

async function cargarPrestamosDeCliente(clienteId) {
  const { data: prestamos, error } = await supabaseClient
    .from("prestamos").select("*").eq("cliente_id", clienteId).eq("estado", "activo");

  const contenedor = document.getElementById("prestamos-cliente-" + clienteId);
  if (!contenedor) return;
  if (error) { contenedor.innerHTML = "Error al cargar."; return; }
  if (prestamos.length === 0) { contenedor.innerHTML = "<span>Sin préstamos activos</span>"; return; }

  contenedor.innerHTML = "";
  for (const p of prestamos) {
    const { data: pagos } = await supabaseClient
      .from("pagos").select("monto_pagado, fecha_pago, estado")
      .eq("prestamo_id", p.id).order("fecha_pago", { ascending: false });

    const totalPagado = pagos ? pagos.reduce((s, pg) => s + Number(pg.monto_pagado), 0) : 0;
    const totalConInteres = Number(p.monto_prestado) + (Number(p.monto_prestado) * Number(p.interes_porcentaje) / 100);
    const saldoPendiente = totalConInteres - totalPagado;

    const ultimoPago = pagos && pagos.length > 0 ? pagos[0] : null;
    const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌" };
    const textoUltimo = ultimoPago ? `Último registro: ${ultimoPago.fecha_pago} — ${etiquetas[ultimoPago.estado]}` : "Sin pagos registrados";

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

    let claseMora, textoMora, recargoTexto = "";
    if (diferencia >= 0) {
      claseMora = "estado-al-dia";
      textoMora = diferencia > 0 ? `🟢 Al día (adelantado ${formatoPesos(diferencia)})` : "🟢 Al día";
    } else {
      const montoDebe = Math.abs(diferencia);
      claseMora = montoDebe < Number(p.cuota) * 2 ? "estado-atencion" : "estado-mora";
      textoMora = `${claseMora === "estado-atencion" ? "🟡" : "🔴"} Debe ${formatoPesos(montoDebe)}`;

      if (p.interes_mora_habilitado && p.interes_mora_porcentaje > 0) {
        const recargo = montoDebe * (p.interes_mora_porcentaje / 100);
        recargoTexto = `<span class="recargo-mora">+ Recargo por mora estimado: ${formatoPesos(recargo)}</span>`;
      }
    }

    contenedor.innerHTML += `
      <div class="subtarjeta ${claseMora}">
        <span class="badge-estado">${textoMora}</span>
        ${recargoTexto}
        <span>Cuota ${p.frecuencia}: ${formatoPesos(p.cuota)}</span><br>
        <span><strong>Saldo pendiente: ${formatoPesos(saldoPendiente)}</strong></span><br>
        <span class="ultimo-registro">${textoUltimo}</span>
        ${textoRacha}
        <div class="botones-pago">
          <button class="btn-pago pago-si" onclick="registrarPago(${p.id}, ${p.cuota}, 'pago', ${clienteId})">Pagó ✅</button>
          <button class="btn-pago pago-parcial" onclick="abrirPagoParcial(${p.id}, ${clienteId})">Parcial ⚠️</button>
          <button class="btn-pago pago-no" onclick="registrarPago(${p.id}, 0, 'no_pago', ${clienteId})">No pagó ❌</button>
        </div>
        <button class="btn-historial" onclick="verHistorial(${p.id})">Ver historial completo</button>
        <div id="historial-${p.id}" class="historial oculto"></div>
        <button class="btn-refinanciar" onclick="refinanciarPrestamo(${p.id}, ${clienteId}, ${saldoPendiente}, ${p.interes_porcentaje}, '${p.frecuencia}')">🔄 Refinanciar crédito</button>
      </div>`;
  }
}

async function verificarSiQuedoPagado(prestamoId) {
  const { data: prestamo } = await supabaseClient.from("prestamos").select("*").eq("id", prestamoId).single();
  if (!prestamo) return;
  const { data: pagos } = await supabaseClient.from("pagos").select("monto_pagado").eq("prestamo_id", prestamoId);
  const totalPagado = pagos ? pagos.reduce((s, p) => s + Number(p.monto_pagado), 0) : 0;
  const totalConInteres = Number(prestamo.monto_prestado) + (Number(prestamo.monto_prestado) * Number(prestamo.interes_porcentaje) / 100);
  if (totalPagado >= totalConInteres) {
    await supabaseClient.from("prestamos").update({ estado: "pagado" }).eq("id", prestamoId);
  }
}

async function refinanciarPrestamo(prestamoIdViejo, clienteId, saldoPendiente, interesActual, frecuenciaActual) {
  const confirmado = await mostrarConfirmacion(`Saldo pendiente actual: ${formatoPesos(saldoPendiente)}<br><br>¿Deseas refinanciar este crédito?`);
  if (!confirmado) return;

  const adicionalTexto = await mostrarPrompt("¿Cuánto dinero ADICIONAL le vas a prestar? (0 si solo renuevas)", "0");
  if (adicionalTexto === null) return;
  const montoAdicional = parseFloat(adicionalTexto.replace(/\D/g, "")) || 0;

  const cuotasTexto = await mostrarPrompt("¿En cuántas cuotas nuevas va a pagar?", "20");
  if (cuotasTexto === null) return;
  const numeroCuotas = parseInt(cuotasTexto);
  if (!numeroCuotas || numeroCuotas <= 0) { mostrarAlerta("Número de cuotas inválido."); return; }

  const interesTexto = await mostrarPrompt("¿Qué interés % aplicamos?", interesActual);
  const nuevoInteres = parseFloat(interesTexto) || 0;

  const nuevoMontoPrestado = saldoPendiente + montoAdicional;
  const totalConInteres = nuevoMontoPrestado + (nuevoMontoPrestado * nuevoInteres / 100);
  const nuevaCuota = totalConInteres / numeroCuotas;
  const { data: userData } = await supabaseClient.auth.getUser();

  await supabaseClient.from("prestamos").update({ estado: "refinanciado" }).eq("id", prestamoIdViejo);

  const { error } = await supabaseClient.from("prestamos").insert({
    cliente_id: clienteId, monto_prestado: nuevoMontoPrestado, interes_porcentaje: nuevoInteres,
    cuota: nuevaCuota, numero_cuotas: numeroCuotas, frecuencia: frecuenciaActual,
    fecha_inicio: obtenerFechaLocal(), estado: "activo",
    prestamo_anterior_id: prestamoIdViejo, user_id: userData.user.id
  });

  if (error) { mostrarAlerta("Error al crear nuevo préstamo: " + error.message); return; }

  mostrarAlerta(`✅ Crédito refinanciado.<br>Nuevo monto: ${formatoPesos(nuevoMontoPrestado)}<br>Nueva cuota: ${formatoPesos(nuevaCuota)}`);
  cargarPrestamosDeCliente(clienteId);
}
formatearMoneda(document.getElementById("prestamo-monto"));