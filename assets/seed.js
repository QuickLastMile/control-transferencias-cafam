/*
 * Datos de la "fuente de verdad" de la plataforma de Cafam.
 *
 * IMPORTANTE: la plataforma NO tiene API. La lista de guias montadas se carga
 * periodicamente desde un export (CSV/Excel) o pegando el texto de la plataforma,
 * usando la vista "Datos". Mientras no se cargue nada, se usan los datos demo
 * de abajo (MONTADAS_DEMO).
 */

const LS_MONTADAS = "qk_montadas_v1";

// Puntos destino con su PIN de confirmacion (reemplaza al sello fisico).
// Los codigos CC provienen de los sellos del formato actual.
const PUNTOS = [
  { id: "2810", nombre: "Drog. Cafam Exi · Viva 51B (Cra 51)", pin: "2810", lat: 10.9930, lng: -74.8000 },
  { id: "2864", nombre: "Drog. Cafam B/quilla · Buenavista",   pin: "2864", lat: 11.0040, lng: -74.8100 },
  { id: "6580", nombre: "Drog. Cafam · Ciudad del Mar (Caru)",  pin: "6580", lat: 11.0200, lng: -74.8500 },
];

// Datos DEMO de respaldo (se usan si no se ha cargado un export real).
const MONTADAS_DEMO = [
  { guia: "4954425", origen: "San Vicente", destinoId: "2810" },
  { guia: "4954531", origen: "San Vicente", destinoId: "2810" },
  { guia: "4955188", origen: "San Vicente", destinoId: "2864" },
  { guia: "4955205", origen: "San Vicente", destinoId: "6580" },
  { guia: "4955315", origen: "San Vicente", destinoId: "2810" },
  { guia: "4955417", origen: "San Vicente", destinoId: "2810" },
  { guia: "4955520", origen: "San Vicente", destinoId: "2810" },
  { guia: "4955652", origen: "San Vicente", destinoId: "2810" },
  { guia: "4955681", origen: "San Vicente", destinoId: "2810" },
  { guia: "4955811", origen: "San Vicente", destinoId: "2810" },
];

// ---- Fuente de verdad efectiva (override cargado o demo) ----
function getMontadas() {
  try {
    const raw = localStorage.getItem(LS_MONTADAS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch { /* usa demo */ }
  return MONTADAS_DEMO;
}
function setMontadas(arr) {
  localStorage.setItem(LS_MONTADAS, JSON.stringify(arr));
}
function clearMontadas() {
  localStorage.removeItem(LS_MONTADAS);
}
function usandoDatosReales() {
  const raw = localStorage.getItem(LS_MONTADAS);
  return !!raw && raw !== "[]";
}

function puntoPorId(id) {
  return PUNTOS.find((p) => p.id === id) || null;
}
function puntoPorNombreOId(valor) {
  const v = String(valor || "").trim().toLowerCase();
  if (!v) return null;
  return (
    PUNTOS.find((p) => p.id.toLowerCase() === v) ||
    PUNTOS.find((p) => p.nombre.toLowerCase().includes(v) || v.includes(p.nombre.toLowerCase())) ||
    null
  );
}
function montadaPorGuia(guia) {
  const g = String(guia).trim();
  return getMontadas().find((m) => m.guia === g) || null;
}

/*
 * Parser flexible para el export de la plataforma.
 * Acepta CSV/TSV o texto pegado. Columnas reconocidas (con o sin encabezado):
 *   guia | origen | destino   (destino puede ser el ID del punto o parte del nombre)
 * Si no hay encabezado, asume el orden: guia, origen, destino.
 * Si solo hay una columna, se toma como guia.
 * Devuelve { montadas, errores }.
 */
function parseExport(texto) {
  const lineas = String(texto || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length);
  if (!lineas.length) return { montadas: [], errores: ["Sin datos."] };

  const split = (l) => l.split(/[,;\t]/).map((c) => c.trim());

  // Detectar encabezado
  let idx = { guia: 0, origen: 1, destino: 2 };
  let inicio = 0;
  const primera = split(lineas[0]).map((c) => c.toLowerCase());
  const tieneEncabezado = primera.some((c) => /gu[ií]a|origen|destino|punto/.test(c));
  if (tieneEncabezado) {
    inicio = 1;
    idx = { guia: -1, origen: -1, destino: -1 };
    primera.forEach((c, i) => {
      if (/gu[ií]a/.test(c)) idx.guia = i;
      else if (/origen/.test(c)) idx.origen = i;
      else if (/destino|punto/.test(c)) idx.destino = i;
    });
    if (idx.guia === -1) idx.guia = 0;
  }

  const montadas = [];
  const errores = [];
  const vistos = new Set();

  for (let i = inicio; i < lineas.length; i++) {
    const cols = split(lineas[i]);
    const guia = (cols[idx.guia] || "").replace(/\D/g, "");
    if (!guia) { errores.push(`Linea ${i + 1}: sin numero de guia.`); continue; }
    if (vistos.has(guia)) { errores.push(`Linea ${i + 1}: guia ${guia} duplicada.`); continue; }
    vistos.add(guia);

    const origen = idx.origen >= 0 ? (cols[idx.origen] || "") : "";
    const destinoRaw = idx.destino >= 0 ? (cols[idx.destino] || "") : "";
    const punto = puntoPorNombreOId(destinoRaw);
    montadas.push({
      guia,
      origen: origen || "—",
      destinoId: punto ? punto.id : "",
      destinoTexto: punto ? punto.nombre : (destinoRaw || "—"),
    });
  }
  return { montadas, errores };
}
