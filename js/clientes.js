let clientesCache = [];
let mostrandoArchivados = false;

async function cargarClientes() {
  mostrarCargando("lista-clientes");
  const { data, error } = await supabaseClient
    .from("clientes").select("*, rutas(nombre)")
    .eq("archivado", mostrandoArchivados)
    .order("nombre");
  if (error) { mostrarAlerta("No fue posible cargar los clientes."); return; }
  clientesCache = data;
  pintarClientesLista(data);
}

function toggleVerArchivados() {
  mostrandoArchivados = !mostrandoArchivados;
  document.getElementById("link-ver-archivados").innerText = mostrandoArchivados
    ? "← Volver a clientes activos"
    : "📦 Ver clientes archivados";
  cargarClientes();
}

function pintarClientesLista(data) {
  const contenedor = document.getElementById("lista-clientes");

  if (data.length === 0) {
    contenedor.innerHTML = mostrandoArchivados
      ? `<div class="estado-vacio">📦 No tienes clientes archivados.</div>`
      : `<div class="estado-vacio">👤 Aún no tienes clientes registrados.<br>Toca <strong>Nuevo</strong> para crear el primero.</div>`;
    return;
  }

  contenedor.innerHTML = "";
  data.forEach(cliente => {
    const riesgo = cliente.riesgo || "bueno";
    const iconoRiesgo = { bueno: "🟢", regular: "🟡", riesgoso: "🔴" }[riesgo];
    contenedor.innerHTML += `
      <div class="tarjeta cliente-clickable" onclick="abrirDetalleCliente(${cliente.id})">
        <strong>${iconoRiesgo} ${escaparHtml(cliente.nombre)}</strong>
        <span>📞 ${escaparHtml(cliente.telefono || "sin teléfono")}</span><br>
        <span>📍 ${escaparHtml(cliente.rutas ? cliente.rutas.nombre : "sin ruta")}</span>
        ${cliente.notas ? `<div class="nota-cliente">📝 ${escaparHtml(cliente.notas)}</div>` : ""}
      </div>`;
  });
}

function filtrarClientesLista() {
  const texto = document.getElementById("buscar-cliente-lista").value.toLowerCase();
  const filtrados = clientesCache.filter(c => c.nombre.toLowerCase().includes(texto));

  if (filtrados.length === 0 && texto) {
    document.getElementById("lista-clientes").innerHTML = `<div class="estado-vacio">🔍 Ningún cliente coincide con "${escaparHtml(texto)}".</div>`;
    return;
  }
  pintarClientesLista(filtrados);
}

// Arma el número para WhatsApp: si ya trae indicativo de país (10-13 dígitos empezando en algo distinto
// a los prefijos celulares colombianos) lo respeta; si no, asume Colombia (+57)
function armarNumeroWhatsapp(telefono) {
  const soloDigitos = telefono.replace(/\D/g, "");
  if (soloDigitos.length > 10) return soloDigitos; // ya trae indicativo de país
  return "57" + soloDigitos; // número local colombiano de 10 dígitos
}

// --- CREAR CLIENTE DIRECTO (modal desde la pestaña Clientes) ---
async function abrirModalNuevoCliente() {
  document.getElementById("nuevo-cliente-nombre").value = "";
  document.getElementById("nuevo-cliente-telefono").value = "";
  document.getElementById("nuevo-cliente-direccion").value = "";
  document.getElementById("nuevo-cliente-notas").value = "";
  document.getElementById("nuevo-cliente-riesgo").value = "bueno";

  await cargarRutasEnSelectorNuevoCliente();

  document.getElementById("modal-nuevo-cliente").classList.remove("oculto");
  document.getElementById("nuevo-cliente-nombre").focus();
}

