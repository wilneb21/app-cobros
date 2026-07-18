async function registrarPago(prestamoId, monto, estado, clienteId) {
  const fecha = obtenerFechaLocal();
  if (!["pago", "parcial", "no_pago"].includes(estado) || (estado !== "no_pago" && !validarMontoPositivo(monto, "El pago"))) return;

  // Sin conexión: guarda el pago en el celular y lo sincroniza más tarde, sin bloquear al cobrador.
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
      .from("pagos").select("id").eq("prestamo_id", prestamoId).eq("fecha_pago", fecha).maybeSingle();
    pagoExistente = respuesta.data;
  } catch {
    // Falla de red al verificar duplicado: seguimos, registrar_pago igual protege con upsert.
  }

  if (pagoExistente) {
    const confirmado = await mostrarConfirmacion("Ya registraste un pago hoy para este cliente.<br>¿Quieres corregirlo con este nuevo valor?");
    if (!confirmado) return;
  }

  let error;
  try {
    ({ error } = await supabaseClient.rpc("registrar_pago", {
      p_prestamo_id: prestamoId, p_monto_pagado: monto, p_estado: estado, p_fecha_pago: fecha
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

async function abrirPagoParcial(prestamoId, clienteId) {
  const monto = await mostrarPrompt("¿Cuánto pagó el cliente hoy?", "0", true);
  if (monto === null) return;
  const montoLimpio = parseFloat(monto.replace(/\D/g, ""));
  if (!montoLimpio || montoLimpio <= 0) { mostrarAlerta("Ingresa un monto válido"); return; }
  await registrarPago(prestamoId, montoLimpio, "parcial", clienteId);
}

// --- PONERSE AL DÍA (cliente atrasado en varias cuotas) ---
// El botón "Pagó ✅" solo registra el valor de UNA cuota. Cuando el cliente
// debe más de una (por ejemplo, se atrasó 3 semanas y hoy quiere pagar todo
// junto), este flujo precarga el monto TOTAL que debe y lo deja editable —
// el cobrador escribe cuánto recibió realmente. Si paga el total, queda
// registrado como "Pagó ✅" (al día); si paga menos, como "Parcial ⚠️".
// Importante: sigue existiendo un solo registro de pago por día — el monto
// que se escriba aquí reemplaza (no se suma a) cualquier pago ya registrado
// hoy para este mismo préstamo.
async function abrirPonerseAlDia(prestamoId, clienteId, montoDebe) {
  const monto = await mostrarPrompt(`Este cliente debe ${formatoPesos(montoDebe)} de cuotas atrasadas. ¿Cuánto te pagó hoy para ponerse al día?`, montoDebe, true);
  if (monto === null) return;
  const montoLimpio = parseFloat(String(monto).replace(/\D/g, ""));
  if (!montoLimpio || montoLimpio <= 0) { mostrarAlerta("Ingresa un monto válido"); return; }
  const estado = montoLimpio >= montoDebe ? "pago" : "parcial";
  await registrarPago(prestamoId, montoLimpio, estado, clienteId);
}

async function verHistorial(prestamoId) {
  const contenedor = document.getElementById("historial-" + prestamoId);
  if (!contenedor.classList.contains("oculto")) { contenedor.classList.add("oculto"); return; }

  const { data: pagos, error } = await supabaseClient
    .from("pagos").select("*").eq("prestamo_id", prestamoId).order("fecha_pago", { ascending: false });
  if (error) { contenedor.innerHTML = "Error al cargar historial."; return; }

  const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌" };
  contenedor.innerHTML = pagos.length === 0
    ? "<p>Sin pagos registrados todavía.</p>"
    : pagos.map(p => `<div class="fila-historial"><span>${p.fecha_pago}</span><span>${etiquetas[p.estado]}</span><span>${formatoPesos(p.monto_pagado)}</span></div>`).join("");
  contenedor.classList.remove("oculto");
}

async function mostrarRecibo(clienteId, monto, fecha, estado) {
  const { data: cliente } = await supabaseClient.from("clientes").select("nombre").eq("id", clienteId).single();
  const etiqueta = estado === "pago" ? "Pago completo de cuota" : "Abono parcial";

  document.getElementById("contenido-recibo").innerHTML = `
    <div class="recibo-titulo">🧾 Comprobante de pago</div>
    <div class="recibo-monto">${formatoPesos(monto)}</div>
    <div class="recibo-linea"><span>Cliente</span><span>${escaparHtml(cliente ? cliente.nombre : "")}</span></div>
    <div class="recibo-linea"><span>Fecha</span><span>${fecha}</span></div>
    <div class="recibo-linea"><span>Tipo</span><span>${etiqueta}</span></div>
    <div class="acciones-recibo"><button onclick="compartirRecibo(${clienteId}, ${monto}, '${fecha}', '${estado}')">Compartir</button><button onclick="cerrarRecibo()" class="secundario">Cerrar</button></div>`;
  document.getElementById("modal-recibo").classList.remove("oculto");
  empujarEstadoModal("modal-recibo");
}

async function compartirRecibo(clienteId, monto, fecha, estado) {
  const { data: cliente } = await supabaseClient.from("clientes").select("nombre").eq("id", clienteId).single();
  const texto = `Comprobante de pago\nCliente: ${cliente?.nombre || "Cliente"}\nMonto: ${formatoPesos(monto)}\nFecha: ${fecha}\nTipo: ${estado === "pago" ? "Pago de cuota" : "Abono parcial"}`;
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
