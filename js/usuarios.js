// --- GESTIÓN DE USUARIOS (ROLES Y PERMISOS) ---
// Este archivo es nuevo, no reemplaza nada de lo que ya tenías. Se encarga
// de 3 cosas:
//   1) Saber, apenas alguien inicia sesión, si es "dueño" o "cobrador" y qué
//      permisos tiene (cargarSesionActual).
//   2) Esconder del menú lo que ese usuario no debería ver (aplicarRestriccionesDeRol).
//   3) La pantalla donde el dueño crea cobradores y les marca permisos
//      (todo lo de "Gestión de usuarios").

// Catálogo de permisos: debe coincidir exactamente con los que existen en
// la base de datos (tabla permisos_miembro). Si el día de mañana agregas un
// permiso nuevo en el SQL, agrégalo aquí también con su nombre en español.
const CATALOGO_PERMISOS = [
  { clave: "ver_reportes", etiqueta: "Ver reportes", detalle: "Reportes de caja, ganancia y resultados del negocio" },
  { clave: "ver_capital", etiqueta: "Ver capital", detalle: "Ver el capital inicial y los aportes" },
  { clave: "editar_capital", etiqueta: "Editar capital", detalle: "Registrar aportes y cambiar el capital inicial" },
  { clave: "ver_gastos", etiqueta: "Ver gastos", detalle: "Ver los gastos registrados del negocio" },
  { clave: "editar_gastos", etiqueta: "Editar gastos", detalle: "Registrar, editar o borrar gastos" },
  { clave: "eliminar_pagos", etiqueta: "Eliminar pagos", detalle: "Borrar un pago ya registrado" },
  { clave: "eliminar_prestamos", etiqueta: "Eliminar préstamos", detalle: "Borrar un préstamo ya registrado" },
  { clave: "gestionar_rutas", etiqueta: "Gestionar rutas", detalle: "Crear, editar o borrar rutas" },
  { clave: "ver_todas_las_rutas", etiqueta: "Ver todas las rutas", detalle: "Sin este permiso, solo ve las rutas que le asignes" },
  { clave: "gestionar_caja", etiqueta: "Gestionar caja diaria", detalle: "Abrir/cerrar caja y ajustar la base del día" },
  { clave: "gestionar_usuarios", etiqueta: "Gestionar usuarios", detalle: "Crear cobradores y cambiarles sus permisos (úsalo con cuidado)" },
];

// Correos de quienes pueden vender la app y crear negocios nuevos (clientes
// aparte, con datos totalmente separados). Debe coincidir exactamente con
// ADMIN_EMAILS en supabase/functions/crear-negocio-cliente/index.ts — si
// cambias tu correo allá, cámbialo aquí también.
const CORREOS_ADMIN_PLATAFORMA = ["wilneb199910@gmail.com"];

function esAdminPlataforma() {
  return CORREOS_ADMIN_PLATAFORMA.map(c => c.toLowerCase()).includes((window.sesionActual.correo || "").toLowerCase());
}

// Estado de la sesión actual: se llena apenas alguien inicia sesión.
window.sesionActual = { negocioId: null, esDueño: true, permisos: new Set(), correo: null };

async function cargarSesionActual() {
  try {
    const { data: negocioId } = await supabaseClient.rpc("negocio_del_usuario");
    const { data: { user } } = await supabaseClient.auth.getUser();

    let esDueño = true;
    let permisos = new Set();

    if (negocioId) {
      const { data: negocio } = await supabaseClient.from("negocios").select("dueño_id").eq("id", negocioId).single();
      esDueño = negocio?.dueño_id === user?.id;

      if (!esDueño) {
        const { data: miembro } = await supabaseClient
          .from("miembros_negocio").select("id").eq("negocio_id", negocioId).eq("user_id", user?.id).single();
        if (miembro) {
          const { data: filasPermisos } = await supabaseClient
            .from("permisos_miembro").select("permiso").eq("miembro_id", miembro.id);
          permisos = new Set((filasPermisos || []).map(f => f.permiso));
        }
      }
    }

    window.sesionActual = { negocioId, esDueño, permisos, correo: user?.email ?? null };
  } catch {
    // Si algo falla aquí (ej. sin conexión), no bloqueamos el uso de la
    // app — simplemente se asume el modo más permisivo hasta que vuelva
    // a haber conexión y se recargue, ya que RLS igual protege los datos
    // del lado del servidor pase lo que pase en la pantalla.
    window.sesionActual = { negocioId: null, esDueño: true, permisos: new Set(), correo: null };
  }
}

// true si el usuario conectado puede hacer/ver algo con este permiso.
function tienePermiso(permiso) {
  return window.sesionActual.esDueño || window.sesionActual.permisos.has(permiso);
}

