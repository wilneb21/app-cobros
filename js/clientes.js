let clientesCache = [];
let mostrandoArchivados = false;

async function crearCliente(event) {
  event.preventDefault();
  const nombre = document.getElementById("cliente-nombre").value;
  const telefono = document.getElementById("cliente-telefono").value;
  const direccion = document.getElementById("cliente-direccion").value;
  const notas = document.getElementById("cliente-notas").value;
  const rutaId = document.getElementById("cliente-ruta").value;
  const { data: userData } = await supabaseClient.auth.getUser();

  const { error } = await supabaseClient.from("clientes").insert({
    nombre, telefono, direccion, notas, ruta_id: rutaId, user_id: userData.user.id
  });

  if (error) { mostrarAlerta("Error al crear cliente: " + error.message); return; }

  document.getElementById("cliente-nombre").value = "";
  document.getElementById("cliente-telefono").value = "";
  document.getElementById("cliente-direccion").value = "";
  document.getElementById("cliente-notas").value = "";
  cargarClientes();
}

async function cargarClientes() {
  mostrarCargando("lista-clientes");
  const { data, error } = await supabaseClient
    .from("clientes").select("*, rutas(nombre)")
    .eq("archivado", mostrandoArchivados)
    .order("nombre");
  if (error) { console.error(error); return; }
  clientesCache = data;
  pintarClientesLista(data);
}

function toggleVerArchivados() {
  mostrandoArchivados = !mostrandoArchivados;
  document.getElementById("link-ver-archivados").innerText = mostrandoArchivados
    ? "← Volver a clientes activos"
    : "📦 Ver clientes archivados";
  document.getElementById("form-nuevo-cliente").classList.toggle("oculto", mostrandoArchivados);
  cargarClientes();
}

function pintarClientesLista(data) {
  const contenedor = document.getElementById("lista-clientes");

  if (data.length === 0) {
    contenedor.innerHTML = mostrandoArchivados
      ? `<div class="estado-vacio">📦 No tienes clientes archivados.</div>`
      : `<div class="estado-vacio">👤 Aún no tienes clientes registrados.<br>Usa el formulario de arriba para agregar el primero.</div>`;
    return;
  }

  contenedor.innerHTML = "";
  data.forEach(cliente => {
    const riesgo = cliente.riesgo || "bueno";
    const iconoRiesgo = { bueno: "🟢", regular: "🟡", riesgoso: "🔴" }[riesgo];
    contenedor.innerHTML += `
      <div class="tarjeta cliente-clickable" onclick="abrirDetalleCliente(${cliente.id})">
        <strong>${iconoRiesgo} ${cliente.nombre}</strong>
        <span>📞 ${cliente.telefono || "sin teléfono"}</span><br>
        <span>📍 ${cliente.rutas ? cliente.rutas.nombre : "sin ruta"}</span>
        ${cliente.notas ? `<div class="nota-cliente">📝 ${cliente.notas}</div>` : ""}
      </div>`;
  });
}

