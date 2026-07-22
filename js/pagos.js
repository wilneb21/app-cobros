async function registrarPago(prestamoId, monto, estado, clienteId, sumar = false) {
  const fecha = obtenerFechaLocal();
  if (!["pago", "parcial", "no_pago"].includes(estado) || (estado !== "no_pago" && !validarMontoPositivo(monto, "El pago"))) return;

  // Sin conexión: guarda el pago en el celular y lo sincroniza más tarde, sin bloquear al cobrador.
  // (Los pagos guardados offline siempre reemplazan, nunca suman — "sumar" necesita
  // ver el valor real que hay hoy en el servidor antes de decidir, y eso requiere señal.)
  if (!navigator.onLine) {
    agregarPagoACola({ prestamoId, monto, estado, fecha, clienteId, guardadoEn: Date.now() });
    marcarSubtarjetaPendienteSync(prestamoId);
    mostrarAlerta("📴 Sin conexión. El pago quedó guardado en tu celular y se enviará solo cuando vuelva la señal.");
    if (estado === "pago" || estado === "parcial") mostrarRecibo(clienteId, monto, fecha, estado);
    return;
  }

  let pagoExistente = null;
  try {
    const respuesta = await supabaseClient
      .from("pagos").select("id, monto_pagado").eq("prestamo_id", prestamoId).eq("fecha_pago", fecha).maybeSingle();
    pagoExistente = respuesta.data;
  } catch {
    // Falla de red al verificar duplicado: seguimos, registrar_pago igual protege con upsert.
  }

  // Ya hay un pago registrado hoy para este préstamo: se pregunta si el nuevo
  // valor debe SUMARSE al que ya existía (por ejemplo, el cliente pagó dos
  // veces en el mismo día) o si es una corrección y debe reemplazarlo.
  if (pagoExistente && !sumar) {
    const montoExistente = Number(pagoExistente.monto_pagado);
    const opcion = await mostrarOpcionesPagoDuplicado(montoExistente, monto);
    if (opcion === "cancelar" || opcion === null) return;
    sumar = opcion === "sumar";
    if (opcion === "sumar") {
      const confirmado = await mostrarConfirmacion(
        `Vas a registrar un pago adicional de ${formatoPesos(monto)}, sumado al ya registrado hoy (${formatoPesos(montoExistente)}).<br>Quedará un total de ${formatoPesos(montoExistente + monto)} hoy. ¿Confirmas?`
      );
      if (!confirmado) return;
    }
  }

  let error;
  try {
    ({ error } = await supabaseClient.rpc("registrar_pago", {
      p_prestamo_id: prestamoId, p_monto_pagado: monto, p_estado: estado, p_fecha_pago: fecha, p_sumar: sumar
    }));
  } catch (excepcion) {
    error = excepcion;
  }

  if (error) {
    // Puede ser una caída de señal justo al enviar: no se pierde el cobro, se reintenta solo.
    agregarPagoACola({ prestamoId, monto, estado, fecha, clienteId, guardadoEn: Date.now() });
    marcarSubtarjetaPendienteSync(prestamoId);
    mostrarAlerta("⚠️ No fue posible conectar con el servidor. El pago quedó guardado y se reintentará automáticamente.");
    if (estado === "pago" || estado === "parcial") mostrarRecibo(clienteId, monto, fecha, estado);
    return;
  }

  cargarPrestamosDeCliente(clienteId);

  if (estado === "pago" || estado === "parcial") mostrarRecibo(clienteId, monto, fecha, estado);
}

// Pregunta qué hacer cuando ya existe un pago hoy: sumar el nuevo valor al
// que ya estaba, reemplazarlo (corregirlo), o cancelar. Se apoya en el modal
// genérico de confirmación de sí/no, encadenando dos preguntas simples para
// no tener que construir un modal de 3 botones nuevo.
async function mostrarOpcionesPagoDuplicado(montoExistente, montoNuevo) {
  const quiereSumar = await mostrarConfirmacion(
    `Ya registraste un pago hoy de ${formatoPesos(montoExistente)} para este cliente.<br><br>¿Quieres SUMAR ${formatoPesos(montoNuevo)} más (otro pago el mismo día)?<br>Si eliges "Cancelar" te preguntamos si prefieres corregir el valor en vez de sumarlo.`
  );
  if (quiereSumar) return "sumar";
  const quiereCorregir = await mostrarConfirmacion(
    `¿Prefieres corregir el pago de hoy y dejarlo en ${formatoPesos(montoNuevo)} (reemplaza el valor anterior)?`
  );
  return quiereCorregir ? "reemplazar" : "cancelar";
}

