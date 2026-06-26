/* ============================================================
 * Quick · Control de Transferencias Cafam — Prototipo (demo)
 * App 100% cliente. localStorage simula la base de legalizaciones.
 * ============================================================ */

const LS_KEY = "qk_legalizaciones_v1";

// ---- Persistencia ----
function getLegalizaciones() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}
function saveLegalizaciones(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}
function legalizacionPorGuia(guia) {
  return getLegalizaciones().find((l) => l.guia === String(guia).trim()) || null;
}

// ---- Estado del formulario en curso ----
let draft = null; // { guia, montada, gps, foto }

// ---- Utilidades ----
function toast(msg, tipo = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast " + tipo;
  setTimeout(() => t.classList.add("hidden"), 2600);
}
function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function $(sel, root = document) { return root.querySelector(sel); }

// ============================================================
// NAVEGACIÓN
// ============================================================
function setView(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const tpl = document.getElementById("view-" + name);
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  if (name === "mensajero") initMensajero();
  if (name === "tablero") initTablero();
  if (name === "datos") initDatos();
}

document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view))
);

// ============================================================
// VISTA MENSAJERO
// ============================================================
function initMensajero() {
  draft = null;
  const inputGuia = $("#f-guia");
  $("#btn-validar").addEventListener("click", () => validarGuia(inputGuia.value));
  inputGuia.addEventListener("keydown", (e) => { if (e.key === "Enter") validarGuia(inputGuia.value); });

  $("#btn-gps").addEventListener("click", capturarGPS);
  $("#btn-foto").addEventListener("click", () => $("#f-foto").click());
  $("#f-foto").addEventListener("change", capturarFoto);
  $("#btn-legalizar").addEventListener("click", legalizar);
}

function validarGuia(valor) {
  const guia = String(valor || "").trim();
  const status = $("#guia-status");
  const resto = $("#form-resto");

  if (!guia) {
    status.className = "status-line err";
    status.textContent = "Ingresa un número de guía.";
    return;
  }
  if (legalizacionPorGuia(guia)) {
    status.className = "status-line err";
    status.textContent = "⚠ Esta guía ya fue legalizada.";
    resto.classList.add("hidden");
    return;
  }

  const montada = montadaPorGuia(guia);
  if (!montada) {
    // ---- Principio de anclaje: si no existe en plataforma, no se puede legalizar ----
    status.className = "status-line err";
    status.innerHTML = "✕ Guía <b>no encontrada</b> en la plataforma. No se puede legalizar.";
    resto.classList.add("hidden");
    return;
  }

  // Guía válida
  const punto = puntoPorId(montada.destinoId);
  status.className = "status-line ok";
  status.textContent = "✓ Guía válida y montada en plataforma.";
  $("#r-origen").textContent = montada.origen;
  $("#r-destino").textContent = punto ? punto.nombre : montada.destinoId;
  resto.classList.remove("hidden");

  draft = { guia, montada, gps: null, foto: null };
}

function capturarGPS() {
  const status = $("#gps-status");
  if (!navigator.geolocation) {
    status.className = "status-line err";
    status.textContent = "Este dispositivo no soporta GPS.";
    return;
  }
  status.className = "status-line info";
  status.textContent = "Obteniendo ubicación…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      draft.gps = { lat: latitude, lng: longitude, acc: Math.round(accuracy) };
      status.className = "status-line ok";
      status.textContent = `✓ ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${draft.gps.acc} m)`;
    },
    (err) => {
      status.className = "status-line err";
      status.textContent = "No se pudo obtener la ubicación: " + err.message;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function capturarFoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    draft.foto = reader.result;
    const img = $("#foto-preview");
    img.src = reader.result;
    img.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function legalizar() {
  if (!draft) return;
  const pin = $("#f-pin").value.trim();
  const pinStatus = $("#pin-status");
  const punto = puntoPorId(draft.montada.destinoId);

  // Validaciones
  if (!draft.gps) { toast("Captura la ubicación GPS primero.", "err"); return; }
  if (!draft.foto) { toast("Toma la foto de evidencia.", "err"); return; }
  if (!pin) {
    pinStatus.className = "status-line err";
    pinStatus.textContent = "Ingresa el PIN del punto.";
    return;
  }
  if (!punto || pin !== punto.pin) {
    pinStatus.className = "status-line err";
    pinStatus.textContent = "✕ PIN incorrecto para este punto.";
    return;
  }

  const registro = {
    guia: draft.guia,
    origen: draft.montada.origen,
    destinoId: draft.montada.destinoId,
    destinoNombre: punto.nombre,
    gps: draft.gps,
    foto: draft.foto,
    pinOk: true,
    hora: new Date().toISOString(), // "hora del servidor" (simulada en cliente para la demo)
  };
  const arr = getLegalizaciones();
  arr.push(registro);
  saveLegalizaciones(arr);

  toast("✓ Transferencia legalizada y conciliada.", "ok");
  setView("tablero");
}

// ============================================================
// VISTA TABLERO (conciliación)
// ============================================================
function construirConciliacion() {
  const legals = getLegalizaciones();
  const legalSet = new Map(legals.map((l) => [l.guia, l]));
  const filas = [];

  // 1. Montadas: conciliadas o pendientes
  MONTADAS.forEach((m) => {
    const leg = legalSet.get(m.guia);
    const punto = puntoPorId(m.destinoId);
    if (leg) {
      filas.push({ estado: "ok", guia: m.guia, destino: punto ? punto.nombre : m.destinoId, leg });
    } else {
      filas.push({ estado: "pendiente", guia: m.guia, destino: punto ? punto.nombre : m.destinoId, leg: null });
    }
  });

  // 2. Legalizadas que NO están montadas → alerta (no debería pasar por el anclaje, pero se cubre)
  legals.forEach((l) => {
    if (!montadaPorGuia(l.guia)) {
      filas.push({ estado: "alerta", guia: l.guia, destino: l.destinoNombre, leg: l });
    }
  });

  return filas;
}

let filtroActual = "todos";

function initTablero() {
  document.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      filtroActual = c.dataset.filter;
      document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
      renderTablero();
    })
  );
  filtroActual = "todos";
  renderTablero();
}