async function cargarRutasEnSelectorNuevoCliente(rutaSeleccionadaId = "") {
  const { data: rutas } = await supabaseClient.from("rutas").select("id, nombre").order("nombre");
  const selectorRuta = document.getElementById("nuevo-cliente-ruta");
  selectorRuta.innerHTML = '<option value="">Sin ruta por ahora</option>';
  (rutas || []).forEach(ruta => selectorRuta.innerHTML += `<option value="${ruta.id}">${escaparHtml(ruta.nombre)}</option>`);
  selectorRuta.innerHTML += '<option value="__nueva__">➕ Crear nueva ruta...</option>';
  selectorRuta.value = rutaSeleccionadaId;
}

async function manejarSeleccionRutaNuevoCliente() {
  const selectorRuta = document.getElementById("nuevo-cliente-ruta");
  if (selectorRuta.value !== "__nueva__") return;

  const nombreRuta = await mostrarPrompt("Nombre de la nueva ruta:");
  if (!nombreRuta || !nombreRuta.trim()) { selectorRuta.value = ""; return; }

  const user = await obtenerUsuarioActual();
  const { data: rutaCreada, error } = await supabaseClient.from("rutas")
    .insert({ nombre: nombreRuta.trim(), descripcion: "", user_id: user.id })
    .select("id").single();
  if (error) { mostrarAlerta("No fue posible crear la ruta: " + error.message); selectorRuta.value = ""; return; }

  await cargarRutasEnSelectorNuevoCliente(String(rutaCreada.id));
}

function cerrarModalNuevoCliente() {
  document.getElementById("modal-nuevo-cliente").classList.add("oculto");
}

async function crearClienteNuevo(event) {
  event.preventDefault();
  const nombre = document.getElementById("nuevo-cliente-nombre").value.trim();
  const telefono = document.getElementById("nuevo-cliente-telefono").value.trim();
  const direccion = document.getElementById("nuevo-cliente-direccion").value.trim();
  const notas = document.getElementById("nuevo-cliente-notas").value.trim();
  const riesgo = document.getElementById("nuevo-cliente-riesgo").value;
  const rutaId = document.getElementById("nuevo-cliente-ruta").value;
  if (!nombre) { mostrarAlerta("El nombre del cliente es obligatorio."); return; }

  if (telefono) {
    const { data: posiblesDuplicados } = await supabaseClient
      .from("clientes").select("nombre, archivado").eq("telefono", telefono);
    if (posiblesDuplicados && posiblesDuplicados.length > 0) {
      const nombresExistentes = posiblesDuplicados
        .map(c => escaparHtml(c.nombre) + (c.archivado ? " (archivado)" : ""))
        .join(", ");
      const continuar = await mostrarConfirmacion(
        `Ya existe un cliente registrado con este teléfono: <strong>${nombresExistentes}</strong>.<br><br>¿Seguro que quieres crear <strong>${escaparHtml(nombre)}</strong> como un cliente nuevo de todas formas?`
      );
      if (!continuar) return;
    }
  }

  const user = await obtenerUsuarioActual();
  const { error } = await supabaseClient.from("clientes").insert({
    nombre, telefono, direccion, notas, riesgo, ruta_id: rutaId || null, user_id: user.id, archivado: false
  });
  if (error) { mostrarAlerta("No fue posible crear el cliente: " + error.message); return; }

  cerrarModalNuevoCliente();
  mostrarAlerta("✅ Cliente creado");
  cargarClientes();
}

// --- DETALLE DE CLIENTE (modal con pestañas) ---
let clienteDetalleActualId = null;

async function abrirDetalleCliente(clienteId) {
  clienteDetalleActualId = clienteId;
  const { data: cliente, error } = await supabaseClient.from("clientes").select("*, rutas(nombre)").eq("id", clienteId).single();
  if (error) { mostrarAlerta("Error al cargar cliente: " + error.message); return; }

  document.getElementById("detalle-nombre-cliente").innerText = cliente.nombre;
  cambiarTabDetalle("info");
  pintarTabInfo(cliente);

  document.getElementById("modal-detalle").classList.remove("oculto");
}