// --- PAGAR EL SALDO TOTAL DE UN PRÉSTAMO (dar por terminado el crédito) ---
// Reutiliza registrarPago (mismo camino de guardado offline, recibo, etc.)
// pero con el saldo restante completo en vez de la cuota, para que el
// cobrador pueda cerrar un crédito en un solo toque desde "Cobrar".
async function confirmarPagoCompleto(prestamoId, saldoPendiente, clienteId) {
  if (!(saldoPendiente > 0)) { mostrarAlerta("Este préstamo ya no tiene saldo pendiente."); return; }
  const confirmado = await mostrarConfirmacion(
    `¿Registrar el pago del saldo total de ${formatoPesos(saldoPendiente)} y dar por terminado este préstamo?`
  );
  if (!confirmado) return;
  await registrarPago(prestamoId, saldoPendiente, "pago", clienteId);
}

// --- REGISTRAR PAGO (flujo único para parcial / ponerse al día) ---
// Antes existían dos caminos separados para lo mismo: "Parcial" (monto libre,
// sin contexto de cuánto se debe) y "Ponerse al día" (precargaba el total
// atrasado). Se unificaron en uno solo: si el cliente está al día, se abre
// pidiendo el monto libremente (para un abono parcial de la cuota de hoy); si
// está atrasado, se precarga el total que debe para que sea un solo toque
// ponerlo al día, pero se puede editar para dejarlo como abono parcial.
// Si paga el total (o más), queda como "Pagó ✅"; si paga menos, "Parcial ⚠️".
// Recuerda: sigue existiendo un solo registro de pago por día — el monto que
// se escriba aquí reemplaza (no se suma a) cualquier pago ya registrado hoy.
async function abrirRegistrarPago(prestamoId, clienteId, montoDebe) {
  const mensaje = montoDebe > 0
    ? `Este cliente debe ${formatoPesos(montoDebe)} de cuotas atrasadas. ¿Cuánto te pagó hoy?`
    : "¿Cuánto pagó el cliente hoy?";
  const monto = await mostrarPrompt(mensaje, montoDebe > 0 ? montoDebe : "0", true);
  if (monto === null) return;
  const montoLimpio = parseFloat(String(monto).replace(/\D/g, ""));
  if (!montoLimpio || montoLimpio <= 0) { mostrarAlerta("Ingresa un monto válido"); return; }
  const estado = montoDebe > 0 && montoLimpio >= montoDebe ? "pago" : "parcial";
  await registrarPago(prestamoId, montoLimpio, estado, clienteId);
}

let historialPagosCache = {};
const LIMITE_HISTORIAL_INICIAL = 20;

async function verHistorial(prestamoId, clienteId) {
  const contenedor = document.getElementById("historial-" + prestamoId);
  if (!contenedor.classList.contains("oculto")) { contenedor.classList.add("oculto"); return; }

  const { data: pagos, error } = await supabaseClient
    .from("pagos").select("*").eq("prestamo_id", prestamoId).order("fecha_pago", { ascending: false });
  if (error) { contenedor.innerHTML = "Error al cargar historial."; return; }

  historialPagosCache[prestamoId] = pagos;
  pintarHistorial(prestamoId, clienteId, LIMITE_HISTORIAL_INICIAL);
  contenedor.classList.remove("oculto");
}

