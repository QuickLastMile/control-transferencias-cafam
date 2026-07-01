/**
 * ============================================================================
 *  Quick · Control de Transferencias Cafam — Backend (Google Apps Script)
 * ============================================================================
 *  Un solo script, dos despliegues:
 *    - API Mensajero  (acceso: "Cualquiera")            -> captura, protegida por token
 *    - Panel Regente  (acceso: "Cualquiera con cuenta de Google") -> aprueba/rechaza
 *
 *  Hojas que usa (en el MISMO archivo de Sheets):
 *    - Colaboradores: la hoja de nómina (config CONFIG.HOJA_COLAB). Solo se leen
 *      cédula, nombre y centro. NUNCA se devuelve salario/correo/etc.
 *    - DROGUERIA: puntos de venta (NOMBRE CORTO + FARMACIA PLATAFORMA).
 *    - montadas: export de Smart Quick (col. con números de guía). Para el cruce.
 *    - registro: se crea sola. Aquí caen las legalizaciones.
 *    - bitacora: se crea sola. Log append-only de cada acción.
 * ============================================================================
 */

const CONFIG = {
  // ID del archivo de Google Sheets (el de la URL).
  SHEET_ID: '1-I1lqgWFi63WUIlVzE3521pmNWgAnBWU_C1Ehzcpckc',

  // Nombres de las hojas (ajusta si tu pestaña de nómina tiene otro nombre).
  HOJA_COLAB: 'Hoja 1',     // <-- CAMBIA por el nombre real de la pestaña de nómina
  HOJA_DROG: 'DROGUERIAS',
  HOJA_MONTADAS: 'montadas',
  HOJA_REGISTRO: 'registro',
  HOJA_BITACORA: 'bitacora',

  // Token compartido entre la app del mensajero y el backend.
  // DEBE coincidir EXACTAMENTE con TOKEN en assets/config.js.
  TOKEN: 'QK-TRANSFERENCIAS-1234567890',

  // Correos ADMIN: ven y aprueban TODOS los puntos.
  // Los regentes de cada punto se autorizan SOLOS con la columna CORREO de la hoja
  // DROGUERIA (deben ser cuentas Google). Cada regente solo ve los pendientes de su punto.
  ADMIN: [
    'quick.helpai2026@gmail.com',
  ],

  // Código maestro para que el/los correos ADMIN entren al panel del regente.
  // CAMBIA por una clave propia. Los regentes NO usan este código: ellos entran
  // con el TELEFONO de su fila en DROGUERIAS (o una columna CODIGO/PIN si la creas).
  CODIGO_ADMIN: 'ADMIN2026',

  // Carpeta de Drive para las fotos. Deja '' y se crea una automáticamente.
  CARPETA_FOTOS_ID: '',

  // Zona horaria para los sellos de tiempo.
  TZ: 'America/Bogota',
};

// Encabezados de la hoja registro (orden de columnas).
const COLS_REGISTRO = [
  'ID', 'FechaHoraRegistro', 'Cedula', 'Nombre', 'Centro',
  'PuntoCorto', 'PuntoPlataforma', 'NumeroGuia', 'Tipo',
  'HoraLlegada', 'HoraSalida', 'GPS_Lat', 'GPS_Lng', 'Direccion',
  'FotoURL', 'CruceSmartQuick', 'Estado', 'MotivoRechazo',
  'RegenteEmail', 'FechaHoraDecision',
];
const COLS_BITACORA = ['FechaHora', 'Accion', 'ID_Registro', 'Actor', 'Detalle'];

