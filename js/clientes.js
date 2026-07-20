let clientesCache = [];
let mostrandoArchivados = false;

async function cargarClientes() {
  mostrarCargando("lista-clientes");
  const { data, error } = await supabaseClient
    .from("clientes").select("*, rutas(nombre)")
    .eq("archivado", mostrandoArchivados)
    .order("nombre");
  if (error) { mostrarAlerta("No fue posible cargar los clientes."); return; }
  data.sort(compararClientesPorRutaYOrden);
  clientesCache = data;
  pintarClientesLista(data);
}

// --- RANKING DE CLIENTES POR CUMPLIMIENTO ---
// % de cumplimiento = pagos completos registrados / total de registros de pago
// (pagos completos + parciales + "no pagó") de todos los préstamos del cliente,
// histórico. Sirve para decidir a quién es más fácil volver a prestarle.
let rankingClientesVisible = false;

function toggleRankingClientes() {
  rankingClientesVisible = !rankingClientesVisible;
  const cont = document.getElementById("ranking-clientes");
  document.getElementById("link-ver-ranking").textContent = rankingClientesVisible
    ? "← Ocultar ranking" : "🏆 Ver ranking de cumplimiento";
  cont.classList.toggle("oculto", !rankingClientesVisible);
  if (rankingClientesVisible) cargarRankingClientes();
}

async function cargarRankingClientes() {
  const cont = document.getElementById("ranking-clientes");
  cont.innerHTML = '<div class="cargando">Calculando ranking...</div>';

  const { data: pagos, error } = await supabaseClient
    .from("pagos").select("estado, prestamos(cliente_id, clientes(nombre))");
  if (error) { cont.innerHTML = '<p class="texto-ayuda">No fue posible calcular el ranking.</p>'; return; }

  const porCliente = {};
  (pagos || []).forEach(p => {
    const clienteId = p.prestamos?.cliente_id;
    const nombre = p.prestamos?.clientes?.nombre;
    if (!clienteId) return;
    if (!porCliente[clienteId]) porCliente[clienteId] = { nombre, total: 0, pagados: 0 };
    porCliente[clienteId].total++;
    if (p.estado === "pago") porCliente[clienteId].pagados++;
  });

  const ranking = Object.values(porCliente)
    .filter(c => c.total >= 3) // evita rankear con muy poca historia
    .map(c => ({ ...c, pct: (c.pagados / c.total) * 100 }))
    .sort((a, b) => b.pct - a.pct);

  cont.innerHTML = ranking.length === 0
    ? '<p class="texto-ayuda">Necesitas al menos 3 pagos registrados por cliente para calcular el ranking.</p>'
    : ranking.map((c, i) => `
        <div class="ranking-fila">
          <span><span class="ranking-puesto">#${i + 1}</span>${escaparHtml(c.nombre || "Cliente")}</span>
          <span>${c.pct.toFixed(0)}% cumplimiento (${c.pagados}/${c.total})</span>
        </div>`).join("");
}