function cerrarDetalleCliente() {
  document.getElementById("modal-detalle").classList.add("oculto");
}

function cambiarTabDetalle(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("activo"));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add("activo");
  document.querySelectorAll(".tab-contenido").forEach(c => c.classList.add("oculto"));
  document.getElementById("tab-" + tab).classList.remove("oculto");

  if (tab === "prestamos") pintarTabPrestamos();
  if (tab === "historial") pintarTabHistorial();
}

async function pintarTabInfo(cliente) {
  const telefonoLimpio = (cliente.telefono || "").replace(/\D/g, "");
  const riesgo = cliente.riesgo || "bueno";

  const { count } = await supabaseClient
    .from("prestamos").select("*", { count: "exact", head: true }).eq("cliente_id", cliente.id);
  const tieneHistorial = count > 0;
  const { data: activos } = await supabaseClient.from("prestamos")
    .select("id, monto_prestado, interes_porcentaje, cuota, frecuencia, fecha_inicio, numero_cuotas")
    .eq("cliente_id", cliente.id).eq("estado", "activo");
  const idsActivos = (activos || []).map(prestamo => prestamo.id);
  const { data: pagosActivos } = idsActivos.length
    ? await supabaseClient.from("pagos").select("prestamo_id, monto_pagado, fecha_pago").in("prestamo_id", idsActivos)
    : { data: [] };
  const pagadoPorPrestamo = {};
  (pagosActivos || []).forEach(pago => pagadoPorPrestamo[pago.prestamo_id] = (pagadoPorPrestamo[pago.prestamo_id] || 0) + Number(pago.monto_pagado));
  const saldoActivo = (activos || []).reduce((total, prestamo) => total + Math.max(Number(prestamo.monto_prestado) * (1 + Number(prestamo.interes_porcentaje) / 100) - (pagadoPorPrestamo[prestamo.id] || 0), 0), 0);
  const proximaCuota = (activos || []).sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio))[0];

  document.getElementById("tab-info").innerHTML = `
    ${activos?.length ? `<div class="resumen-cliente-operativo"><div><small>Saldo activo</small><b>${formatoPesos(saldoActivo)}</b></div><div><small>Créditos activos</small><b>${activos.length}</b></div><div><small>Cuota siguiente</small><b>${formatoPesos(proximaCuota.cuota)}</b></div></div>` : `<div class="resumen-cliente-operativo sin-credito"><span>Sin créditos activos</span><button type="button" onclick="abrirPrestamoParaCliente(${cliente.id})">Crear préstamo</button></div>`}
    <form onsubmit="guardarEdicionCliente(event, ${cliente.id})" class="tarjeta-form">
      <input type="text" id="editar-nombre" value="${escaparHtml(cliente.nombre)}" required>
      <input type="text" id="editar-telefono" value="${escaparHtml(cliente.telefono || "")}" placeholder="Teléfono">
      <input type="text" id="editar-direccion" value="${escaparHtml(cliente.direccion || "")}" placeholder="Dirección">
      <textarea id="editar-notas" rows="2" placeholder="Notas">${escaparHtml(cliente.notas || "")}</textarea>
      <label class="etiqueta-select">Nivel de riesgo</label>
      <select id="editar-riesgo">
        <option value="bueno" ${riesgo === "bueno" ? "selected" : ""}>🟢 Bueno</option>
        <option value="regular" ${riesgo === "regular" ? "selected" : ""}>🟡 Regular</option>
        <option value="riesgoso" ${riesgo === "riesgoso" ? "selected" : ""}>🔴 Riesgoso</option>
      </select>
      <button type="submit" class="btn-editar-cliente">💾 Guardar cambios</button>
    </form>
    ${telefonoLimpio ? `<button class="btn-whatsapp" onclick="window.open('https://wa.me/${armarNumeroWhatsapp(cliente.telefono)}')">💬 Enviar WhatsApp</button>` : ""}
    ${cliente.direccion ? `<button class="btn-mapa" onclick="abrirMapaCliente(${cliente.id})">🗺️ Abrir ubicación en el mapa</button>` : ""}
    ${tieneHistorial ? `<button class="btn-pdf" onclick="exportarEstadoCuentaPDF(${cliente.id})">🧾 Exportar estado de cuenta</button>` : ""}

    ${cliente.archivado
      ? `<button class="btn-editar-cliente" onclick="desarchivarCliente(${cliente.id})">📤 Desarchivar cliente</button>`
      : tieneHistorial
        ? `<button class="btn-eliminar" onclick="archivarCliente(${cliente.id})">📦 Archivar cliente</button>
           <p class="nota-ayuda">Este cliente tiene ${count} préstamo(s) en su historial, por eso no se puede eliminar — se archiva para proteger tus reportes.</p>`
        : `<button class="btn-eliminar" onclick="eliminarCliente(${cliente.id})">🗑️ Eliminar cliente</button>`
    }
  `;
}

