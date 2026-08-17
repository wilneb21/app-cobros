// Edge Function: listar-negocios-cliente
// Hermana de "crear-negocio-cliente": mismo candado (solo quien esté en
// ADMIN_EMAILS puede llamarla), pero en vez de crear, devuelve la lista
// completa de negocios que has creado — con el nombre/correo del dueño de
// cada uno (desde la tabla "perfiles") y cuántos cobradores tiene cada uno.

import { createClient } from "npm:@supabase/supabase-js@2";

// Debe coincidir con ADMIN_EMAILS de crear-negocio-cliente/index.ts y con
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
      return respuesta({ error: "No tienes permiso para ver esta lista." }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: negocios, error: errorNegocios } = await admin
      .from("negocios")
      .select("*")
      .order("id", { ascending: false });
    if (errorNegocios) return respuesta({ error: errorNegocios.message }, 400);

    const idsDueños = (negocios || []).map((n) => n.dueño_id).filter(Boolean);
    const { data: perfiles } = idsDueños.length
      ? await admin.from("perfiles").select("id, nombre, correo").in("id", idsDueños)
      : { data: [] };
    const perfilPorId = new Map((perfiles || []).map((p) => [p.id, p]));

    const idsNegocios = (negocios || []).map((n) => n.id);
    const { data: miembros } = idsNegocios.length
      ? await admin.from("miembros_negocio").select("negocio_id, rol, activo").in("negocio_id", idsNegocios).eq("rol", "cobrador")
      : { data: [] };

    const resultado = (negocios || []).map((n) => {
      const perfil = perfilPorId.get(n.dueño_id);
      const cobradores = (miembros || []).filter((m) => m.negocio_id === n.id);
      return {
        id: n.id,
        dueño_id: n.dueño_id,
        nombre: n.nombre ?? null,
        dueño_nombre: perfil?.nombre ?? null,
        dueño_correo: perfil?.correo ?? null,
        creado_en: n.creado_en ?? n.created_at ?? null,
        total_cobradores: cobradores.length,
        cobradores_activos: cobradores.filter((m) => m.activo).length,
      };
    });

    return respuesta({ ok: true, negocios: resultado });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});