// Esconde del menú y de Configuración lo que este usuario no debería ver.
// El dueño siempre ve todo. Los elementos se marcan en el HTML con el
// atributo data-requiere-permiso="nombre_del_permiso".
function aplicarRestriccionesDeRol() {
  document.querySelectorAll("[data-requiere-permiso]").forEach(el => {
    const permiso = el.getAttribute("data-requiere-permiso");
    el.classList.toggle("oculto", !tienePermiso(permiso));
  });

  // El botón "Reportes" del menú principal usa ver_reportes.
  document.querySelectorAll('[data-nav="reportes"]').forEach(el => {
    el.classList.toggle("oculto", !tienePermiso("ver_reportes"));
  });

  // El grupo "Plataforma" (crear clientes/negocios nuevos) solo lo ve
  // quien esté en CORREOS_ADMIN_PLATAFORMA — ni siquiera los demás dueños
  // de negocio lo ven. Esto es solo para que no se preste a confusión: la
  // función de Supabase igual rechaza a cualquiera que no sea admin.
  document.getElementById("grupo-config-plataforma")?.classList.toggle("oculto", !esAdminPlataforma());
}

// ---------- FORMULARIO "CREAR CLIENTE NUEVO" (negocio aparte) ----------
// Esto es distinto de "Agregar cobrador": un cobrador se suma a TU
// negocio. Un "cliente nuevo" aquí es un negocio 100% separado, con su
// propio dueño y sus propios datos — así es como vendes la app.

function abrirFormularioNuevoNegocio() {
  const cont = document.getElementById("modal-generico-contenido");
  cont.innerHTML = `
    <div class="detalle-header"><h3>Crear cliente nuevo</h3><button class="btn-cerrar-detalle" onclick="cerrarModalGenerico()" aria-label="Cancelar">✕</button></div>
    <p class="modal-mensaje">Esto crea un negocio totalmente aparte del tuyo, con su propio acceso. Tu cliente va a poder iniciar sesión de inmediato con el correo y contraseña que le des aquí, y no va a ver nada de tus datos ni tú de los suyos.</p>
    <input type="text" id="nuevo-negocio-nombre" placeholder="Nombre del negocio (ej. el nombre de tu cliente)">
    <input type="email" id="nuevo-negocio-correo" placeholder="Correo / usuario del cliente">
    <input type="password" id="nuevo-negocio-clave" placeholder="Contraseña temporal (mínimo 6 caracteres)">
    <p id="nuevo-negocio-error" class="mensaje-modal"></p>
    <div class="modal-botones">
      <button class="btn-modal-confirmar" id="btn-crear-negocio" style="width:100%">Crear cliente</button>
      <button type="button" style="width:100%;margin-top:8px" onclick="cerrarModalGenerico()">Cancelar</button>
    </div>`;
  document.getElementById("modal-generico").classList.remove("oculto");

  document.getElementById("btn-crear-negocio").onclick = crearNegocioClienteNuevo;
}

async function crearNegocioClienteNuevo() {
  const boton = document.getElementById("btn-crear-negocio");
  const elError = document.getElementById("nuevo-negocio-error");
  const nombre = document.getElementById("nuevo-negocio-nombre").value.trim();
  const correo = document.getElementById("nuevo-negocio-correo").value.trim();
  const clave = document.getElementById("nuevo-negocio-clave").value;

  if (!correo || clave.length < 6) {
    elError.textContent = "Escribe un correo válido y una contraseña de al menos 6 caracteres.";
    return;
  }

  boton.disabled = true;
  boton.textContent = "Creando...";
  elError.textContent = "";

  try {
    const { data, error } = await supabaseClient.functions.invoke("crear-negocio-cliente", {
      body: { nombre_negocio: nombre, correo, contraseña: clave },
    });

    if (error) {
      let detalle = error.message;
      try {
        const cuerpo = await error.context.json();
        if (cuerpo?.error) detalle = cuerpo.error;
      } catch { /* si no se puede leer el detalle, nos quedamos con el mensaje genérico */ }
      elError.textContent = "Error: " + detalle;
      return;
    }
    if (data?.error) {
      elError.textContent = "Error: " + data.error;
      return;
    }

    cerrarModalGenerico();
    mostrarAlerta("✅ Cliente creado. Ya puede iniciar sesión con el correo y contraseña que le diste, y su negocio queda totalmente separado del tuyo.");
  } catch (excepcion) {
    elError.textContent = "No se pudo conectar con el servidor: " + excepcion.message;
  } finally {
    boton.disabled = false;
    boton.textContent = "Crear cliente";
  }
}

