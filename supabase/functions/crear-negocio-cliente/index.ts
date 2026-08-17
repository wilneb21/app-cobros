// Edge Function: crear-negocio
// ⚠️ ESTA FUNCIÓN ES SOLO PARA TI (el vendedor de la app), no la llama la
// app desde el navegador. Con ella creas un negocio nuevo + su primer
// usuario "dueño" cada vez que le vendas la app a alguien, con el correo
// y la contraseña que tú definas.
//
// Protegida por una clave secreta propia (variable de entorno ADMIN_SECRET),
// nunca por sesión de usuario, porque tú no eres dueño de ningún negocio
// del sistema.
//
// CONFIGURAR EL SECRETO (una sola vez):
//   supabase secrets set ADMIN_SECRET=elige-algo-largo-y-dificil-de-adivinar
//
// USO para crear un cliente nuevo:
//   curl -X POST https://TU-PROYECTO.supabase.co/functions/v1/crear-negocio \
//     -H "Content-Type: application/json" \
//     -H "x-admin-secret: elige-algo-largo-y-dificil-de-adivinar" \
//     -d '{
//       "nombre_negocio": "Cobros Doña María",
//       "correo": "maria@correo.com",
//       "contraseña": "unaClaveTemporalSegura123"
//     }'

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-secret",
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

  const secretoRecibido = req.headers.get("x-admin-secret");
  if (!ADMIN_SECRET || secretoRecibido !== ADMIN_SECRET) {
    return respuesta({ error: "No autorizado." }, 401);
  }

  try {
    const { nombre_negocio, correo, contraseña } = await req.json();

    if (!correo || !contraseña) {
      return respuesta({ error: "Faltan datos: correo y contraseña son obligatorios." }, 400);
    }
    if (String(contraseña).length < 6) {
      return respuesta({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: nuevoUsuario, error: errorCrear } = await admin.auth.admin.createUser({
      email: correo,
      password: contraseña,
      email_confirm: true,
      user_metadata: { nombre: nombre_negocio ?? correo, rol: "dueño" },
    });
    if (errorCrear) {
      return respuesta({ error: "No se pudo crear el usuario: " + errorCrear.message }, 400);
    }
    const idDueño = nuevoUsuario.user.id;

    const { data: negocio, error: errorNegocio } = await admin
      .from("negocios")
      .insert({ dueño_id: idDueño, nombre: nombre_negocio ?? null })
      .select("id")
      .single();
    if (errorNegocio) {
      await admin.auth.admin.deleteUser(idDueño);
      return respuesta({ error: "No se pudo crear el negocio: " + errorNegocio.message }, 400);
    }

    const { error: errorMiembro } = await admin
      .from("miembros_negocio")
      .insert({ negocio_id: negocio.id, user_id: idDueño, rol: "dueño", activo: true });
    if (errorMiembro) {
      return respuesta({ error: "El negocio se creó, pero no se pudo vincular al dueño: " + errorMiembro.message }, 400);
    }

    // Perfil legible (nombre + correo), igual que se hace para cada
    // cobrador — así "Gestión de usuarios" puede mostrar quién es quién
    // sin depender de auth.users, que el navegador no puede leer.
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