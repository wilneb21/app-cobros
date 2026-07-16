async function registrarPago(prestamoId, monto, estado, clienteId) {
  const { data: userData } = await supabaseClient.auth.getUser();
  const fecha = obtenerFechaLocal();

  const { data: pagoExistente } = await supabaseClient
    .from("pagos").select("id").eq("prestamo_id", prestamoId).eq("fecha_pago", fecha).maybeSingle();

  let error;
  if (pagoExistente) {
    const confirmado = await mostrarConfirmacion("Ya registraste un pago hoy para este cliente.<br>¿Quieres corregirlo con este nuevo valor?");
    if (!confirmado) return;
    const resultado = await supabaseClient.from("pagos").update({ monto_pagado: monto, estado }).eq("id", pagoExistente.id);
    error = resultado.error;
  } else {
    const resultado = await supabaseClient.from("pagos").insert({
      prestamo_id: prestamoId, fecha_pago: fecha, monto_pagado: monto, estado, user_id: userData.user.id
    });
    error = resultado.error;
  }

  if (error) { mostrarAlerta("Error al registrar pago: " + error.message); return; }

  await verificarSiQuedoPagado(prestamoId);
  cargarPrestamosDeCliente(clienteId);

  if (estado === "pago" || estado === "parcial") mostrarRecibo(clienteId, monto, fecha, estado);
}

async function abrirPagoParcial(prestamoId, clienteId) {
  const monto = await mostrarPrompt("¿Cuánto pagó el cliente hoy?");
  if (monto === null) return;
  const montoLimpio = parseFloat(monto.replace(/\D/g, ""));
  if (!montoLimpio || montoLimpio <= 0) { mostrarAlerta("Ingresa un monto válido"); return; }
  registrarPago(prestamoId, montoLimpio, "parcial", clienteId);
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
    <div class="recibo-linea"><span>Cliente</span><span>${cliente ? cliente.nombre : ""}</span></div>
    <div class="recibo-linea"><span>Fecha</span><span>${fecha}</span></div>
    <div class="recibo-linea"><span>Tipo</span><span>${etiqueta}</span></div>
    <button onclick="cerrarRecibo()" style="margin-top:16px;">Cerrar</button>`;
  document.getElementById("modal-recibo").classList.remove("oculto");
}

function cerrarRecibo() {
  document.getElementById("modal-recibo").classList.add("oculto");
}