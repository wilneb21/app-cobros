// Edge Function: crear-negocio-cliente
// Esta es TU herramienta (la del dueño de la plataforma) para vender la app:
// crea de un solo golpe un negocio nuevo y totalmente separado (con su propio
// "dueño_id"), más el usuario de Auth para que ese cliente pueda iniciar
// sesión de inmediato con el correo y contraseña que tú le des.
//
// A propósito NO es algo que cualquier dueño de negocio pueda llamar: solo
// puede usarla quien tenga su correo en ADMIN_EMAILS más abajo. Cualquier
// otro intento se rechaza, aunque tenga una sesión válida.
//
// No necesita variables de entorno nuevas: SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY ya existen automáticamente en toda Edge
// Function de Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

// --- CAMBIA ESTO: pon aquí tu correo (el que usas para iniciar sesión en
// tu propia cuenta). Puedes agregar más de uno separados por coma si más
// adelante alguien más de tu equipo también va a vender/crear clientes. ---
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

    // Confirmar que quien llama es de verdad tú (o alguien de tu lista de
    // administradores de la plataforma), no un dueño de negocio cualquiera.
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
      return respuesta({ error: "No tienes permiso para crear negocios nuevos." }, 403);
    }

    // A partir de aquí ya se confirmó que quien llama es admin: se usa el
    // cliente con permisos totales (Service Role) para crear el usuario y
    // el negocio.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Crear el usuario en Supabase Auth, ya con el correo confirmado para
    // que el cliente pueda entrar de inmediato sin pasos extra.
    const { data: nuevoUsuario, error: errorCrear } = await admin.auth.admin.createUser({
      email: correo,
      password: contraseña,
      email_confirm: true,
      user_metadata: { nombre: nombre_negocio ?? correo, rol: "dueño" },
    });

    if (errorCrear) {
      return respuesta({ error: errorCrear.message }, 400);
    }
    const idNuevoDueño = nuevoUsuario.user.id;

    // Crear su negocio, ya separado de todos los demás (dueño_id distinto
    // = datos distintos: así los aísla la seguridad que ya tiene la base
    // de datos para cada negocio).
    const { data: negocio, error: errorNegocio } = await admin
      .from("negocios")
      .insert({ nombre: nombre_negocio || "Mi negocio", dueño_id: idNuevoDueño })
      .select("id, nombre")
      .single();

    if (errorNegocio) {
      // Si el negocio no se pudo crear, no dejamos un usuario de Auth
      // huérfano sin negocio asociado.
      await admin.auth.admin.deleteUser(idNuevoDueño);
      return respuesta({ error: "No se pudo crear el negocio: " + errorNegocio.message }, 400);
    }

    return respuesta({ ok: true, user_id: idNuevoDueño, negocio_id: negocio.id, nombre: negocio.nombre });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});