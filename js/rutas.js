async function crearRuta(event) {
  event.preventDefault();
  const nombre = document.getElementById("ruta-nombre").value;
  const descripcion = document.getElementById("ruta-descripcion").value;
  const { data: userData } = await supabaseClient.auth.getUser();

  const { error } = await supabaseClient.from("rutas").insert({ nombre, descripcion, user_id: userData.user.id });
  if (error) { mostrarAlerta("Error al crear ruta: " + error.message); return; }

  document.getElementById("ruta-nombre").value = "";
  document.getElementById("ruta-descripcion").value = "";
  cargarRutas();
}

async function cargarRutas() {
  mostrarCargando("lista-rutas");
  const { data, error } = await supabaseClient.from("rutas").select("*").order("nombre");
  if (error) { console.error(error); return; }

  const contenedor = document.getElementById("lista-rutas");

  if (data.length === 0) {
    contenedor.innerHTML = `<div class="estado-vacio">📍 Aún no tienes rutas creadas.<br>Crea la primera con el formulario de arriba.</div>`;
  } else {
    contenedor.innerHTML = "";
  }

  data.forEach(ruta => {
    contenedor.innerHTML += `
      <div class="tarjeta">
        <strong>${ruta.nombre}</strong>
        <span>${ruta.descripcion || ""}</span>
        <button class="btn-eliminar" onclick="eliminarRuta(${ruta.id})">🗑️ Eliminar ruta</button>
      </div>`;
  });

  const selector = document.getElementById("cliente-ruta");
  selector.innerHTML = '<option value="">Selecciona una ruta</option>';
  data.forEach(ruta => selector.innerHTML += `<option value="${ruta.id}">${ruta.nombre}</option>`);
}

async function eliminarRuta(rutaId) {
  const { count } = await supabaseClient
    .from("clientes").select("*", { count: "exact", head: true }).eq("ruta_id", rutaId);

  if (count > 0) {
    mostrarAlerta(`No se puede eliminar: hay ${count} cliente(s) asignados a esta ruta. Reasígnalos primero.`);
    return;
  }

  const confirmado = await mostrarConfirmacion("¿Seguro que quieres eliminar esta ruta?");
  if (!confirmado) return;

  const { error } = await supabaseClient.from("rutas").delete().eq("id", rutaId);
  if (error) { mostrarAlerta("Error: " + error.message); return; }
  cargarRutas();
}