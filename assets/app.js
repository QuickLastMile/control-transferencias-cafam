/* ============================================================
 * Quick · Legalización de Transferencias Cafam
 * Frontend conectado al backend de Google Apps Script.
 * ============================================================ */

const CFG = window.QK_CONFIG || {};
const $ = (s) => document.querySelector(s);

// Estado del formulario
const estado = {
  emp: null,          // { cedula, nombre, centro }
  puntos: [],         // [{corto, plataforma}]
  tipo: "",           // Recogida | Entrega
  horaLlegada: "",
  horaSalida: "",
  gps: null,          // { lat, lng, acc }
  direccion: "",
  fotoBase64: "",
};

// ---- Utilidades ----
function toast(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + tipo;
  setTimeout(() => t.classList.add("hidden"), 3000);
}
function horaAhora() {
  return new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function setStatus(sel, msg, tipo) {
  const e = $(sel);
  e.className = "status-line " + (tipo || "");
  e.innerHTML = msg;
}

// ---- Llamadas al backend ----
async function apiGet(params) {
  const qs = new URLSearchParams(Object.assign({ token: CFG.TOKEN }, params)).toString();
  const res = await fetch(CFG.API_URL + "?" + qs);
  return res.json();
}
async function apiPost(obj) {
  // text/plain evita el preflight CORS de Apps Script
  const res = await fetch(CFG.API_URL, {
    method: "POST",
    body: JSON.stringify(Object.assign({ token: CFG.TOKEN }, obj)),
  });
  return res.json();
}

// ============================================================
// 1. BUSCAR CÉDULA
// ============================================================
async function buscarCedula() {
  const cedula = $("#f-cedula").value.replace(/\D/g, "");
  if (!cedula) { setStatus("#cedula-status", "Ingresa la cédula.", "err"); return; }
  setStatus("#cedula-status", "Buscando…", "info");
  $("#emp-box").classList.add("hidden");
  try {
    const r = await apiGet({ action: "buscarCedula", cedula });
    if (!r.ok) { setStatus("#cedula-status", "✕ " + (r.error || "No encontrada."), "err"); estado.emp = null; return; }
    estado.emp = { cedula: r.cedula, nombre: r.nombre, centro: r.centro };
    $("#r-nombre").textContent = r.nombre || "—";
    $("#r-centro").textContent = r.centro || "—";
    $("#emp-box").classList.remove("hidden");
    setStatus("#cedula-status", "✓ Mensajero encontrado.", "ok");
    $("#bloque-datos").classList.remove("hidden");
    if (!estado.puntos.length) cargarPuntos();
  } catch (e) {
    setStatus("#cedula-status", "Error de conexión con el servidor.", "err");
  }
}

// ============================================================
// 2. PUNTOS DE VENTA
// ============================================================
async function cargarPuntos() {
  try {
    const r = await apiGet({ action: "puntos" });
    if (r.ok && r.puntos) {
      estado.puntos = r.puntos;
      $("#dl-puntos").innerHTML = r.puntos
        .map((p) => `<option value="${p.corto}">${p.plataforma || ""}</option>`)
        .join("");
    }
  } catch (e) { /* sin puntos, el campo queda libre */ }
}
function puntoSeleccionado() {
  const v = $("#f-punto").value.trim();
  const p = estado.puntos.find((x) => x.corto.toLowerCase() === v.toLowerCase());
  return p || (v ? { corto: v, plataforma: "" } : null);
}

// ============================================================
// 3. MARCACIONES
// ============================================================
function marcarLlegada() {
  estado.horaLlegada = horaAhora();
  $("#r-llegada").textContent = estado.horaLlegada;
}
function marcarSalida() {
  estado.horaSalida = horaAhora();
  $("#r-salida").textContent = estado.horaSalida;
}

// ============================================================
// 4. GPS + DIRECCIÓN + FOTO CON MARCA DE AGUA
// ============================================================
function capturarGPS() {
  if (!navigator.geolocation) { setStatus("#gps-status", "Sin soporte de GPS.", "err"); return; }
  setStatus("#gps-status", "Obteniendo ubicación…", "info");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      estado.gps = { lat: +latitude.toFixed(6), lng: +longitude.toFixed(6), acc: Math.round(accuracy) };
      setStatus("#gps-status", `✓ ${estado.gps.lat}, ${estado.gps.lng} (±${estado.gps.acc} m). Buscando dirección…`, "ok");
      estado.direccion = await reverseGeocode(estado.gps.lat, estado.gps.lng);
      setStatus("#gps-status", `✓ ${estado.direccion || (estado.gps.lat + ", " + estado.gps.lng)}`, "ok");
    },
    () => setStatus("#gps-status", "No se pudo obtener la ubicación. Activa el GPS y los permisos.", "err"),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: { "Accept-Language": "es" } });
    const j = await res.json();
    return j.display_name || "";
  } catch (e) { return ""; }
}

function tomarFoto() {
  if (!estado.gps) { toast("Captura la ubicación primero.", "err"); return; }
  $("#f-foto").click();
}

function procesarFoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.onload = () => dibujarMarca(img); img.src = reader.result; };
  reader.readAsDataURL(file);
}

