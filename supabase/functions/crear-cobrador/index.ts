// Edge Function: crear-cobrador
// El dueño de un negocio la llama desde la app para crear un usuario
// cobrador nuevo (correo + contraseña temporal). Usa la Service Role
// Key para poder crear usuarios de Auth — por eso esto NO se puede hacer
// directo desde el navegador, tiene que pasar por aquí.
//
// No necesita variables de entorno nuevas: SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY ya existen automáticamente en toda Edge
// Function de Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { negocio_id, nombre, correo, contraseña, permisos, ruta_ids } = await req.json();

    if (!negocio_id || !correo || !contraseña) {
      return respuesta({ error: "Faltan datos: negocio_id, correo y contraseña son obligatorios." }, 400);
    }
    if (String(contraseña).length < 6) {
      return respuesta({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    }

    // Cliente "como el usuario que llama" — para saber quién es y
    // confirmar que de verdad es el dueño de ese negocio (o tiene el
    // permiso de gestionar usuarios).
    const authHeader = req.headers.get("Authorization") ?? "";
    const clienteLlamador = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: datosUsuario, error: errorUsuario } = await clienteLlamador.auth.getUser();
    if (errorUsuario || !datosUsuario?.user) {
      return respuesta({ error: "No se pudo identificar quién está haciendo la solicitud." }, 401);
    }
    const idQuienLlama = datosUsuario.user.id;

    // Cliente con permisos de administrador (Service Role) — solo se usa
    // DESPUÉS de confirmar que quien llama tiene derecho a hacer esto.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: negocio, error: errorNegocio } = await admin
      .from("negocios")
      .select("id, dueño_id")
      .eq("id", negocio_id)
      .single();
    if (errorNegocio || !negocio) {
      return respuesta({ error: "Ese negocio no existe." }, 404);
    }

    let autorizado = negocio.dueño_id === idQuienLlama;
    if (!autorizado) {
      const { data: tienePermiso } = await admin.rpc("tiene_permiso", {
        p_negocio_id: negocio_id,
        p_permiso: "gestionar_usuarios",
      });
      autorizado = !!tienePermiso;
    }
    if (!autorizado) {
      return respuesta({ error: "No tienes permiso para crear usuarios en este negocio." }, 403);
    }

    // Crear el usuario en Supabase Auth, ya con el correo confirmado
    // (para que pueda iniciar sesión de inmediato sin pasos extra).
    let idUsuarioCobrador;
    const { data: nuevoUsuario, error: errorCrear } = await admin.auth.admin.createUser({
      email: correo,
      password: contraseña,
      email_confirm: true,
      user_metadata: { nombre: nombre ?? correo, rol: "cobrador" },
    });

    if (errorCrear) {
      const yaExistia = /already.*registered/i.test(errorCrear.message ?? "");
      if (!yaExistia) {
        return respuesta({ error: errorCrear.message }, 400);
      }
      // El correo ya tenía un usuario de Auth creado (probablemente de un
      // intento anterior que se cortó a medias). En vez de fallar, lo
      // recuperamos y seguimos vinculándolo normalmente.
      const { data: idEncontrado } = await admin.rpc("buscar_usuario_por_correo", { p_correo: correo });
      if (!idEncontrado) {
        return respuesta({ error: "Ese correo ya está registrado, pero no se pudo recuperar el usuario. Bórralo manualmente en Supabase → Authentication → Users e inténtalo de nuevo." }, 400);
      }
      idUsuarioCobrador = idEncontrado;
    } else {
      idUsuarioCobrador = nuevoUsuario.user.id;
    }

    // Agregarlo como miembro cobrador de este negocio (si ya estaba
    // vinculado de un intento anterior, esto simplemente lo confirma en
    // vez de duplicarlo o fallar).
    const { data: miembro, error: errorMiembro } = await admin
      .from("miembros_negocio")
      .upsert({ negocio_id, user_id: idUsuarioCobrador, rol: "cobrador", activo: true }, { onConflict: "negocio_id,user_id" })
      .select("id")
      .single();
    if (errorMiembro) {
      // Solo borramos el usuario de Auth si de verdad lo acabamos de crear
      // en esta misma solicitud (si era uno recuperado, no lo tocamos).
      if (!errorCrear) await admin.auth.admin.deleteUser(idUsuarioCobrador);
      return respuesta({ error: "No se pudo vincular el cobrador al negocio: " + errorMiembro.message }, 400);
    }

    // Permisos iniciales (opcional): el dueño puede mandarlos ya
    // marcados desde el formulario de creación.
    if (Array.isArray(permisos) && permisos.length > 0) {
      const filasPermisos = permisos.map((permiso: string) => ({ miembro_id: miembro.id, permiso }));
      await admin.from("permisos_miembro").insert(filasPermisos);
    }

    // Rutas asignadas (opcional).
    if (Array.isArray(ruta_ids) && ruta_ids.length > 0) {
      await admin.from("rutas").update({ cobrador_id: idUsuarioCobrador }).in("id", ruta_ids).eq("negocio_id", negocio_id);
    }

    return respuesta({ ok: true, user_id: idUsuarioCobrador, miembro_id: miembro.id });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});