// Edge Function: crear-negocio-cliente
// Crea un negocio nuevo + su primer usuario "dueño" cada vez que le
// vendas la app a alguien. Solo la puede llamar quien esté logueado con
// un correo dentro de ADMIN_EMAILS (tú) — igual candado que usan
// listar-negocios-cliente, actualizar-perfil-negocio,
// actualizar-suscripcion-negocio y eliminar-negocio-cliente, para que
// las 5 funcionen de forma consistente cuando la app las llama con tu
// sesión normal (no hace falta ninguna clave secreta aparte ni curl).

import { createClient } from "npm:@supabase/supabase-js@2";

// Debe coincidir con ADMIN_EMAILS de las demás funciones de admin y con
// CORREOS_ADMIN_PLATAFORMA en js/usuarios.js.
const ADMIN_EMAILS = ["wilneb199910@gmail.com"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { nombre_negocio, correo, contraseña } = await req.json();

    if (!correo || !contraseña) {
      return respuesta({ error: "Faltan datos: correo y contraseña son obligatorios." }, 400);
    }
    if (String(contraseña).length < 6) {
      return respuesta({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    }

    // Confirmar que quien llama eres tú (el administrador de la
    // plataforma), usando tu sesión normal — igual que en las otras
    // funciones de este panel.
    const authHeader = req.headers.get("Authorization") ?? "";
    const clienteLlamador = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: datosUsuario, error: errorUsuario } = await clienteLlamador.auth.getUser();
    if (errorUsuario || !datosUsuario?.user) {
      return respuesta({ error: "No se pudo identificar quién está haciendo la solicitud." }, 401);
    }
    const correoQuienLlama = (datosUsuario.user.email ?? "").toLowerCase();
    if (!ADMIN_EMAILS.map((c) => c.toLowerCase()).includes(correoQuienLlama)) {
      return respuesta({ error: "No tienes permiso para crear negocios." }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Si el correo ya existía (por ejemplo, de un negocio que borraste
    // hace poco pero el correo quedó huérfano en Auth), lo recuperamos en
    // vez de fallar — mismo mecanismo que ya usa "crear-cobrador".
    let idDueño: string;
    const { data: nuevoUsuario, error: errorCrear } = await admin.auth.admin.createUser({
      email: correo,
      password: contraseña,
      email_confirm: true,
      user_metadata: { nombre: nombre_negocio ?? correo, rol: "dueño" },
    });

    if (errorCrear) {
      const yaExistia = /already.*registered/i.test(errorCrear.message ?? "");
      if (!yaExistia) {
        return respuesta({ error: "No se pudo crear el usuario: " + errorCrear.message }, 400);
      }
      const { data: idEncontrado } = await admin.rpc("buscar_usuario_por_correo", { p_correo: correo });
      if (!idEncontrado) {
        return respuesta({ error: "Ese correo ya está registrado, pero no se pudo recuperar el usuario. Bórralo manualmente en Supabase → Authentication → Users e inténtalo de nuevo." }, 400);
      }
      // Ya que recuperamos el usuario, le actualizamos la contraseña a la
      // nueva que escribiste, para que puedas entregársela al cliente.
      await admin.auth.admin.updateUserById(idEncontrado, { password: contraseña, email_confirm: true });
      idDueño = idEncontrado;
    } else {
      idDueño = nuevoUsuario.user.id;
    }

    const { data: negocio, error: errorNegocio } = await admin
      .from("negocios")
      .insert({ dueño_id: idDueño, nombre: nombre_negocio ?? null })
      .select("id")
      .single();
    if (errorNegocio) {
      if (!errorCrear) await admin.auth.admin.deleteUser(idDueño);
      return respuesta({ error: "No se pudo crear el negocio: " + errorNegocio.message }, 400);
    }

    const { error: errorMiembro } = await admin
      .from("miembros_negocio")
      .upsert({ negocio_id: negocio.id, user_id: idDueño, rol: "dueño", activo: true }, { onConflict: "negocio_id,user_id" });
    if (errorMiembro) {
      return respuesta({ error: "El negocio se creó, pero no se pudo vincular al dueño: " + errorMiembro.message }, 400);
    }

    // Perfil legible (nombre + correo), igual que se hace para cada
    // cobrador — así "Mis clientes" puede mostrar quién es quién sin
    // depender de auth.users, que el navegador no puede leer.
    const { error: errorPerfil } = await admin.from("perfiles").upsert({
      id: idDueño,
      negocio_id: negocio.id,
      nombre: nombre_negocio ?? correo,
      correo,
    });

    return respuesta({
      ok: true,
      negocio_id: negocio.id,
      user_id: idDueño,
      correo,
      mensaje: errorPerfil
        ? "Negocio creado, pero no se pudo guardar el nombre/correo del dueño (va a aparecer 'sin nombre' en Mis clientes): " + errorPerfil.message
        : "Negocio creado. Ya puedes entregarle el correo y la contraseña a tu cliente.",
    });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});