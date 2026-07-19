async function crearRuta(event) {
  event.preventDefault();
  if (!requiereConexion()) return;
  const nombre = document.getElementById("ruta-nombre").value.trim();
  const descripcion = document.getElementById("ruta-descripcion").value.trim();
  if (!nombre) return mostrarAlerta("El nombre de la ruta es obligatorio.");
  const user = await obtenerUsuarioActual();

  const { error } = await supabaseClient.from("rutas").insert({ nombre, descripcion, user_id: user.id });
  if (error) { mostrarAlerta("Error al crear ruta: " + traducirErrorSupabase(error)); return; }

  document.getElementById("ruta-nombre").value = "";
  document.getElementById("ruta-descripcion").value = "";
  cargarRutas();
}

async function cargarRutas() {
  mostrarCargando("lista-rutas");
  const { data, error } = await supabaseClient.from("rutas").select("*").order("nombre");
  if (error) { mostrarAlerta("No fue posible cargar las rutas."); return; }

  const contenedor = document.getElementById("lista-rutas");

  if (data.length === 0) {
    contenedor.innerHTML = `<div class="estado-vacio">📍 Aún no tienes rutas creadas.<br>Crea la primera con el formulario de arriba.</div>`;
  } else {
    contenedor.innerHTML = "";
  }

  data.forEach(ruta => {
    contenedor.innerHTML += `
      <div class="tarjeta">
        <strong>${escaparHtml(ruta.nombre)}</strong>
        <span>${escaparHtml(ruta.descripcion)}</span>
        <div class="botones-tarjeta-ruta">
          <button class="btn-ordenar-ruta" onclick="abrirOrdenRuta(${ruta.id}, '${escaparAtributoJs(ruta.nombre)}')">🔀 Ordenar clientes</button>
          <button class="btn-mapa-ruta" onclick="abrirMapaRutaCompleta(${ruta.id}, '${escaparAtributoJs(ruta.nombre)}')">🗺️ Ver ruta en el mapa</button>
        </div>
        <button class="btn-eliminar" onclick="eliminarRuta(${ruta.id})">🗑️ Eliminar ruta</button>
      </div>`;
  });

}

// --- ORDEN MANUAL DE CLIENTES DENTRO DE UNA RUTA ---
// Permite organizar los clientes en el orden real en que el cobrador los visita
// (no alfabético), usando botones ▲▼ pensados para pantalla táctil.
let listaOrdenRutaActual = [];
let rutaIdOrdenActual = null;
let ordenRutaCambiado = false;

async function abrirOrdenRuta(rutaId, nombreRuta) {
  const { data: clientes, error } = await supabaseClient
    .from("clientes").select("id, nombre, orden")
    .eq("ruta_id", rutaId).eq("archivado", false)
    .order("orden", { ascending: true, nullsFirst: false }).order("nombre");
  if (error) { mostrarAlerta("No fue posible cargar los clientes de la ruta."); return; }
  if (clientes.length === 0) { mostrarAlerta("Esta ruta todavía no tiene clientes asignados."); return; }

  rutaIdOrdenActual = rutaId;
  ordenRutaCambiado = false;
  listaOrdenRutaActual = clientes.map((c, i) => ({ ...c, orden: c.orden ?? (i + 1) }));
  pintarOrdenRuta(nombreRuta);
  document.getElementById("modal-generico").classList.remove("oculto");
}

function pintarOrdenRuta(nombreRuta) {
  const cont = document.getElementById("modal-generico-contenido");
  cont.innerHTML = `
    <h3>Orden de visita — ${escaparHtml(nombreRuta)}</h3>
    <p class="texto-ayuda">Organiza el orden en que sueles visitar a tus clientes en esta ruta. Este orden se usa para armar el mapa de la jornada.</p>
    <div class="lista-orden-ruta">
      ${listaOrdenRutaActual.map((c, i) => `
        <div class="fila-orden-cliente">
          <span>${i + 1}. ${escaparHtml(c.nombre)}</span>
          <span class="botones-orden">
            <button type="button" ${i === 0 ? "disabled" : ""} onclick="moverClienteOrden(${i}, -1)">▲</button>
            <button type="button" ${i === listaOrdenRutaActual.length - 1 ? "disabled" : ""} onclick="moverClienteOrden(${i}, 1)">▼</button>
          </span>
        </div>`).join("")}
    </div>
    <div id="historial-orden-ruta"></div>
    <div class="modal-botones">
      <button class="btn-modal-cancelar" onclick="verHistorialOrdenRuta()">🕓 Ver últimos cambios</button>
      <button class="btn-modal-confirmar" onclick="cerrarOrdenRutaYGuardarHistorial()">Listo</button>
    </div>`;
}