// --- SUGERENCIA DE CUPO ---
// Con base en el préstamo más grande que el cliente ya terminó de pagar (estado
// "pagado") y su % de cumplimiento histórico, sugiere cuánto sería razonable
// volver a prestarle. Es solo una guía — la decisión final siempre es tuya.
async function calcularSugerenciaCupo(clienteId, riesgo) {
  const { data: prestamos, error } = await supabaseClient
    .from("prestamos").select("id, monto_prestado, estado").eq("cliente_id", clienteId);
  if (error || !prestamos) return null;

  const finalizados = prestamos.filter(p => p.estado === "pagado");
  if (finalizados.length === 0) return null; // sin historial cerrado, no hay base confiable para sugerir

  const montoMaximoPagado = Math.max(...finalizados.map(p => Number(p.monto_prestado)));

  const idsTodos = prestamos.map(p => p.id);
  const { data: pagos } = await supabaseClient.from("pagos").select("estado").in("prestamo_id", idsTodos);
  const total = (pagos || []).length;
  const pagados = (pagos || []).filter(p => p.estado === "pago").length;
  const pctCumplimiento = total >= 3 ? (pagados / total) * 100 : null;

  let factor = 1.0; // por defecto, mantener el mismo monto
  let motivo = " · monto similar al último crédito ya cancelado";

  if (pctCumplimiento !== null) {
    if (pctCumplimiento >= 90) { factor = 1.3; motivo = ` · ${pctCumplimiento.toFixed(0)}% de cumplimiento, puedes subirle el cupo`; }
    else if (pctCumplimiento >= 75) { factor = 1.15; motivo = ` · ${pctCumplimiento.toFixed(0)}% de cumplimiento, aumento moderado`; }
    else if (pctCumplimiento >= 50) { factor = 1.0; motivo = ` · ${pctCumplimiento.toFixed(0)}% de cumplimiento, mejor mantener el mismo monto`; }
    else { factor = 0.7; motivo = ` · ${pctCumplimiento.toFixed(0)}% de cumplimiento, conviene bajarle el cupo`; }
  }

  if (riesgo === "riesgoso") factor = Math.min(factor, 0.8);

  return { monto: Math.round((montoMaximoPagado * factor) / 10000) * 10000, razon: motivo };
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
  let rutaAnterior = undefined;
  data.forEach(cliente => {
    const nombreRuta = cliente.rutas ? cliente.rutas.nombre : null;
    if (nombreRuta !== rutaAnterior) {
      contenedor.innerHTML += `<div class="grupo-ruta-titulo">📍 ${nombreRuta ? escaparHtml(nombreRuta) : "Sin ruta asignada"}</div>`;
      rutaAnterior = nombreRuta;
    }
    const riesgo = cliente.riesgo || "bueno";
    const iconoRiesgo = { bueno: "🟢", regular: "🟡", riesgoso: "🔴" }[riesgo];
    contenedor.innerHTML += `
      <div class="tarjeta cliente-clickable" onclick="abrirDetalleCliente(${cliente.id})">
        <strong>${iconoRiesgo} ${escaparHtml(cliente.nombre)}</strong>
        ${cliente.cedula ? `<span>🪪 C.C. ${escaparHtml(cliente.cedula)}</span><br>` : ""}
        <span>📞 ${escaparHtml(cliente.telefono || "sin teléfono")}</span>
      </div>`;
  });
}

function filtrarClientesLista() {
  const texto = document.getElementById("buscar-cliente-lista").value.toLowerCase();
  const filtrados = clientesCache.filter(c => c.nombre.toLowerCase().includes(texto) || (c.cedula || "").includes(texto));

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
  document.getElementById("nuevo-cliente-cedula").value = "";
  document.getElementById("nuevo-cliente-telefono").value = "";
  document.getElementById("nuevo-cliente-direccion").value = "";
  document.getElementById("nuevo-cliente-notas").value = "";
  document.getElementById("nuevo-cliente-riesgo").value = "bueno";

  await cargarRutasEnSelectorNuevoCliente();

  document.getElementById("modal-nuevo-cliente").classList.remove("oculto");
  document.getElementById("nuevo-cliente-nombre").focus();
  empujarEstadoModal("modal-nuevo-cliente");
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
  if (error) { mostrarAlerta("No fue posible crear la ruta: " + traducirErrorSupabase(error)); selectorRuta.value = ""; return; }

  await cargarRutasEnSelectorNuevoCliente(String(rutaCreada.id));
}

function cerrarModalNuevoCliente() {
  cerrarModalConHistorial("modal-nuevo-cliente");
}

async function crearClienteNuevo(event) {
  event.preventDefault();
  if (!navigator.onLine) {
    mostrarAlerta("📴 Sin conexión. Crear un cliente nuevo necesita señal — el modo offline solo guarda cobros de clientes que ya existen. Intenta de nuevo cuando vuelva la señal.");
    return;
  }
  const nombre = document.getElementById("nuevo-cliente-nombre").value.trim();
  const cedula = document.getElementById("nuevo-cliente-cedula").value.trim();
  const telefono = document.getElementById("nuevo-cliente-telefono").value.trim();
  const direccion = document.getElementById("nuevo-cliente-direccion").value.trim();
  const notas = document.getElementById("nuevo-cliente-notas").value.trim();
  const riesgo = document.getElementById("nuevo-cliente-riesgo").value;
  const rutaId = document.getElementById("nuevo-cliente-ruta").value;
  if (!nombre) { mostrarAlerta("El nombre del cliente es obligatorio."); return; }

  if (cedula) {
    const { data: cedulaDuplicada } = await supabaseClient
      .from("clientes").select("nombre, archivado").eq("cedula", cedula);
    if (cedulaDuplicada && cedulaDuplicada.length > 0) {
      const nombresExistentes = cedulaDuplicada
        .map(c => escaparHtml(c.nombre) + (c.archivado ? " (archivado)" : ""))
        .join(", ");
      const continuar = await mostrarConfirmacion(
        `Ya existe un cliente registrado con esta cédula: <strong>${nombresExistentes}</strong>.<br><br>¿Seguro que quieres crear <strong>${escaparHtml(nombre)}</strong> como un cliente nuevo de todas formas?`
      );
      if (!continuar) return;
    }
  }

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
    nombre, cedula, telefono, direccion, notas, riesgo, ruta_id: rutaId || null, user_id: user.id, archivado: false
  });
  if (error) { mostrarAlerta("No fue posible crear el cliente: " + traducirErrorSupabase(error)); return; }

  cerrarModalNuevoCliente();
  mostrarAlerta("✅ Cliente creado");
  cargarClientes();
}

