// Edge Function: actualizar-perfil-negocio
// Hermana de "crear-negocio-cliente" y "listar-negocios-cliente": mismo
// candado (solo quien esté en ADMIN_EMAILS puede llamarla). Corrige el
// nombre/correo guardado en "perfiles" para el dueño de un negocio —
// hace falta porque tú (el administrador de la plataforma) no eres
// miembro de esos negocios, así que no puedes editar su perfil directo
// desde el navegador (la seguridad de la base de datos no te deja).

import { createClient } from "npm:@supabase/supabase-js@2";

// Debe coincidir con ADMIN_EMAILS de crear-negocio-cliente/index.ts,
// listar-negocios-cliente/index.ts y CORREOS_ADMIN_PLATAFORMA en
// js/usuarios.js.
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
    const { dueño_id, negocio_id, nombre, correo } = await req.json();
    if (!dueño_id || !negocio_id) {
      return respuesta({ error: "Faltan datos: dueño_id y negocio_id son obligatorios." }, 400);
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
      return respuesta({ error: "No tienes permiso para editar esto." }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error: errorPerfil } = await admin.from("perfiles").upsert({
      id: dueño_id,
      negocio_id,
      nombre: nombre?.trim() || null,
      correo: correo?.trim() || null,
    });
    if (errorPerfil) {
      return respuesta({ error: errorPerfil.message }, 400);
    }

    return respuesta({ ok: true });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});