// Deja un registro de cómo quedó el orden cada vez que se cierra el editor
// (si hubo algún cambio), para poder revisar o deshacer un ajuste accidental.
async function cerrarOrdenRutaYGuardarHistorial() {
  if (ordenRutaCambiado && rutaIdOrdenActual && navigator.onLine) {
    const user = await obtenerUsuarioActual();
    await supabaseClient.from("historial_orden_ruta").insert({
      ruta_id: rutaIdOrdenActual, user_id: user.id,
      orden: listaOrdenRutaActual.map(c => ({ id: c.id, nombre: c.nombre, orden: c.orden }))
    });
  }
  cerrarModalGenerico();
}

async function verHistorialOrdenRuta() {
  const cont = document.getElementById("historial-orden-ruta");
  if (!cont) return;
  cont.innerHTML = '<div class="cargando">Cargando historial...</div>';
  const { data, error } = await supabaseClient
    .from("historial_orden_ruta").select("creado_en, orden")
    .eq("ruta_id", rutaIdOrdenActual).order("creado_en", { ascending: false }).limit(5);
  if (error) { cont.innerHTML = '<p class="texto-ayuda">No fue posible cargar el historial (¿ejecutaste la migración 20260720?).</p>'; return; }
  cont.innerHTML = !data.length
    ? '<p class="texto-ayuda">Todavía no hay cambios de orden guardados para esta ruta.</p>'
    : `<p class="texto-ayuda">Últimos ${data.length} cambio(s):</p>` + data.map(h =>
        `<div class="fila-historial"><span>${new Date(h.creado_en).toLocaleString()}</span><span>${h.orden.map(c => escaparHtml(c.nombre)).join(" → ")}</span></div>`
      ).join("");
}

async function moverClienteOrden(indice, direccion) {
  if (!navigator.onLine) { mostrarAlerta("📴 Necesitas conexión para reordenar la ruta — el nuevo orden no se pudo guardar."); return; }
  const nuevoIndice = indice + direccion;
  if (nuevoIndice < 0 || nuevoIndice >= listaOrdenRutaActual.length) return;
  const tituloModal = document.querySelector("#modal-generico-contenido h3").textContent.replace("Orden de visita — ", "");

  [listaOrdenRutaActual[indice], listaOrdenRutaActual[nuevoIndice]] = [listaOrdenRutaActual[nuevoIndice], listaOrdenRutaActual[indice]];
  listaOrdenRutaActual.forEach((c, i) => c.orden = i + 1);
  ordenRutaCambiado = true;
  pintarOrdenRuta(tituloModal);

  await Promise.all(listaOrdenRutaActual.map(c =>
    supabaseClient.from("clientes").update({ orden: c.orden }).eq("id", c.id)
  ));
}

async function abrirMapaRutaCompleta(rutaId, nombreRuta) {
  const { data: clientes, error } = await supabaseClient
    .from("clientes").select("nombre, direccion, orden")
    .eq("ruta_id", rutaId).eq("archivado", false)
    .order("orden", { ascending: true, nullsFirst: false }).order("nombre");
  if (error) { mostrarAlerta("No fue posible cargar los clientes de la ruta."); return; }

  const conDireccion = clientes.filter(c => c.direccion && c.direccion.trim());
  if (conDireccion.length === 0) {
    mostrarAlerta(`Ningún cliente de "${nombreRuta}" tiene dirección registrada todavía.`);
    return;
  }
  const url = construirUrlMapaClientes(conDireccion.map(c => c.direccion));
  window.open(url, "_blank", "noopener");
}

async function eliminarRuta(rutaId) {
  if (!requiereConexion()) return;
  const { count } = await supabaseClient
    .from("clientes").select("*", { count: "exact", head: true }).eq("ruta_id", rutaId);

  if (count > 0) {
    mostrarAlerta(`No se puede eliminar: hay ${count} cliente(s) asignados a esta ruta. Reasígnalos primero.`);
    return;
  }

  const confirmado = await mostrarConfirmacion("¿Seguro que quieres eliminar esta ruta?");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("rutas").delete().eq("id", rutaId);
  if (error) { mostrarAlerta("Error: " + traducirErrorSupabase(error)); return; }
  cargarRutas();
}
