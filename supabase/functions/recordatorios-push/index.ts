// Edge Function: recordatorios-push
// Se ejecuta una vez al día (programada con pg_cron, ver SUPABASE_SETUP.md).
// Revisa, para cada usuario, qué cuotas vencen MAÑANA y si tiene el cuadre
// automático de caja activado sin haber contado el efectivo físico HOY, y le
// manda un push real a cada dispositivo donde haya activado las
// notificaciones — sin depender de que la app esté abierta.
//
// Variables de entorno necesarias (Supabase → Project Settings → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej: mailto:tucorreo@dominio.com)
//   CRON_SECRET (una clave inventada por ti, para que nadie más pueda llamar esta función)
//   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen automáticamente en toda Edge Function.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:soporte@ejemplo.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function fechaBogota(offsetDias = 0) {
  const formateador = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
  const base = new Date(formateador.format(new Date()) + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + offsetDias);
  return base.toISOString().slice(0, 10);
}

function sumarDias(fechaTexto: string, dias: number) {
  const fecha = new Date(fechaTexto + "T00:00:00Z");
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function formatoPesos(numero: number) {
  return "$" + Math.round(numero).toLocaleString("es-CO");
}

Deno.serve(async (req) => {
  // Protección simple: solo pg_cron (que conoce el secreto) puede disparar esto.
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("No autorizado", { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const manana = fechaBogota(1);
  const hoy = fechaBogota(0);

  const { data: prestamos, error: errorPrestamos } = await supabase
    .from("prestamos")
    .select("id, cuota, frecuencia, fecha_inicio, user_id")
    .eq("estado", "activo");
  if (errorPrestamos) return new Response(JSON.stringify({ error: errorPrestamos.message }), { status: 500 });

  const ids = (prestamos ?? []).map((p) => p.id);
  const { data: pagos } = ids.length
    ? await supabase.from("pagos").select("prestamo_id, monto_pagado").in("prestamo_id", ids)
    : { data: [] as { prestamo_id: number; monto_pagado: number }[] };

  const totalPagado: Record<number, number> = {};
  (pagos ?? []).forEach((pg) => {
    totalPagado[pg.prestamo_id] = (totalPagado[pg.prestamo_id] || 0) + Number(pg.monto_pagado);
  });

  // Igual que en js/main.js (cargarAgendaVencimientos): la próxima cuota se
  // calcula por el total acumulado pagado, no por registros individuales.
  const porUsuario: Record<string, { cantidad: number; monto: number }> = {};
  for (const p of prestamos ?? []) {
    const cuotasPagadas = Math.floor((totalPagado[p.id] || 0) / Number(p.cuota));
    const diasPorCuota = p.frecuencia === "semanal" ? 7 : 1;
    const proximaFecha = sumarDias(p.fecha_inicio, cuotasPagadas * diasPorCuota);
    if (proximaFecha !== manana) continue;
    if (!porUsuario[p.user_id]) porUsuario[p.user_id] = { cantidad: 0, monto: 0 };
    porUsuario[p.user_id].cantidad++;
    porUsuario[p.user_id].monto += Number(p.cuota);
  }

  // Caja sin verificar: solo aplica a quienes tienen el cuadre AUTOMÁTICO
  // activado (en modo manual, cerrar caja ya obliga a contar cada día, así
  // que no hace falta recordárselo). Se avisa si hoy todavía no se ha
  // contado el efectivo físico (efectivo_final sigue en null).
  const { data: preferencias } = await supabase
    .from("preferencias_usuario").select("user_id").eq("caja_automatica", true);
  const usuariosConAutomatico = (preferencias ?? []).map((p) => p.user_id);

  const usuariosSinVerificarCaja = new Set<string>();
  if (usuariosConAutomatico.length > 0) {
    const { data: cajasHoy } = await supabase
      .from("caja_diaria").select("user_id, efectivo_final").eq("fecha", hoy).in("user_id", usuariosConAutomatico);
    const yaContaron = new Set((cajasHoy ?? []).filter((c) => c.efectivo_final !== null && c.efectivo_final !== undefined).map((c) => c.user_id));
    const cajasAbiertasHoy = new Set((cajasHoy ?? []).map((c) => c.user_id));
    for (const uid of usuariosConAutomatico) {
      // Solo se avisa si la caja de hoy existe (o sea, ya se usó la app hoy)
      // y no se ha contado — si nunca se abrió, no tiene caso recordarle.
      if (cajasAbiertasHoy.has(uid) && !yaContaron.has(uid)) usuariosSinVerificarCaja.add(uid);
    }
  }

  const usuariosAAvisar = new Set([...Object.keys(porUsuario), ...usuariosSinVerificarCaja]);
  if (usuariosAAvisar.size === 0) {
    return new Response(JSON.stringify({ enviados: 0, motivo: "nada que avisar hoy" }), { status: 200 });
  }

  const { data: suscripciones, error: errorSuscripciones } = await supabase
    .from("push_subscriptions").select("*").in("user_id", [...usuariosAAvisar]);
  if (errorSuscripciones) return new Response(JSON.stringify({ error: errorSuscripciones.message }), { status: 500 });

  let enviados = 0;
  for (const sub of suscripciones ?? []) {
    const resumen = porUsuario[sub.user_id];
    const faltaContarCaja = usuariosSinVerificarCaja.has(sub.user_id);
    if (!resumen && !faltaContarCaja) continue;

    const partes: string[] = [];
    if (resumen) partes.push(`Tienes ${resumen.cantidad} cuota${resumen.cantidad > 1 ? "s" : ""} por ${formatoPesos(resumen.monto)} que vence${resumen.cantidad > 1 ? "n" : ""} mañana.`);
    if (faltaContarCaja) partes.push("Todavía no has contado tu caja física hoy.");

    const payload = JSON.stringify({
      title: resumen && faltaContarCaja ? "📅💰 Pendientes de hoy" : resumen ? "📅 Cuotas que vencen mañana" : "💰 Cuenta tu caja",
      body: partes.join(" "),
      url: "./"
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      enviados++;
    } catch (e) {
      // 404/410 = el navegador invalidó esa suscripción (celular formateado,
      // notificaciones desactivadas manualmente, etc.) — se borra para no
      // reintentar en vano todos los días.
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }
  }

  return new Response(JSON.stringify({ enviados }), { status: 200, headers: { "Content-Type": "application/json" } });
});