function renderTablero() {
  const filas = construirConciliacion();
  const tot = filas.length;
  const ok = filas.filter((f) => f.estado === "ok").length;
  const pend = filas.filter((f) => f.estado === "pendiente").length;
  const alert = filas.filter((f) => f.estado === "alerta").length;

  $("#kpis").innerHTML = `
    <div class="kpi tot"><div class="num">${MONTADAS.length}</div><div class="lbl">Montadas en plataforma</div></div>
    <div class="kpi ok"><div class="num">${ok}</div><div class="lbl">Conciliadas</div></div>
    <div class="kpi pend"><div class="num">${pend}</div><div class="lbl">Pendientes</div></div>
    <div class="kpi alert"><div class="num">${alert}</div><div class="lbl">Alertas</div></div>
  `;

  const visibles = filtroActual === "todos" ? filas : filas.filter((f) => f.estado === filtroActual);
  const cont = $("#tabla-conciliacion");

  if (!visibles.length) {
    cont.innerHTML = `<div class="empty">Sin registros en este filtro.</div>`;
    return;
  }

  cont.innerHTML = visibles.map((f) => {
    const etiqueta = { ok: "Conciliada", pendiente: "Pendiente", alerta: "Alerta" }[f.estado];
    let meta = `Destino: <b>${f.destino}</b>`;
    if (f.leg) {
      const g = f.leg.gps;
      meta += `<br>Hora: <b>${fmtFecha(f.leg.hora)}</b>`;
      if (g) meta += ` · GPS: <b>${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}</b>`;
      meta += ` · PIN punto: <b>✓</b>`;
      if (f.leg.foto) meta += ` · Foto: <b>✓</b>`;
    } else {
      meta += `<br><b>Sin legalizar</b> — montada en plataforma pero no reportada por el mensajero.`;
    }
    if (f.estado === "alerta") {
      meta += `<br><b style="color:#B02A2A">Legalizada sin existir en plataforma (posible fraude).</b>`;
    }
    return `
      <div class="row ${f.estado}">
        <div class="row-top">
          <span class="row-guia">Guía ${f.guia}</span>
          <span class="badge ${f.estado}">${etiqueta}</span>
        </div>
        <div class="row-meta">${meta}</div>
      </div>`;
  }).join("");
}

// ============================================================
// VISTA DATOS DEMO
// ============================================================
function initDatos() {
  $("#lista-puntos").innerHTML = PUNTOS.map((p) =>
    `<div class="lista-item"><span>${p.nombre}</span><span class="pin-pill">${p.pin}</span></div>`
  ).join("");

  const legals = getLegalizaciones();
  $("#lista-montadas").innerHTML = MONTADAS.map((m) => {
    const ya = legals.some((l) => l.guia === m.guia);
    return `<div class="lista-item"><span>${m.guia}</span><span>${ya ? "✓ legalizada" : "⏳ pendiente"}</span></div>`;
  }).join("");

  $("#btn-reset").addEventListener("click", () => {
    if (confirm("¿Borrar todas las legalizaciones de la demo?")) {
      localStorage.removeItem(LS_KEY);
      toast("Demo reiniciada.", "ok");
      initDatos();
    }
  });
}

// ---- Arranque ----
setView("mensajero");
