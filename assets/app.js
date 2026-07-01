/* ============================================================
 * Quick · Legalización de Transferencias Cafam
 * Frontend conectado al backend de Google Apps Script.
 * ============================================================ */

const CFG = window.QK_CONFIG || {};
const $ = (s) => document.querySelector(s);

const estado = {
  emp: null,          // { cedula, nombre, centro }
  puntos: [],         // [{corto, plataforma}]
  tipo: "",           // Recogida | Entrega
  horaLlegada: "",
  horaSalida: "",
  gps: null,          // { lat, lng, acc }
  direccion: "",
  fotoBase64: "",
  stream: null,       // MediaStream activo
  facing: "environment",
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
  if (!e) return;
  e.className = "status-line " + (tipo || "");
  e.innerHTML = msg;
}

// ---- Backend ----
async function apiGet(params) {
  const qs = new URLSearchParams(Object.assign({ token: CFG.TOKEN }, params)).toString();
  const res = await fetch(CFG.API_URL + "?" + qs);
  return res.json();
}
async function apiPost(obj) {
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
// 2. PUNTOS DE VENTA (lista desplegable, en vivo desde DROGUERIA)
// ============================================================
async function cargarPuntos() {
  const sel = $("#f-punto");
  try {
    const r = await apiGet({ action: "puntos" });
    if (r.ok && r.puntos && r.puntos.length) {
      estado.puntos = r.puntos;
      sel.innerHTML = '<option value="">Selecciona…</option>' +
        r.puntos.map((p) => `<option value="${p.corto}">${p.corto}</option>`).join("");
    } else {
      sel.innerHTML = '<option value="">(sin puntos)</option>';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">(error al cargar)</option>';
  }
}
function puntoSeleccionado() {
  const v = $("#f-punto").value.trim();
  if (!v) return null;
  return estado.puntos.find((x) => x.corto === v) || { corto: v, plataforma: "" };
}

// ============================================================
// 3. MARCACIONES (únicas: una sola vez)
// ============================================================
function marcarLlegada() {
  if (estado.horaLlegada) return;
  estado.horaLlegada = horaAhora();
  $("#r-llegada").textContent = estado.horaLlegada;
  bloquearMarca("#btn-llegada");
}
function marcarSalida() {
  if (estado.horaSalida) return;
  estado.horaSalida = horaAhora();
  $("#r-salida").textContent = estado.horaSalida;
  bloquearMarca("#btn-salida");
}
function bloquearMarca(sel) {
  const b = $(sel);
  b.disabled = true;
  b.classList.add("marcado");
  b.textContent = "✓ Marcado";
}

// ============================================================
// 4. CÁMARA EN VIVO + GPS + MARCA DE AGUA EN ESQUINA
// ============================================================
async function abrirCamara() {
  const cam = $("#camara");
  cam.classList.remove("hidden");
  $("#btn-abrir-camara").classList.add("hidden");
  await iniciarStream();
  capturarUbicacion(); // GPS automático al abrir la cámara
}

async function iniciarStream() {
  detenerStream();
  try {
    estado.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: estado.facing } },
      audio: false,
    });
    const v = $("#video");
    v.srcObject = estado.stream;
    await v.play().catch(() => {});
  } catch (e) {
    setStatus("#gps-status", "No se pudo abrir la cámara: " + e.message + ". Da permiso de cámara.", "err");
  }
}
function detenerStream() {
  if (estado.stream) {
    estado.stream.getTracks().forEach((t) => t.stop());
    estado.stream = null;
  }
}
function voltearCamara() {
  estado.facing = estado.facing === "environment" ? "user" : "environment";
  iniciarStream();
}
function cerrarCamara() {
  detenerStream();
  $("#camara").classList.add("hidden");
  if (!estado.fotoBase64) $("#btn-abrir-camara").classList.remove("hidden");
}

function capturarUbicacion() {
  if (!navigator.geolocation) { setStatus("#gps-status", "Sin soporte de GPS.", "err"); return; }
  setStatus("#gps-status", "Obteniendo ubicación…", "info");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      estado.gps = { lat: +latitude.toFixed(6), lng: +longitude.toFixed(6), acc: Math.round(accuracy) };
      setStatus("#gps-status", `📍 ${estado.gps.lat}, ${estado.gps.lng} (±${estado.gps.acc} m)`, "ok");
      estado.direccion = await reverseGeocode(estado.gps.lat, estado.gps.lng);
      if (estado.direccion) setStatus("#gps-status", `📍 ${estado.direccion}`, "ok");
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
    return direccionCorta(j.address) || j.display_name || "";
  } catch (e) { return ""; }
}

