// Edge Function: eliminar-negocio-cliente
// ⚠️ BORRA POR COMPLETO un negocio/cliente: todos sus clientes, préstamos,
// pagos, gastos, rutas, caja, capital, sus cobradores, y al dueño. No se
// puede deshacer. Solo la llama quien esté en ADMIN_EMAILS (tú, el
// vendedor de la app) — nunca el dueño de un negocio sobre sí mismo.
//
// Si lo que quieres es solo SUSPENDER a un cliente que dejó de pagar (sin
// borrar su información), usa "actualizar-suscripcion-negocio" en vez de
// esta — esta es solo para cuando de verdad quieres borrar todo.

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

// Tablas que tienen negocio_id y deben borrarse ANTES que el negocio (por
// las llaves foráneas). Si en tu base te falta alguna de estas tablas, la
// función simplemente no encuentra nada que borrar ahí y sigue de largo.
const TABLAS_CON_NEGOCIO_ID = [
  "pagos_auditoria", "operaciones_auditoria", "historial_orden_ruta",
  "cargos_mora", "pagos", "prestamos", "clientes", "rutas", "gastos",
  "caja_diaria", "aportes_capital", "historial_capital_inicial",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { negocio_id, confirmacion_nombre } = await req.json();
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
      return respuesta({ error: "No tienes permiso para eliminar negocios." }, 403);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: negocio, error: errorNegocio } = await admin
      .from("negocios").select("id, nombre, dueño_id").eq("id", negocio_id).single();
    if (errorNegocio || !negocio) {
      return respuesta({ error: "Ese negocio no existe o ya fue eliminado." }, 404);
    }

    // Segundo seguro: quien llama debe escribir el nombre exacto del
    // negocio (tal como aparece en la tarjeta) para confirmar. Evita un
    // clic accidental sobre el negocio equivocado.
    if ((confirmacion_nombre ?? "").trim() !== (negocio.nombre ?? "").trim()) {
      return respuesta({ error: "El nombre escrito no coincide con el nombre del negocio. No se eliminó nada." }, 400);
    }

    // Cobradores de este negocio: se borran su cuenta de Auth también.
    const { data: cobradores } = await admin
      .from("miembros_negocio").select("user_id").eq("negocio_id", negocio_id).eq("rol", "cobrador");

    // Borra en orden: primero todo lo que depende de negocio_id, luego
    // los vínculos de miembros/permisos, luego el negocio, y al final las
    // cuentas de Auth (dueño + cobradores).
    for (const tabla of TABLAS_CON_NEGOCIO_ID) {
      await admin.from(tabla).delete().eq("negocio_id", negocio_id);
    }

    const { data: miembros } = await admin
      .from("miembros_negocio").select("id").eq("negocio_id", negocio_id);
    const idsMiembros = (miembros || []).map((m) => m.id);
    if (idsMiembros.length) {
      await admin.from("permisos_miembro").delete().in("miembro_id", idsMiembros);
    }
    await admin.from("miembros_negocio").delete().eq("negocio_id", negocio_id);
    await admin.from("perfiles").delete().eq("negocio_id", negocio_id);

    const { error: errorBorrarNegocio } = await admin.from("negocios").delete().eq("id", negocio_id);
    if (errorBorrarNegocio) {
      return respuesta({ error: "No se pudo eliminar el negocio (puede que le falte borrar algo primero): " + errorBorrarNegocio.message }, 400);
    }

    // Cuentas de Auth: al final, porque son lo más difícil de deshacer.
    for (const cobrador of cobradores || []) {
      await admin.auth.admin.deleteUser(cobrador.user_id);
    }
    await admin.auth.admin.deleteUser(negocio.dueño_id);

    return respuesta({ ok: true, mensaje: `El negocio "${negocio.nombre}" y todos sus datos fueron eliminados.` });
  } catch (excepcion) {
    return respuesta({ error: "Error inesperado: " + (excepcion as Error).message }, 500);
  }
});