// --- DETALLE DE CLIENTE (modal con pestañas) ---
let clienteDetalleActualId = null;

async function abrirDetalleCliente(clienteId) {
  clienteDetalleActualId = clienteId;
  const { data: cliente, error } = await supabaseClient.from("clientes").select("*, rutas(nombre)").eq("id", clienteId).single();
  if (error) { mostrarAlerta("Error al cargar cliente: " + traducirErrorSupabase(error)); return; }

  document.getElementById("detalle-nombre-cliente").innerText = cliente.nombre;
  cambiarTabDetalle("info");
  pintarTabInfo(cliente);

  document.getElementById("modal-detalle").classList.remove("oculto");
  empujarEstadoModal("modal-detalle");
}

function cerrarDetalleCliente() {
  cerrarModalConHistorial("modal-detalle");
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
  const sugerenciaCupo = await calcularSugerenciaCupo(cliente.id, riesgo);

  document.getElementById("tab-info").innerHTML = `
    ${activos?.length ? `<div class="resumen-cliente-operativo"><div><small>Saldo activo</small><b>${formatoPesos(saldoActivo)}</b></div><div><small>Créditos activos</small><b>${activos.length}</b></div><div><small>Cuota siguiente</small><b>${formatoPesos(proximaCuota.cuota)}</b></div></div>` : `<div class="resumen-cliente-operativo sin-credito"><span>Sin créditos activos</span><button type="button" onclick="abrirPrestamoParaCliente(${cliente.id})">Crear préstamo</button></div>`}
    ${sugerenciaCupo ? `<div class="sugerencia-cupo">💡 <b>Cupo sugerido: ${formatoPesos(sugerenciaCupo.monto)}</b>${escaparHtml(sugerenciaCupo.razon)}</div>` : ""}
    <form onsubmit="guardarEdicionCliente(event, ${cliente.id})" class="tarjeta-form">
      <input type="text" id="editar-nombre" value="${escaparHtml(cliente.nombre)}" required>
      <input type="text" id="editar-cedula" value="${escaparHtml(cliente.cedula || "")}" placeholder="Número de cédula" inputmode="numeric">
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
           <p class="nota-ayuda">Este cliente tiene ${count} préstamo(s) en su historial — lo normal es archivarlo, no borrarlo, para no perder tus reportes de meses pasados.</p>
           <p class="link-borrar-todo" onclick="forzarEliminarCliente(${cliente.id}, '${escaparAtributoJs(cliente.nombre)}')">¿Fue un error? Borrar cliente y TODO su historial para siempre</p>`
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
  if (!requiereConexion()) return;
  const nombre = document.getElementById("editar-nombre").value.trim();
  const cedula = document.getElementById("editar-cedula").value.trim();
  const telefono = document.getElementById("editar-telefono").value.trim();
  const direccion = document.getElementById("editar-direccion").value.trim();
  const notas = document.getElementById("editar-notas").value.trim();
  const riesgo = document.getElementById("editar-riesgo").value;
  if (!nombre) return mostrarAlerta("El nombre del cliente es obligatorio.");

  const { error } = await supabaseClient.from("clientes").update({ nombre, cedula, telefono, direccion, notas, riesgo }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error al guardar: " + traducirErrorSupabase(error)); return; }

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
      <p>${cliente.cedula ? `C.C. ${escaparHtml(cliente.cedula)} | ` : ""}Teléfono: ${escaparHtml(cliente.telefono || "N/A")} | Dirección: ${escaparHtml(cliente.direccion || "N/A")}</p>
      <hr>
      ${filasPrestamos || "<p>Sin préstamos registrados.</p>"}
    </body></html>
  `);
  ventana.document.close();
  ventana.print();
}

// --- BORRAR UN CLIENTE CON HISTORIAL (avanzado / errores) ---
// Lo normal es archivar, no borrar, un cliente que ya tuvo préstamos: así tus
// reportes de meses pasados no cambian. Pero si de verdad fue un error (un
// cliente de prueba, uno duplicado, etc.), el dueño de la cuenta puede
// forzar el borrado completo: se elimina el cliente Y todo su historial de
// préstamos y pagos, para siempre. Por lo delicado que es, pide escribir el
// nombre exacto del cliente para confirmar (no basta un simple "sí").
async function forzarEliminarCliente(clienteId, nombreCliente) {
  if (!requiereConexion()) return;
  const entendido = await mostrarConfirmacion(
    `⚠️ Esto borrará a "${nombreCliente}" Y todo su historial de préstamos y pagos, para siempre. Tus reportes de meses pasados van a cambiar (ya no aparecerá lo que le cobraste).<br><br>Esto normalmente NO se recomienda — para eso existe "Archivar". Solo hazlo si de verdad fue un error.<br><br>¿Quieres continuar?`
  );
  if (!entendido) return;

  const escrito = await mostrarPrompt(`Para confirmar, escribe el nombre exacto del cliente: ${nombreCliente}`);
  if (escrito === null) return;
  if (escrito.trim().toLowerCase() !== nombreCliente.trim().toLowerCase()) {
    mostrarAlerta("El nombre no coincide exactamente. No se borró nada, por seguridad.");
    return;
  }

  const { data: prestamos, error: errorConsulta } = await supabaseClient.from("prestamos").select("id").eq("cliente_id", clienteId);
  if (errorConsulta) { mostrarAlerta("Error: " + traducirErrorSupabase(errorConsulta)); return; }
  const idsPrestamos = (prestamos || []).map(p => p.id);

  if (idsPrestamos.length) {
    const { error: errorPagos } = await supabaseClient.from("pagos").delete().in("prestamo_id", idsPrestamos);
    if (errorPagos) { mostrarAlerta("No fue posible borrar los pagos del historial: " + traducirErrorSupabase(errorPagos)); return; }

    const { error: errorPrestamos } = await supabaseClient.from("prestamos").delete().eq("cliente_id", clienteId);
    if (errorPrestamos) { mostrarAlerta("No fue posible borrar los préstamos del historial: " + traducirErrorSupabase(errorPrestamos)); return; }
  }

  const { error } = await supabaseClient.from("clientes").delete().eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("🗑️ Cliente y todo su historial fueron eliminados.");
  cerrarDetalleCliente();
  cargarClientes();
}

async function eliminarCliente(clienteId) {
  if (!requiereConexion()) return;
  // Solo se llega aquí cuando el cliente NO tiene ningún préstamo en su historial
  const confirmado = await mostrarConfirmacion("¿Seguro que quieres eliminar este cliente? Esto no se puede deshacer.");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("clientes").delete().eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + traducirErrorSupabase(error)); return; }

  cerrarDetalleCliente();
  cargarClientes();
}

async function archivarCliente(clienteId) {
  if (!requiereConexion()) return;
  const confirmado = await mostrarConfirmacion("Este cliente se ocultará de tu lista de clientes activos, pero todo su historial de préstamos y pagos se conserva intacto.<br><br>¿Deseas archivarlo?");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("clientes").update({ archivado: true }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("📦 Cliente archivado");
  cerrarDetalleCliente();
  cargarClientes();
}

async function desarchivarCliente(clienteId) {
  if (!requiereConexion()) return;
  const { error } = await supabaseClient.from("clientes").update({ archivado: false }).eq("id", clienteId);
  if (error) { mostrarAlerta("Error: " + traducirErrorSupabase(error)); return; }

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
          <span class="btn-borrar-pago" onclick="eliminarPagoDesdeDetalle(${p.id})">🗑️</span>
        </div>`).join("");
}

// Igual que eliminarPago() en pagos.js, pero llamado desde la pestaña
// Historial del detalle del cliente — refresca esa pestaña en vez de la
// tarjeta de Cobrar.
async function eliminarPagoDesdeDetalle(pagoId) {
  if (!requiereConexion()) return;
  const confirmado = await mostrarConfirmacion("¿Seguro que quieres borrar este pago? Esto no se puede deshacer, y el saldo del cliente se recalculará sin este pago.");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("pagos").delete().eq("id", pagoId);
  if (error) { mostrarAlerta("No fue posible borrar el pago: " + traducirErrorSupabase(error)); return; }

  mostrarAlerta("🗑️ Pago eliminado.");
  pintarTabHistorial();
  const { data: cliente } = await supabaseClient.from("clientes").select("*, rutas(nombre)").eq("id", clienteDetalleActualId).single();
  if (cliente) pintarTabInfo(cliente);
}