// ---------- PANTALLA "GESTIÓN DE USUARIOS" ----------

async function abrirGestionUsuarios() {
  document.getElementById("modal-usuarios").classList.remove("oculto");
  empujarEstadoModal("modal-usuarios");
  await cargarListaCobradores();
}

function cerrarGestionUsuarios() {
  cerrarModalConHistorial("modal-usuarios");
}

async function cargarListaCobradores() {
  const cont = document.getElementById("lista-cobradores");
  cont.innerHTML = `<div class="cargando">⏳ Cargando...</div>`;

  const { data: miembros, error } = await supabaseClient
    .from("miembros_negocio")
    .select("id, user_id, rol, activo, creado_en")
    .eq("negocio_id", window.sesionActual.negocioId)
    .eq("rol", "cobrador")
    .order("creado_en", { ascending: false });

  if (error) {
    cont.innerHTML = `<p class="texto-ayuda">No se pudo cargar la lista: ${error.message}</p>`;
    return;
  }
  if (!miembros || miembros.length === 0) {
    cont.innerHTML = `<p class="texto-ayuda">Todavía no tienes cobradores. Usa el botón de arriba para agregar el primero.</p>`;
    return;
  }

  const { data: todosLosPermisos } = await supabaseClient
    .from("permisos_miembro").select("miembro_id, permiso").in("miembro_id", miembros.map(m => m.id));

  // Nombre y correo reales (antes cada tarjeta solo decía "Cobrador", sin
  // forma de distinguir a uno de otro).
  const { data: perfiles } = await supabaseClient
    .from("perfiles").select("id, nombre, correo").in("id", miembros.map(m => m.user_id));
  const perfilPorUserId = new Map((perfiles || []).map(p => [p.id, p]));

  // Activos primero (con lo que trabajas día a día), luego los
  // desactivados — y dentro de cada grupo, el más nuevo arriba.
  const ordenados = [...miembros].sort((a, b) => (b.activo === a.activo ? 0 : b.activo ? 1 : -1));
  const activos = miembros.filter(m => m.activo).length;

  const resumen = document.createElement("div");
  resumen.className = "resumen-cobradores";
  resumen.innerHTML = `<span>${miembros.length} cobrador${miembros.length === 1 ? "" : "es"}</span><span class="punto-separador">·</span><span class="resumen-activos">${activos} activo${activos === 1 ? "" : "s"}</span>`;

  cont.innerHTML = "";
  cont.appendChild(resumen);
  ordenados.forEach(miembro => {
    const permisosDeEste = new Set((todosLosPermisos || []).filter(p => p.miembro_id === miembro.id).map(p => p.permiso));
    const perfil = perfilPorUserId.get(miembro.user_id);
    cont.appendChild(crearTarjetaCobrador(miembro, permisosDeEste, perfil));
  });
}

function crearTarjetaCobrador(miembro, permisosActivos, perfil) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "tarjeta-cobrador";

  const checkboxesHtml = CATALOGO_PERMISOS.map(p => `
    <label class="fila-permiso">
      <input type="checkbox" data-miembro="${miembro.id}" data-permiso="${p.clave}" ${permisosActivos.has(p.clave) ? "checked" : ""}>
      <span><b>${p.etiqueta}</b><small>${p.detalle}</small></span>
    </label>`).join("");

  const nombre = escaparHtml(perfil?.nombre || "Cobrador sin nombre");
  const correo = escaparHtml(perfil?.correo || "");
  const fechaCreacion = miembro.creado_en
    ? new Date(miembro.creado_en).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })
    : "";

  tarjeta.innerHTML = `
    <div class="tarjeta-cobrador-encabezado">
      <span>
        <b>${nombre}</b>
        <small>${correo}${correo && fechaCreacion ? " · " : ""}${fechaCreacion ? "Desde " + fechaCreacion : ""}</small>
      </span>
      <button type="button" class="btn-secundario" data-accion="toggle-activo" data-miembro="${miembro.id}" data-activo="${miembro.activo}">
        ${miembro.activo ? "Desactivar" : "Reactivar"}
      </button>
    </div>
    <div class="tarjeta-cobrador-permisos">${checkboxesHtml}</div>`;

  tarjeta.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener("change", () => cambiarPermisoCobrador(chk.dataset.miembro, chk.dataset.permiso, chk.checked));
  });
  tarjeta.querySelector('[data-accion="toggle-activo"]').addEventListener("click", (e) => {
    const btn = e.currentTarget;
    cambiarEstadoCobrador(btn.dataset.miembro, btn.dataset.activo !== "true");
  });

  return tarjeta;
}