// ----------------------------------------------------------------------------
//  ENRUTADORES HTTP
// ----------------------------------------------------------------------------
function doGet(e) {
  const p = (e && e.parameter) || {};
  // Panel del regente (HTML servido por Apps Script, con login Google)
  if (p.view === 'regente') {
    return HtmlService.createTemplateFromFile('Regente')
      .evaluate()
      .setTitle('Quick · Panel del Regente')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // API de lectura para la app del mensajero
  try {
    if (p.action === 'buscarCedula') {
      requireToken(p.token);
      return json(buscarCedula(p.cedula));
    }
    if (p.action === 'puntos') {
      requireToken(p.token);
      return json({ ok: true, puntos: getPuntos() });
    }
    if (p.action === 'ping') {
      return json({ ok: true, msg: 'backend activo' });
    }
    return json({ ok: false, error: 'accion no reconocida' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    // El frontend envía text/plain para evitar preflight CORS.
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    requireToken(body.token);
    if (body.action === 'registrar') {
      return json(registrar(body));
    }
    return json({ ok: false, error: 'accion no reconocida' });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ----------------------------------------------------------------------------
//  LECTURAS (app mensajero)
// ----------------------------------------------------------------------------
function buscarCedula(cedula) {
  cedula = String(cedula || '').replace(/\D/g, '');
  if (!cedula) return { ok: false, error: 'Cédula vacía.' };

  const sh = hojaColaboradores();
  if (!sh) return { ok: false, error: 'No encuentro la hoja de colaboradores (nómina).' };

  const data = sh.getDataRange().getValues();
  const head = data[0].map((h) => String(h).trim().toUpperCase());
  const iCed = idxAny(head, ['CLIENTID', 'CEDULA', 'CÉDULA', 'DOCUMENTO']);
  const iNom = idxAny(head, ['NOMBRE COLABORADOR', 'CLIENTNAME', 'NOMBRE']);
  const iCen = idxAny(head, ['CENTRO']);
  if (iCed < 0) return { ok: false, error: 'No encuentro la columna de cédula.' };

  for (let r = 1; r < data.length; r++) {
    const c = String(data[r][iCed]).replace(/\D/g, '');
    if (c && c === cedula) {
      return {
        ok: true,
        cedula: cedula,
        nombre: iNom >= 0 ? String(data[r][iNom]).trim() : '',
        centro: iCen >= 0 ? String(data[r][iCen]).trim() : '',
      };
    }
  }
  return { ok: false, error: 'Cédula no encontrada en la base de colaboradores.' };
}

function getPuntos() {
  const sh = hojaDrogueria();
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (!data.length) return [];

  const head = data[0].map((h) => String(h).trim().toUpperCase());
  let iCorto = idxAny(head, ['DROGUERIA NOMBRE CORTO', 'NOMBRE CORTO', 'PUNTO DE VENTA', 'PUNTO', 'DROGUERIA', 'DROGUERIAS']);
  const iPlat = idxAny(head, ['FARMACIA PLATAFORMA', 'PLATAFORMA']);

  // Si no se reconoce el encabezado, los puntos están en la columna A (índice 0).
  // Detectamos si la primera fila es un título o ya es un dato para no perderlo.
  let inicio = 1;
  if (iCorto < 0) {
    iCorto = 0;
    const pareceHeader = head.some((h) => /DROGUER|NOMBRE|PUNTO|PLATAFORMA|CORREO|REGENTE|ENCARGAD/.test(h));
    inicio = pareceHeader ? 1 : 0;
  }

  const out = [];
  const vistos = {};
  for (let r = inicio; r < data.length; r++) {
    const corto = String(data[r][iCorto]).trim();
    if (!corto) continue;
    const clave = corto.toUpperCase();
    if (vistos[clave]) continue;
    vistos[clave] = true;
    out.push({ corto: corto, plataforma: iPlat >= 0 ? String(data[r][iPlat]).trim() : '' });
  }
  return out.sort((a, b) => a.corto.localeCompare(b.corto));
}

// ----------------------------------------------------------------------------
//  REGISTRO (app mensajero)
// ----------------------------------------------------------------------------
function registrar(body) {
  // Validaciones mínimas
  const cedula = String(body.cedula || '').replace(/\D/g, '');
  const guia = String(body.guia || '').replace(/\D/g, '');
  if (!cedula) return { ok: false, error: 'Falta la cédula.' };
  if (!guia) return { ok: false, error: 'El número de guía es obligatorio.' };
  if (!body.puntoCorto) return { ok: false, error: 'Falta el punto de venta.' };
  if (!body.tipo) return { ok: false, error: 'Indica si es Recogida o Entrega.' };

  const emp = buscarCedula(cedula);
  if (!emp.ok) return { ok: false, error: emp.error };

  const sh = hojaRegistro();
  const id = 'REG-' + Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyyMMdd-HHmmss') +
    '-' + Math.floor(Math.random() * 1000);
  const ahora = ahoraStr();

  // Cruce con Smart Quick
  const cruce = cruceSmartQuick(guia); // 'SI' | 'NO' | '—'

  // Foto -> Drive
  let fotoURL = '';
  if (body.fotoBase64) {
    fotoURL = guardarFoto(body.fotoBase64, id + '_' + body.tipo + '.jpg');
  }

  const fila = {
    ID: id,
    FechaHoraRegistro: ahora,
    Cedula: cedula,
    Nombre: emp.nombre,
    Centro: emp.centro,
    PuntoCorto: body.puntoCorto || '',
    PuntoPlataforma: body.puntoPlataforma || '',
    NumeroGuia: guia,
    Tipo: body.tipo || '',
    HoraLlegada: body.horaLlegada || '',
    HoraSalida: body.horaSalida || '',
    GPS_Lat: body.lat || '',
    GPS_Lng: body.lng || '',
    Direccion: body.direccion || '',
    FotoURL: fotoURL,
    CruceSmartQuick: cruce,
    Estado: 'Pendiente',
    MotivoRechazo: '',
    RegenteEmail: '',
    FechaHoraDecision: '',
  };
  sh.appendRow(COLS_REGISTRO.map((k) => fila[k]));
  bitacora('CREAR', id, cedula + ' / ' + emp.nombre, 'Guía ' + guia + ' · ' + body.tipo + ' · cruce=' + cruce);

  return { ok: true, id: id, cruce: cruce, estado: 'Pendiente' };
}

function cruceSmartQuick(guia) {
  const sh = ss().getSheetByName(CONFIG.HOJA_MONTADAS);
  if (!sh) return '—'; // sin hoja de montadas no se puede cruzar
  const data = sh.getDataRange().getValues();
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      if (String(data[r][c]).replace(/\D/g, '') === guia) return 'SI';
    }
  }
  return 'NO';
}

function guardarFoto(base64, nombre) {
  try {
    const limpio = base64.replace(/^data:image\/\w+;base64,/, '');
    const blob = Utilities.newBlob(Utilities.base64Decode(limpio), 'image/jpeg', nombre);
    const folder = carpetaFotos();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    return 'ERROR_FOTO: ' + err;
  }
}

// ----------------------------------------------------------------------------
//  PANEL DEL REGENTE (servidor de funciones, llamadas con google.script.run)
// ----------------------------------------------------------------------------
function regenteEmail() {
  return Session.getActiveUser().getEmail() || '';
}

/**
 * Valida al regente por CORREO + CÓDIGO (sin depender del login de Google).
 * - ADMIN (CONFIG.ADMIN): correo admin + CONFIG.CODIGO_ADMIN -> ve todos los puntos.
 * - Regente: correo en la columna CORREO de DROGUERIAS + código = su TELEFONO
 *   (o una columna CODIGO/PIN/CLAVE si la creas). Solo ve su(s) punto(s).
 * Lanza error con mensaje claro si algo no cuadra.
 */
function validarRegente(correo, codigo) {
  correo = String(correo || '').trim().toLowerCase();
  codigo = String(codigo || '').trim();
  if (!correo) throw new Error('Ingresa tu correo.');
  if (!codigo) throw new Error('Ingresa tu código.');

  // Admin
  const esAdmin = CONFIG.ADMIN.map((x) => x.toLowerCase()).indexOf(correo) >= 0;
  if (esAdmin) {
    if (codigo !== String(CONFIG.CODIGO_ADMIN)) throw new Error('Código de administrador incorrecto.');
    return { email: correo, esAdmin: true, puntos: [], encargado: 'Administrador', autorizado: true };
  }

  // Regente
  const sh = hojaDrogueria();
  if (!sh) throw new Error('No encuentro la hoja DROGUERIAS.');
  const data = sh.getDataRange().getValues();
  const head = data[0].map((h) => String(h).trim().toUpperCase());
  const iCorto = idxAny(head, ['DROGUERIA NOMBRE CORTO', 'NOMBRE CORTO', 'PUNTO DE VENTA', 'PUNTO', 'DROGUERIA', 'DROGUERIAS']);
  const iCorreo = idxAny(head, ['CORREO', 'EMAIL', 'CORREO REGENTE']);
  const iEnc = idxAny(head, ['ENCARGADO DEL PUNTO', 'REGENTE', 'ENCARGADO']);
  const iTel = idxAny(head, ['TELEFONO', 'TELÉFONO', 'CELULAR', 'TEL']);
  const iCod = idxAny(head, ['CODIGO', 'CÓDIGO', 'PIN', 'CLAVE']);
  if (iCorreo < 0) throw new Error('La hoja DROGUERIAS no tiene columna CORREO.');

  const puntos = [];
  let encargado = '';
  const codigosValidos = [];
  for (let r = 1; r < data.length; r++) {
    const c = String(data[r][iCorreo]).trim().toLowerCase();
    if (c && c === correo) {
      if (iCorto >= 0) puntos.push(String(data[r][iCorto]).trim());
      if (iEnc >= 0 && !encargado) encargado = String(data[r][iEnc]).trim();
      if (iCod >= 0 && data[r][iCod] !== '') codigosValidos.push(String(data[r][iCod]).trim());
      if (iTel >= 0 && data[r][iTel] !== '') codigosValidos.push(String(data[r][iTel]).trim());
    }
  }
  if (!puntos.length) throw new Error('Tu correo no está registrado como encargado de ningún punto en DROGUERIAS.');

  const soloDig = (s) => String(s).replace(/\D/g, '');
  const ok = codigosValidos.some((cv) => cv === codigo || (soloDig(cv) && soloDig(cv) === soloDig(codigo)));
  if (!ok) throw new Error('Código incorrecto. Usa el teléfono registrado de tu punto (o el código asignado).');

  return { email: correo, esAdmin: false, puntos: puntos, encargado: encargado, autorizado: true };
}

// Índice de cada columna del registro según COLS_REGISTRO (orden fijo de escritura).
function colsRegistro() {
  const col = {};
  COLS_REGISTRO.forEach((k, i) => (col[k] = i));
  return col;
}
// Fila donde empiezan los datos (0 si la hoja no tiene encabezados).
function inicioDatosRegistro(data, col) {
  return (data.length && String(data[0][col.ID]).trim().toUpperCase() === 'ID') ? 1 : 0;
}

function getPendientes(correo, codigo) {
  const ctx = validarRegente(correo, codigo);
  const sh = hojaRegistro();
  const data = sh.getDataRange().getValues();
  const col = colsRegistro();
  const inicio = inicioDatosRegistro(data, col);
  const puntosLC = ctx.puntos.map((p) => String(p).trim().toLowerCase());
  const out = [];
  for (let r = inicio; r < data.length; r++) {
    if (!data[r][col.ID]) continue;
    const estado = String(data[r][col.Estado] || '').trim().toLowerCase();
    if (estado && estado !== 'pendiente') continue; // vacío = se trata como pendiente
    const puntoCorto = String(data[r][col.PuntoCorto] || '').trim();
    if (!ctx.esAdmin && puntosLC.indexOf(puntoCorto.toLowerCase()) < 0) continue;
    const obj = {};
    COLS_REGISTRO.forEach((k, i) => (obj[k] = data[r][i]));
    obj._fila = r + 1;
    out.push(obj);
  }
  return { email: ctx.email, esAdmin: ctx.esAdmin, puntos: ctx.puntos, pendientes: out };
}

function decidir(correo, codigo, id, decision, motivo) {
  const ctx = validarRegente(correo, codigo);
  const email = ctx.email;
  const sh = hojaRegistro();
  const data = sh.getDataRange().getValues();
  const col = colsRegistro();
  const inicio = inicioDatosRegistro(data, col);
  const puntosLC = ctx.puntos.map((p) => String(p).trim().toLowerCase());

  for (let r = inicio; r < data.length; r++) {
    if (String(data[r][col.ID]) === String(id)) {
      // Un regente solo decide sobre su(s) punto(s); el admin sobre todos.
      const puntoCorto = String(data[r][col.PuntoCorto] || '').trim().toLowerCase();
      if (!ctx.esAdmin && puntosLC.indexOf(puntoCorto) < 0) {
        throw new Error('No autorizado para el punto de este registro.');
      }
      const estadoActual = String(data[r][col.Estado] || '').trim().toLowerCase();
      // INMUTABILIDAD: si ya fue decidido, no se puede cambiar.
      if (estadoActual && estadoActual !== 'pendiente') {
        throw new Error('Este registro ya fue ' + estadoActual + ' y no se puede modificar.');
      }
      const fila = r + 1;
      const nuevo = decision === 'aprobar' ? 'Aprobado' : 'Rechazado';
      sh.getRange(fila, col.Estado + 1).setValue(nuevo);
      sh.getRange(fila, col.RegenteEmail + 1).setValue(email);
      sh.getRange(fila, col.FechaHoraDecision + 1).setValue(ahoraStr());
      if (decision === 'rechazar') sh.getRange(fila, col.MotivoRechazo + 1).setValue(motivo || '');
      bitacora(nuevo.toUpperCase(), id, email, motivo || '');
      return { ok: true, estado: nuevo };
    }
  }
  throw new Error('No se encontró el registro ' + id);
}

// ----------------------------------------------------------------------------
//  UTILIDADES
// ----------------------------------------------------------------------------
function ss() { return SpreadsheetApp.openById(CONFIG.SHEET_ID); }

// ¿La primera fila de la hoja tiene una columna de cédula reconocible?
function tieneColCedula(sh) {
  try {
    if (sh.getLastColumn() < 1) return false;
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map((h) => String(h).trim().toUpperCase());
    return idxAny(head, ['CLIENTID', 'CEDULA', 'CÉDULA', 'DOCUMENTO']) >= 0;
  } catch (e) { return false; }
}

// Devuelve la hoja de nómina: usa CONFIG.HOJA_COLAB si sirve; si no, la
// autodetecta (primera hoja con columna de cédula), excluyendo las hojas
// del sistema. Así 'Hoja 1' mal configurada no rompe la búsqueda.
function hojaColaboradores() {
  const pref = ss().getSheetByName(CONFIG.HOJA_COLAB);
  if (pref && tieneColCedula(pref)) return pref;
  const excl = [CONFIG.HOJA_DROG, CONFIG.HOJA_MONTADAS, CONFIG.HOJA_REGISTRO, CONFIG.HOJA_BITACORA]
    .map((n) => String(n).toLowerCase());
  const hojas = ss().getSheets();
  for (let i = 0; i < hojas.length; i++) {
    const nom = hojas[i].getName().toLowerCase();
    if (excl.indexOf(nom) >= 0) continue;
    if (/drogueria|montad|registro|bitacora/.test(nom)) continue;
    if (tieneColCedula(hojas[i])) return hojas[i];
  }
  return pref || null;
}

// Encuentra la hoja de drogerías sin importar si es singular o plural.
function hojaDrogueria() {
  return ss().getSheetByName(CONFIG.HOJA_DROG) ||
         ss().getSheetByName('DROGUERIAS') ||
         ss().getSheetByName('DROGUERIA');
}

function requireToken(t) {
  if (String(t || '') !== CONFIG.TOKEN) throw new Error('Token inválido.');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function idxAny(head, nombres) {
  for (let n = 0; n < nombres.length; n++) {
    const i = head.indexOf(nombres[n].toUpperCase());
    if (i >= 0) return i;
  }
  return -1;
}

function ahoraStr() {
  return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
}

// Busca una hoja por nombre sin importar mayúsculas/minúsculas.
function sheetCI(nombre) {
  const target = String(nombre).trim().toLowerCase();
  const hojas = ss().getSheets();
  for (let i = 0; i < hojas.length; i++) {
    if (hojas[i].getName().trim().toLowerCase() === target) return hojas[i];
  }
  return null;
}

function hojaRegistro() {
  let sh = sheetCI(CONFIG.HOJA_REGISTRO);
  if (!sh) {
    sh = ss().insertSheet(CONFIG.HOJA_REGISTRO);
    sh.appendRow(COLS_REGISTRO);
    sh.setFrozenRows(1);
  }
  return sh;
}

function carpetaFotos() {
  if (CONFIG.CARPETA_FOTOS_ID) return DriveApp.getFolderById(CONFIG.CARPETA_FOTOS_ID);
  const nombre = 'Quick Transferencias - Evidencias';
  const it = DriveApp.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nombre);
}

function bitacora(accion, idReg, actor, detalle) {
  let sh = ss().getSheetByName(CONFIG.HOJA_BITACORA);
  if (!sh) {
    sh = ss().insertSheet(CONFIG.HOJA_BITACORA);
    sh.appendRow(COLS_BITACORA);
    sh.setFrozenRows(1);
  }
  sh.appendRow([ahoraStr(), accion, idReg, actor, detalle]);
}

/** Ejecuta una vez desde el editor para crear hojas y autorizar permisos. */
function inicializar() {
  hojaRegistro();
  bitacora('INIT', '-', regenteEmail() || 'editor', 'Inicialización');
  carpetaFotos();
  Logger.log('Listo. Hojas registro/bitacora creadas y permisos autorizados.');
}
