// Edge Function: actualizar-suscripcion-negocio
// Le permite renovar o suspender el acceso de un negocio/cliente, sin
// borrar ninguno de sus datos. Mientras "activo" sea true y la fecha de
// "plan_vence_en" no haya pasado (o esté vacía = sin vencimiento), el
// negocio funciona normal. En el momento en que uno de los dos falle,
// TODO el negocio (dueño + cobradores) pierde acceso automáticamente —
// no hay que tocar nada más.
//
// Solo la llama quien esté en ADMIN_EMAILS (tú, el vendedor de la app).

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
    // plan_vence_en: string "AAAA-MM-DD", o null para "sin vencimiento".
    // activo: true/false. Solo se actualiza lo que venga definido (undefined
    // se ignora, para poder cambiar uno sin tocar el otro).
    const { negocio_id, activo, plan_vence_en } = await req.json();
    if (!negocio_id) {
      return respuesta({ error: "Falta el dato: negocio_id es obligatorio." }, 400);
    }

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
      return respuesta({ error: "No tienes permiso para hacer esto." }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const cambios: Record<string, unknown> = {};
    if (typeof activo === "boolean") cambios.activo = activo;
    if (plan_vence_en !== undefined) cambios.plan_vence_en = plan_vence_en; // acepta null

    if (Object.keys(cambios).length === 0) {
      return respuesta({ error: "No mandaste ningún cambio (activo o plan_vence_en)." }, 400);
    }

    const { data, error } = await admin
      .from("negocios").update(cambios).eq("id", negocio_id).select("id, activo, plan_vence_en").single();
    if (error) {
      return respuesta({ error: error.message }, 400);
    }

    return respuesta({ ok: true, negocio: data });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});