// Prender/apagar un permiso puntual. No necesita Edge Function: la
// política de seguridad ya deja que el dueño edite esto directamente.
async function cambiarPermisoCobrador(miembroId, permiso, activar) {
  if (activar) {
    const { error } = await supabaseClient.from("permisos_miembro").insert({ miembro_id: miembroId, permiso });
    if (error && error.code !== "23505") mostrarAlerta("No se pudo activar el permiso: " + error.message); // 23505 = ya existía, lo ignoramos
  } else {
    const { error } = await supabaseClient.from("permisos_miembro").delete().eq("miembro_id", miembroId).eq("permiso", permiso);
    if (error) mostrarAlerta("No se pudo quitar el permiso: " + error.message);
  }
}

async function cambiarEstadoCobrador(miembroId, activo) {
  const { error } = await supabaseClient.from("miembros_negocio").update({ activo }).eq("id", miembroId);
  if (error) { mostrarAlerta("No se pudo actualizar: " + error.message); return; }
  await cargarListaCobradores();
}

// ---------- FORMULARIO "AGREGAR COBRADOR" ----------

function abrirFormularioNuevoCobrador() {
  const checkboxesHtml = CATALOGO_PERMISOS.map(p => `
    <label class="fila-permiso">
      <input type="checkbox" id="permiso-nuevo-${p.clave}" value="${p.clave}">
      <span><b>${p.etiqueta}</b><small>${p.detalle}</small></span>
    </label>`).join("");

  const cont = document.getElementById("modal-generico-contenido");
  cont.innerHTML = `
    <div class="detalle-header"><h3>Agregar cobrador</h3><button class="btn-cerrar-detalle" onclick="cerrarModalGenerico()" aria-label="Cancelar">✕</button></div>
    <p class="modal-mensaje">Crea el acceso para un nuevo cobrador. Va a poder iniciar sesión de inmediato con este correo y contraseña.</p>
    <input type="text" id="nuevo-cobrador-nombre" placeholder="Nombre del cobrador (opcional)">
    <input type="email" id="nuevo-cobrador-correo" placeholder="Correo del cobrador">
    <input type="password" id="nuevo-cobrador-clave" placeholder="Contraseña temporal (mínimo 6 caracteres)">
    <p class="titulo-grupo-config" style="margin-top:12px">Permisos iniciales</p>
    <div class="tarjeta-cobrador-permisos">${checkboxesHtml}</div>
    <p id="nuevo-cobrador-error" class="mensaje-modal"></p>
    <div class="modal-botones">
      <button class="btn-modal-confirmar" id="btn-crear-cobrador" style="width:100%">Crear cobrador</button>
      <button type="button" style="width:100%;margin-top:8px" onclick="cerrarModalGenerico()">Cancelar</button>
    </div>`;
  document.getElementById("modal-generico").classList.remove("oculto");

  document.getElementById("btn-crear-cobrador").onclick = crearCobradorNuevo;
}

async function crearCobradorNuevo() {
  const boton = document.getElementById("btn-crear-cobrador");
  const elError = document.getElementById("nuevo-cobrador-error");
  const nombre = document.getElementById("nuevo-cobrador-nombre").value.trim();
  const correo = document.getElementById("nuevo-cobrador-correo").value.trim();
  const clave = document.getElementById("nuevo-cobrador-clave").value;

  if (!correo || clave.length < 6) {
    elError.textContent = "Escribe un correo válido y una contraseña de al menos 6 caracteres.";
    return;
  }
  const permisos = CATALOGO_PERMISOS.map(p => p.clave).filter(clave => document.getElementById("permiso-nuevo-" + clave).checked);

  boton.disabled = true;
  boton.textContent = "Creando...";
  elError.textContent = "";

  try {
    const { data, error } = await supabaseClient.functions.invoke("crear-cobrador", {
      body: { negocio_id: window.sesionActual.negocioId, nombre, correo, contraseña: clave, permisos },
    });

    if (error) {
      let detalle = error.message;
      try {
        const cuerpo = await error.context.json();
        if (cuerpo?.error) detalle = cuerpo.error;
      } catch { /* si no se puede leer el detalle, nos quedamos con el mensaje genérico */ }
      elError.textContent = "Error: " + detalle;
      return;
    }
    if (data?.error) {
      elError.textContent = "Error: " + data.error;
      return;
    }

    cerrarModalGenerico();
    mostrarAlerta("✅ Cobrador creado. Ya puede iniciar sesión con el correo y contraseña que le diste.");
    await cargarListaCobradores();
  } catch (excepcion) {
    elError.textContent = "No se pudo conectar con el servidor: " + excepcion.message;
  } finally {
    boton.disabled = false;
    boton.textContent = "Crear cobrador";
  }
}