// Pinta el historial ya cargado en memoria. Empieza mostrando solo los últimos
// registros (los más relevantes para el día a día) para no cargar la pantalla
// con meses de historial en clientes viejos; "Ver más" despliega el resto sin
// volver a consultar el servidor.
function pintarHistorial(prestamoId, clienteId, limite) {
  const contenedor = document.getElementById("historial-" + prestamoId);
  const pagos = historialPagosCache[prestamoId] || [];
  const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌" };

  if (pagos.length === 0) { contenedor.innerHTML = "<p>Sin pagos registrados todavía.</p>"; return; }

  const visibles = limite ? pagos.slice(0, limite) : pagos;
  const restantes = limite ? pagos.length - visibles.length : 0;
  contenedor.innerHTML = visibles.map(p => `<div class="fila-historial"><span>${formatoFecha(p.fecha_pago)}</span><span>${etiquetas[p.estado]}</span><span>${formatoPesos(p.monto_pagado)}</span><span class="btn-borrar-pago" onclick="eliminarPago(${p.id}, ${prestamoId}, ${clienteId})">🗑️</span></div>`).join("")
    + (restantes > 0 ? `<p class="link-ver-mas-historial" onclick="pintarHistorial(${prestamoId}, ${clienteId}, null)">Ver los ${restantes} pagos anteriores</p>` : "");
}

// --- CORREGIR UN PAGO MAL REGISTRADO ---
// El dueño de la cuenta puede borrar un pago que registró por error (monto
// equivocado, día equivocado, cliente que en realidad no pagó, etc.). Al
// borrarlo, el saldo del préstamo se recalcula solo — no hace falta tocar
// nada más. Si lo que quieres es corregir el monto, simplemente bórralo y
// vuelve a registrarlo bien con "Registrar pago" o "Pagó ✅".
async function eliminarPago(pagoId, prestamoId, clienteId) {
  if (!requiereConexion()) return;
  const confirmado = await mostrarConfirmacion("¿Seguro que quieres borrar este pago? Esto no se puede deshacer, y el saldo del cliente se recalculará sin este pago.");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("pagos").delete().eq("id", pagoId);
  if (error) { mostrarAlerta("No fue posible borrar el pago: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("🗑️ Pago eliminado.");
  delete historialPagosCache[prestamoId];
  cargarPrestamosDeCliente(clienteId);
}

async function mostrarRecibo(clienteId, monto, fecha, estado) {
  const { data: cliente } = await supabaseClient.from("clientes").select("nombre").eq("id", clienteId).single();
  const etiqueta = estado === "pago" ? "Pago completo de cuota" : "Abono parcial";

  document.getElementById("contenido-recibo").innerHTML = `
    <div class="recibo-titulo">🧾 Comprobante de pago</div>
    <div class="recibo-monto">${formatoPesos(monto)}</div>
    <div class="recibo-linea"><span>Cliente</span><span>${escaparHtml(cliente ? cliente.nombre : "")}</span></div>
    <div class="recibo-linea"><span>Fecha</span><span>${formatoFecha(fecha)}</span></div>
    <div class="recibo-linea"><span>Tipo</span><span>${etiqueta}</span></div>
    <div class="acciones-recibo"><button onclick="compartirRecibo(${clienteId}, ${monto}, '${fecha}', '${estado}')">Compartir</button><button onclick="cerrarRecibo()" class="secundario">Cerrar</button></div>`;
  document.getElementById("modal-recibo").classList.remove("oculto");
  empujarEstadoModal("modal-recibo");
}

async function compartirRecibo(clienteId, monto, fecha, estado) {
  const { data: cliente } = await supabaseClient.from("clientes").select("nombre").eq("id", clienteId).single();
  const texto = `Comprobante de pago\nCliente: ${cliente?.nombre || "Cliente"}\nMonto: ${formatoPesos(monto)}\nFecha: ${formatoFecha(fecha)}\nTipo: ${estado === "pago" ? "Pago de cuota" : "Abono parcial"}`;
  try {
    if (navigator.share) await navigator.share({ title: "Comprobante de pago", text: texto });
    else { await navigator.clipboard.writeText(texto); mostrarAlerta("Comprobante copiado. Ya puedes pegarlo en WhatsApp."); }
  } catch (error) {
    if (error.name !== "AbortError") mostrarAlerta("No fue posible compartir el comprobante.");
  }
}

function cerrarRecibo() {
  cerrarModalConHistorial("modal-recibo");
}
