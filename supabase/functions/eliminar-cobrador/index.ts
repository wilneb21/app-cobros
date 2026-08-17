// Edge Function: eliminar-cobrador
// El dueño de un negocio (o alguien con permiso "gestionar_usuarios") la
// llama para borrar POR COMPLETO a un cobrador: su cuenta de Auth, su
// perfil, sus permisos y su vínculo con el negocio. Es distinto de
// "Desactivar" (que solo le quita el acceso pero deja todo guardado) —
// esto no se puede deshacer.
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
    const { miembro_id } = await req.json();
    if (!miembro_id) {
      return respuesta({ error: "Falta el dato: miembro_id es obligatorio." }, 400);
    }

    // Confirmar quién llama.
    const authHeader = req.headers.get("Authorization") ?? "";
    const clienteLlamador = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: datosUsuario, error: errorUsuario } = await clienteLlamador.auth.getUser();
    if (errorUsuario || !datosUsuario?.user) {
      return respuesta({ error: "No se pudo identificar quién está haciendo la solicitud." }, 401);
    }
    const idQuienLlama = datosUsuario.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Buscar al miembro para saber a qué negocio pertenece y quién es.
    const { data: miembro, error: errorMiembro } = await admin
      .from("miembros_negocio")
      .select("id, negocio_id, user_id, rol")
      .eq("id", miembro_id)
      .single();
    if (errorMiembro || !miembro) {
      return respuesta({ error: "Ese cobrador no existe o ya fue eliminado." }, 404);
    }

    // Confirmar que quien llama es el dueño de ESE negocio (o tiene el
    // permiso de gestionar usuarios ahí) — igual que en crear-cobrador.
    const { data: negocio, error: errorNegocio } = await admin
      .from("negocios")
      .select("id, dueño_id")
      .eq("id", miembro.negocio_id)
      .single();
    if (errorNegocio || !negocio) {
      return respuesta({ error: "Ese negocio no existe." }, 404);
    }

    let autorizado = negocio.dueño_id === idQuienLlama;
    if (!autorizado) {
      const { data: tienePermiso } = await admin.rpc("tiene_permiso", {
        p_negocio_id: miembro.negocio_id,
        p_permiso: "gestionar_usuarios",
      });
      autorizado = !!tienePermiso;
    }
    if (!autorizado) {
      return respuesta({ error: "No tienes permiso para eliminar cobradores en este negocio." }, 403);
    }
    // Nadie puede eliminarse a sí mismo por aquí (evita que un cobrador
    // con el permiso de gestionar usuarios se borre por accidente y se
    // quede sin poder volver a entrar).
    if (miembro.user_id === idQuienLlama) {
      return respuesta({ error: "No puedes eliminar tu propia cuenta desde aquí." }, 400);
    }

    // Borrar en orden: primero lo que depende de miembro_id, luego el
    // vínculo con el negocio, luego el perfil, y al final la cuenta de
    // Auth (lo más difícil de deshacer, por eso va de último).
    await admin.from("permisos_miembro").delete().eq("miembro_id", miembro.id);
    await admin.from("rutas").update({ cobrador_id: null }).eq("cobrador_id", miembro.user_id);

    const { error: errorBorrarMiembro } = await admin.from("miembros_negocio").delete().eq("id", miembro.id);
    if (errorBorrarMiembro) {
      return respuesta({ error: "No se pudo quitar al cobrador del negocio: " + errorBorrarMiembro.message }, 400);
    }

    await admin.from("perfiles").delete().eq("id", miembro.user_id);
    await admin.auth.admin.deleteUser(miembro.user_id);

    return respuesta({ ok: true });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});