// Arma una dirección corta: calle · localidad · ciudad (sin país, código postal, etc.).
function direccionCorta(a) {
  if (!a) return "";
  const calle = [a.road, a.house_number].filter(Boolean).join(" ");
  const localidad = a.neighbourhood || a.suburb || a.city_district || a.borough || a.quarter || "";
  const ciudad = a.city || a.town || a.village || a.municipality || a.county || "";
  const partes = [];
  if (calle) partes.push(calle);
  if (localidad && localidad !== ciudad) partes.push(localidad);
  if (ciudad) partes.push(ciudad);
  return partes.join(", ");
}

function capturarFoto() {
  const v = $("#video");
  if (!v.videoWidth) { toast("La cámara aún no está lista.", "err"); return; }
  const canvas = $("#canvas");
  const maxW = 1280;
  const escala = Math.min(1, maxW / v.videoWidth);
  canvas.width = v.videoWidth * escala;
  canvas.height = v.videoHeight * escala;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
  marcaEsquina(ctx, canvas);

  estado.fotoBase64 = canvas.toDataURL("image/jpeg", 0.72);
  $("#foto-preview").src = estado.fotoBase64;
  $("#foto-preview").classList.remove("hidden");
  $("#btn-repetir").classList.remove("hidden");
  cerrarCamara();
}

// Marca de agua compacta en la esquina inferior izquierda.
function marcaEsquina(ctx, canvas) {
  const ahora = new Date();
  const fecha = ahora.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const lineas = [
    "Quick · " + fecha,
    "GPS: " + (estado.gps ? estado.gps.lat + ", " + estado.gps.lng : "—"),
    "Dir: " + (estado.direccion || "no disponible"),
  ];
  const fs = Math.max(12, Math.round(canvas.width / 52));
  ctx.font = fs + "px Arial";
  const pad = fs * 0.5;
  const lh = fs * 1.3;
  const maxW = canvas.width * 0.62;
  const wrap = wrapLines(ctx, lineas, maxW - pad * 2);
  const boxW = Math.min(maxW, Math.max.apply(null, wrap.map((l) => ctx.measureText(l).width)) + pad * 2);
  const boxH = wrap.length * lh + pad * 1.2;
  const x = pad, y = canvas.height - boxH - pad;

  ctx.fillStyle = "rgba(16,58,107,0.74)";
  roundRect(ctx, x, y, boxW, boxH, fs * 0.4);
  ctx.fill();
  // franja lateral de acento
  ctx.fillStyle = "#4F9BE0";
  ctx.fillRect(x, y, fs * 0.22, boxH);

  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  let ty = y + pad * 0.6;
  wrap.forEach((ln) => { ctx.fillText(ln, x + pad + fs * 0.3, ty); ty += lh; });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

function repetirFoto() {
  estado.fotoBase64 = "";
  $("#foto-preview").classList.add("hidden");
  $("#btn-repetir").classList.add("hidden");
  abrirCamara();
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
    setStatus("#final-status", `✓ Registrado (${r.id}). Pendiente de aprobación.` + cruceMsg, "ok");
    toast("✓ Transferencia enviada.", "ok");
    setTimeout(resetForm, 2800);
  } catch (e) {
    setStatus("#final-status", "Error de conexión con el servidor.", "err");
    btn.disabled = false;
  }
}

function resetForm() {
  detenerStream();
  estado.tipo = ""; estado.horaLlegada = ""; estado.horaSalida = "";
  estado.gps = null; estado.direccion = ""; estado.fotoBase64 = "";
  $("#f-punto").value = ""; $("#f-guia").value = "";
  $("#r-llegada").textContent = "—"; $("#r-salida").textContent = "—";
  ["#btn-llegada", "#btn-salida"].forEach((s) => {
    const b = $(s); b.disabled = false; b.classList.remove("marcado");
  });
  $("#btn-llegada").textContent = "🟢 Llegada";
  $("#btn-salida").textContent = "🔴 Salida";
  $("#gps-status").textContent = ""; $("#final-status").textContent = "";
  $("#foto-preview").classList.add("hidden");
  $("#btn-repetir").classList.add("hidden");
  $("#camara").classList.add("hidden");
  $("#btn-abrir-camara").classList.remove("hidden");
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
$("#btn-abrir-camara").addEventListener("click", abrirCamara);
$("#btn-voltear").addEventListener("click", voltearCamara);
$("#btn-capturar").addEventListener("click", capturarFoto);
$("#btn-cerrar-cam").addEventListener("click", cerrarCamara);
$("#btn-repetir").addEventListener("click", repetirFoto);
$("#btn-finalizar").addEventListener("click", finalizar);
document.querySelectorAll(".toggle").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".toggle").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    estado.tipo = b.dataset.tipo;
  })
);

if (!CFG.API_URL || /CAMBIA/.test(CFG.TOKEN || "")) {
  setTimeout(() => toast("⚙️ Falta configurar el TOKEN en assets/config.js", "err"), 600);
}
