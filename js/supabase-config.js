// ⚠️ Verifica que sean tus valores reales
const SUPABASE_URL = "https://sgaispueisunccflbahk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Tr-FIcJTBAt9ebTKrf1HXw_-PVzSvjn";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function obtenerFechaLocal() {
  const formateador = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
  });
  return formateador.format(new Date());
}

function formatearMoneda(input) {
  input.addEventListener("input", () => {
    let valor = input.value.replace(/\D/g, "");
    input.value = valor ? "$" + Number(valor).toLocaleString("es-CO") : "";
  });
}

function obtenerValorNumerico(input) {
  return parseFloat(input.value.replace(/\D/g, "")) || 0;
}

function formatoPesos(numero) {
  return "$" + Number(numero).toLocaleString(undefined, { maximumFractionDigits: 0 });
}