/*
 * Datos semilla de la DEMO.
 * Simulan la "fuente de verdad" de la plataforma de Cafam.
 * En producción, MONTADAS se reemplaza por el export/API real de guías montadas.
 */

// Puntos destino con su PIN de confirmación (reemplaza al sello físico).
// Los códigos CC provienen de los sellos del formato actual.
const PUNTOS = [
  { id: "2810", nombre: "Drog. Cafam Exi · Viva 51B (Cra 51)", pin: "2810", lat: 10.9930, lng: -74.8000 },
  { id: "2864", nombre: "Drog. Cafam B/quilla · Buenavista",   pin: "2864", lat: 11.0040, lng: -74.8100 },
  { id: "6580", nombre: "Drog. Cafam · Ciudad del Mar (Caru)",  pin: "6580", lat: 11.0200, lng: -74.8500 },
];

// Guías efectivamente montadas en la plataforma (lo "real").
// Tomadas del Formato Control Transferencias del mensajero.
const MONTADAS = [
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

function puntoPorId(id) {
  return PUNTOS.find((p) => p.id === id) || null;
}
function montadaPorGuia(guia) {
  return MONTADAS.find((m) => m.guia === String(guia).trim()) || null;
}