function dibujarMarca(img) {
  const canvas = $("#canvas");
  const maxW = 1280;
  const escala = Math.min(1, maxW / img.width);
  canvas.width = img.width * escala;
  canvas.height = img.height * escala;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Texto de la marca
  const ahora = new Date();
  const fecha = ahora.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const lineas = [
    "Quick · Evidencia de transferencia",
    "Fecha/hora: " + fecha,
    "GPS: " + (estado.gps ? estado.gps.lat + ", " + estado.gps.lng : "—"),
    "Dir: " + (estado.direccion || "no disponible"),
  ];

  const fontSize = Math.max(14, Math.round(canvas.width / 45));
  ctx.font = fontSize + "px Arial";
  const pad = fontSize * 0.6;
  const lh = fontSize * 1.35;
  // Recuadro de fondo
  const wrap = wrapLines(ctx, lineas, canvas.width - pad * 2);
  const boxH = wrap.length * lh + pad * 1.5;
  ctx.fillStyle = "rgba(16,58,107,0.72)";
  ctx.fillRect(0, canvas.height - boxH, canvas.width, boxH);
  // Texto
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  let y = canvas.height - boxH + pad * 0.75;
  wrap.forEach((ln) => { ctx.fillText(ln, pad, y); y += lh; });

  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  estado.fotoBase64 = dataUrl;
  const prev = $("#foto-preview");
  prev.src = dataUrl;
  prev.classList.remove("hidden");
}

function wrapLines(ctx, lineas, maxW) {
  const out = [];
  lineas.forEach((linea) => {
    const palabras = linea.split(" ");
    let cur = "";
    palabras.forEach((p) => {
      const test = cur ? cur + " " + p : p;
      if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = p; }
      else cur = test;
    });
    if (cur) out.push(cur);
  });
  return out;
}

// ============================================================
// 5. FINALIZAR
// ============================================================
async function finalizar() {
  if (!estado.emp) { toast("Busca primero la cédula.", "err"); return; }
  const punto = puntoSeleccionado();
  const guia = $("#f-guia").value.replace(/\D/g, "");
  if (!punto) { toast("Selecciona el punto de venta.", "err"); return; }
  if (!guia) { toast("El número de guía es obligatorio.", "err"); return; }
  if (!estado.tipo) { toast("Indica si es Recogida o Entrega.", "err"); return; }
  if (!estado.horaLlegada && !estado.horaSalida) { toast("Marca llegada y/o salida.", "err"); return; }
  if (!estado.fotoBase64) { toast("Toma la foto de evidencia.", "err"); return; }

  const btn = $("#btn-finalizar");
  btn.disabled = true;
  setStatus("#final-status", "Enviando…", "info");

  try {
    const r = await apiPost({
      action: "registrar",
      cedula: estado.emp.cedula,
      puntoCorto: punto.corto,
      puntoPlataforma: punto.plataforma,
      guia,
      tipo: estado.tipo,
      horaLlegada: estado.horaLlegada,
      horaSalida: estado.horaSalida,
      lat: estado.gps ? estado.gps.lat : "",
      lng: estado.gps ? estado.gps.lng : "",
      direccion: estado.direccion,
      fotoBase64: estado.fotoBase64,
    });
    if (!r.ok) { setStatus("#final-status", "✕ " + (r.error || "Error al guardar."), "err"); btn.disabled = false; return; }
    const cruceMsg = r.cruce === "NO"
      ? " ⚠️ La guía NO aparece en Smart Quick — el regente lo revisará."
      : "";
    setStatus("#final-status", `✓ Registrado (${r.id}). Queda pendiente de aprobación.` + cruceMsg, "ok");
    toast("✓ Transferencia enviada.", "ok");
    setTimeout(resetForm, 2500);
  } catch (e) {
    setStatus("#final-status", "Error de conexión con el servidor.", "err");
    btn.disabled = false;
  }
}

function resetForm() {
  estado.tipo = ""; estado.horaLlegada = ""; estado.horaSalida = "";
  estado.gps = null; estado.direccion = ""; estado.fotoBase64 = "";
  ["#f-punto", "#f-guia"].forEach((s) => ($(s).value = ""));
  $("#r-llegada").textContent = "—"; $("#r-salida").textContent = "—";
  $("#gps-status").textContent = ""; $("#final-status").textContent = "";
  $("#foto-preview").classList.add("hidden");
  document.querySelectorAll(".toggle").forEach((b) => b.classList.remove("active"));
  $("#btn-finalizar").disabled = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
// EVENTOS
// ============================================================
$("#btn-buscar").addEventListener("click", buscarCedula);
$("#f-cedula").addEventListener("keydown", (e) => { if (e.key === "Enter") buscarCedula(); });
$("#btn-llegada").addEventListener("click", marcarLlegada);
$("#btn-salida").addEventListener("click", marcarSalida);
$("#btn-gps").addEventListener("click", capturarGPS);
$("#btn-foto").addEventListener("click", tomarFoto);
$("#f-foto").addEventListener("change", procesarFoto);
$("#btn-finalizar").addEventListener("click", finalizar);
document.querySelectorAll(".toggle").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".toggle").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    estado.tipo = b.dataset.tipo;
  })
);

// Aviso si falta configurar
if (!CFG.API_URL || /CAMBIA/.test(CFG.TOKEN || "")) {
  setTimeout(() => toast("⚙️ Falta configurar el TOKEN en assets/config.js", "err"), 600);
}