function filtrarClientesLista() {
  const texto = document.getElementById("buscar-cliente-lista").value.toLowerCase();
  const filtrados = clientesCache.filter(c => c.nombre.toLowerCase().includes(texto));

  if (filtrados.length === 0 && texto) {
    document.getElementById("lista-clientes").innerHTML = `<div class="estado-vacio">🔍 Ningún cliente coincide con "${texto}".</div>`;
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

  document.getElementById("tab-info").innerHTML = `
    <form onsubmit="guardarEdicionCliente(event, ${cliente.id})" class="tarjeta-form">
      <input type="text" id="editar-nombre" value="${cliente.nombre}" required>
      <input type="text" id="editar-telefono" value="${cliente.telefono || ""}" placeholder="Teléfono">
      <input type="text" id="editar-direccion" value="${cliente.direccion || ""}" placeholder="Dirección">
      <textarea id="editar-notas" rows="2" placeholder="Notas">${cliente.notas || ""}</textarea>
      <label class="etiqueta-select">Nivel de riesgo</label>
      <select id="editar-riesgo">
        <option value="bueno" ${riesgo === "bueno" ? "selected" : ""}>🟢 Bueno</option>
        <option value="regular" ${riesgo === "regular" ? "selected" : ""}>🟡 Regular</option>
        <option value="riesgoso" ${riesgo === "riesgoso" ? "selected" : ""}>🔴 Riesgoso</option>
      </select>
      <button type="submit" class="btn-editar-cliente">💾 Guardar cambios</button>
    </form>
    ${telefonoLimpio ? `<button class="btn-whatsapp" onclick="window.open('https://wa.me/${armarNumeroWhatsapp(cliente.telefono)}')">💬 Enviar WhatsApp</button>` : ""}
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

async function guardarEdicionCliente(event, clienteId) {
  event.preventDefault();
  const nombre = document.getElementById("editar-nombre").value;
  const telefono = document.getElementById("editar-telefono").value;
  const direccion = document.getElementById("editar-direccion").value;
  const notas = document.getElementById("editar-notas").value;
  const riesgo = document.getElementById("editar-riesgo").value;

  const { error } = await supabaseClient.from("clientes").update({ nombre, telefono, direccion, notas, riesgo }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error al guardar: " + error.message); return; }

  mostrarAlerta("✅ Cambios guardados");
  document.getElementById("detalle-nombre-cliente").innerText = nombre;
  cargarClientes();
}

// --- Exportar estado de cuenta (usa el diálogo de impresión del navegador, "Guardar como PDF") ---
async function exportarEstadoCuentaPDF(clienteId) {
  const { data: cliente } = await supabaseClient.from("clientes").select("*").eq("id", clienteId).single();
  const { data: prestamos } = await supabaseClient.from("prestamos").select("*").eq("cliente_id", clienteId).order("fecha_inicio", { ascending: false });

  let filasPrestamos = "";
  for (const p of prestamos) {
    const { data: pagos } = await supabaseClient.from("pagos").select("*").eq("prestamo_id", p.id).order("fecha_pago");
    const totalPagado = (pagos || []).reduce((s, pg) => s + Number(pg.monto_pagado), 0);
    const totalConInteres = Number(p.monto_prestado) + (Number(p.monto_prestado) * Number(p.interes_porcentaje) / 100);

    filasPrestamos += `
      <h3>Préstamo del ${p.fecha_inicio} — ${p.estado}</h3>
      <p>Monto: ${formatoPesos(p.monto_prestado)} | Interés: ${p.interes_porcentaje}% | Total a pagar: ${formatoPesos(totalConInteres)}</p>
      <p>Pagado: ${formatoPesos(totalPagado)} | Saldo: ${formatoPesos(totalConInteres - totalPagado)}</p>
      <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><th>Fecha</th><th>Estado</th><th>Monto</th></tr>
        ${(pagos || []).map(pg => `<tr><td>${pg.fecha_pago}</td><td>${pg.estado}</td><td>${formatoPesos(pg.monto_pagado)}</td></tr>`).join("")}
      </table><br>`;
  }

  const ventana = window.open("", "_blank");
  ventana.document.write(`
    <html><head><title>Estado de cuenta - ${cliente.nombre}</title></head>
    <body style="font-family:Arial,sans-serif;padding:24px;">
      <h1>Estado de cuenta</h1>
      <h2>${cliente.nombre}</h2>
      <p>Teléfono: ${cliente.telefono || "N/A"} | Dirección: ${cliente.direccion || "N/A"}</p>
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
  document.getElementById("form-nuevo-cliente").classList.remove("oculto");
  cargarClientes();
}

async function pintarTabPrestamos() {
  document.getElementById("tab-prestamos").innerHTML = `<div id="prestamos-cliente-${clienteDetalleActualId}">Cargando...</div>`;
  cargarPrestamosDeCliente(clienteDetalleActualId);
}

async function pintarTabHistorial() {
  const { data: prestamos } = await supabaseClient.from("prestamos").select("id").eq("cliente_id", clienteDetalleActualId);
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