async function abrirMapaCliente(clienteId) {
  const { data: cliente, error } = await supabaseClient.from("clientes").select("direccion").eq("id", clienteId).single();
  if (error || !cliente?.direccion) { mostrarAlerta("Este cliente no tiene dirección registrada."); return; }
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cliente.direccion)}`, "_blank", "noopener");
}

function abrirPrestamoParaCliente(clienteId) {
  cerrarDetalleCliente();
  mostrarSeccion("prestamos");
  const seleccionar = () => {
    const selector = document.getElementById("prestamo-cliente");
    if (!selector.querySelector(`option[value="${clienteId}"]`)) return setTimeout(seleccionar, 100);
    selector.value = String(clienteId);
  };
  seleccionar();
}

async function guardarEdicionCliente(event, clienteId) {
  event.preventDefault();
  const nombre = document.getElementById("editar-nombre").value.trim();
  const telefono = document.getElementById("editar-telefono").value.trim();
  const direccion = document.getElementById("editar-direccion").value.trim();
  const notas = document.getElementById("editar-notas").value.trim();
  const riesgo = document.getElementById("editar-riesgo").value;
  if (!nombre) return mostrarAlerta("El nombre del cliente es obligatorio.");

  const { error } = await supabaseClient.from("clientes").update({ nombre, telefono, direccion, notas, riesgo }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error al guardar: " + error.message); return; }

  mostrarAlerta("✅ Cambios guardados");
  document.getElementById("detalle-nombre-cliente").innerText = nombre;
  cargarClientes();
}

// --- Exportar estado de cuenta (usa el diálogo de impresión del navegador, "Guardar como PDF") ---
async function exportarEstadoCuentaPDF(clienteId) {
  const { data: cliente } = await supabaseClient.from("clientes").select("*").eq("id", clienteId).single();
  const { data: prestamos, error: errorPrestamos } = await supabaseClient.from("prestamos").select("*").eq("cliente_id", clienteId).order("fecha_inicio", { ascending: false });
  if (!cliente || errorPrestamos) return mostrarAlerta("No fue posible generar el estado de cuenta.");

  let filasPrestamos = "";
  for (const p of prestamos) {
    const { data: pagos } = await supabaseClient.from("pagos").select("*").eq("prestamo_id", p.id).order("fecha_pago");
    const totalPagado = (pagos || []).reduce((s, pg) => s + Number(pg.monto_pagado), 0);
    const totalConInteres = Number(p.monto_prestado) + (Number(p.monto_prestado) * Number(p.interes_porcentaje) / 100);

    filasPrestamos += `
      <h3>Préstamo del ${p.fecha_inicio} — ${escaparHtml(p.estado)}</h3>
      <p>Monto: ${formatoPesos(p.monto_prestado)} | Interés: ${p.interes_porcentaje}% | Total a pagar: ${formatoPesos(totalConInteres)}</p>
      <p>Pagado: ${formatoPesos(totalPagado)} | Saldo: ${formatoPesos(totalConInteres - totalPagado)}</p>
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><th>Fecha</th><th>Estado</th><th>Monto</th></tr>
        ${(pagos || []).map(pg => `<tr><td>${pg.fecha_pago}</td><td>${escaparHtml(pg.estado)}</td><td>${formatoPesos(pg.monto_pagado)}</td></tr>`).join("")}
      </table><br>`;
  }

  const ventana = window.open("", "_blank");
  ventana.document.write(`
    <html><head><title>Estado de cuenta - ${escaparHtml(cliente.nombre)}</title></head>
    <body style="font-family:Arial,sans-serif;padding:24px;">
      <h1>Estado de cuenta</h1>
      <h2>${escaparHtml(cliente.nombre)}</h2>
      <p>Teléfono: ${escaparHtml(cliente.telefono || "N/A")} | Dirección: ${escaparHtml(cliente.direccion || "N/A")}</p>
      <hr>
      ${filasPrestamos || "<p>Sin préstamos registrados.</p>"}
    </body></html>
  `);
  ventana.document.close();
  ventana.print();
}

async function eliminarCliente(clienteId) {
  // Solo se llega aquí cuando el cliente NO tiene ningún préstamo en su historial
  const confirmado = await mostrarConfirmacion("¿Seguro que quieres eliminar este cliente? Esto no se puede deshacer.");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("clientes").delete().eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + error.message); return; }

  cerrarDetalleCliente();
  cargarClientes();
}

async function archivarCliente(clienteId) {
  const confirmado = await mostrarConfirmacion("Este cliente se ocultará de tu lista de clientes activos, pero todo su historial de préstamos y pagos se conserva intacto.<br><br>¿Deseas archivarlo?");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("clientes").update({ archivado: true }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + error.message); return; }

  mostrarAlerta("📦 Cliente archivado");
  cerrarDetalleCliente();
  cargarClientes();
}

async function desarchivarCliente(clienteId) {
  const { error } = await supabaseClient.from("clientes").update({ archivado: false }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + error.message); return; }

  mostrarAlerta("✅ Cliente desarchivado, ya aparece de nuevo en tu lista activa.");
  cerrarDetalleCliente();
  mostrandoArchivados = false;
  document.getElementById("link-ver-archivados").innerText = "📦 Ver clientes archivados";
  cargarClientes();
}

async function pintarTabPrestamos() {
  document.getElementById("tab-prestamos").innerHTML = `<div id="prestamos-cliente-${clienteDetalleActualId}">Cargando...</div>`;
  cargarPrestamosDeCliente(clienteDetalleActualId);
}

async function pintarTabHistorial() {
  const { data: prestamos, error } = await supabaseClient.from("prestamos").select("id").eq("cliente_id", clienteDetalleActualId);
  if (error) { document.getElementById("tab-historial").textContent = "No fue posible cargar el historial."; return; }
  const idsPrestamos = prestamos.map(p => p.id);

  if (idsPrestamos.length === 0) {
    document.getElementById("tab-historial").innerHTML = "<p>Sin historial todavía.</p>";
    return;
  }

  const { data: pagos } = await supabaseClient
    .from("pagos").select("*").in("prestamo_id", idsPrestamos).order("fecha_pago", { ascending: false });

  const etiquetas = { pago: "Pagó ✅", parcial: "Parcial ⚠️", no_pago: "No pagó ❌" };
  document.getElementById("tab-historial").innerHTML = pagos.length === 0
    ? "<p>Sin pagos registrados todavía.</p>"
    : pagos.map(p => `
        <div class="fila-historial">
          <span>${p.fecha_pago}</span><span>${etiquetas[p.estado]}</span><span>${formatoPesos(p.monto_pagado)}</span>
        </div>`).join("");
}
