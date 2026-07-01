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
  // CAMBIA por una cadena larga y aleatoria propia.
  TOKEN: 'QK-CAMBIA-ESTE-TOKEN-1234567890',

  // Correos ADMIN: ven y aprueban TODOS los puntos.
  // Los regentes de cada punto se autorizan SOLOS con la columna CORREO de la hoja
  // DROGUERIA (deben ser cuentas Google). Cada regente solo ve los pendientes de su punto.
  ADMIN: [
    'quick.helpai2026@gmail.com',
  ],

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

  const sh = ss().getSheetByName(CONFIG.HOJA_COLAB);
  if (!sh) return { ok: false, error: 'No existe la hoja de colaboradores.' };

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
 * Determina qué puede ver/aprobar el usuario logueado.
 * - ADMIN (CONFIG.ADMIN): todos los puntos.
 * - Regente: los puntos donde su correo está en la columna CORREO de DROGUERIA.
 */
function contextoRegente() {
  const email = regenteEmail();
  const eLower = email.toLowerCase();
  const esAdmin = CONFIG.ADMIN.map((x) => x.toLowerCase()).indexOf(eLower) >= 0;
  const puntos = [];
  let encargado = '';
  const sh = hojaDrogueria();
  if (sh) {
    const data = sh.getDataRange().getValues();
    const head = data[0].map((h) => String(h).trim().toUpperCase());
    const iCorto = idxAny(head, ['DROGUERIA NOMBRE CORTO', 'NOMBRE CORTO']);
    const iCorreo = idxAny(head, ['CORREO', 'EMAIL', 'CORREO REGENTE']);
    const iEnc = idxAny(head, ['ENCARGADO DEL PUNTO', 'REGENTE', 'ENCARGADO']);
    if (iCorreo >= 0) {
      for (let r = 1; r < data.length; r++) {
        const c = String(data[r][iCorreo]).trim().toLowerCase();
        if (c && c === eLower) {
          if (iCorto >= 0) puntos.push(String(data[r][iCorto]).trim());
          if (iEnc >= 0 && !encargado) encargado = String(data[r][iEnc]).trim();
        }
      }
    }
  }
  return { email: email, esAdmin: esAdmin, puntos: puntos, encargado: encargado,
           autorizado: esAdmin || puntos.length > 0 };
}

function getPendientes() {
  const ctx = contextoRegente();
  if (!ctx.autorizado) {
    throw new Error('No autorizado: ' + (ctx.email || 'sin sesión') +
      '. Tu correo no está como encargado en la hoja DROGUERIA ni en ADMIN.');
  }
  const sh = hojaRegistro();
  const data = sh.getDataRange().getValues();
  const head = data[0];
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const obj = {};
    head.forEach((h, i) => (obj[h] = data[r][i]));
    if (String(obj.Estado).toLowerCase() !== 'pendiente') continue;
    if (!ctx.esAdmin && ctx.puntos.indexOf(String(obj.PuntoCorto)) < 0) continue;
    obj._fila = r + 1;
    out.push(obj);
  }
  return { email: ctx.email, esAdmin: ctx.esAdmin, puntos: ctx.puntos, pendientes: out };
}

function decidir(id, decision, motivo) {
  const ctx = contextoRegente();
  if (!ctx.autorizado) throw new Error('No autorizado.');
  const email = ctx.email;
  const sh = hojaRegistro();
  const data = sh.getDataRange().getValues();
  const head = data[0];
  const iID = head.indexOf('ID');
  const iEstado = head.indexOf('Estado');
  const iMotivo = head.indexOf('MotivoRechazo');
  const iEmail = head.indexOf('RegenteEmail');
  const iFecha = head.indexOf('FechaHoraDecision');
  const iPunto = head.indexOf('PuntoCorto');

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][iID]) === String(id)) {
      // Un regente solo decide sobre su(s) punto(s); el admin sobre todos.
      if (!ctx.esAdmin && ctx.puntos.indexOf(String(data[r][iPunto])) < 0) {
        throw new Error('No autorizado para el punto de este registro.');
      }
      const estadoActual = String(data[r][iEstado]).toLowerCase();
      // INMUTABILIDAD: si ya fue decidido, no se puede cambiar.
      if (estadoActual !== 'pendiente') {
        throw new Error('Este registro ya fue ' + estadoActual + ' y no se puede modificar.');
      }
      const nuevo = decision === 'aprobar' ? 'Aprobado' : 'Rechazado';
      const fila = r + 1;
      sh.getRange(fila, iEstado + 1).setValue(nuevo);
      sh.getRange(fila, iEmail + 1).setValue(email);
      sh.getRange(fila, iFecha + 1).setValue(ahoraStr());
      if (decision === 'rechazar') sh.getRange(fila, iMotivo + 1).setValue(motivo || '');
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

function hojaRegistro() {
  let sh = ss().getSheetByName(CONFIG.HOJA_REGISTRO);
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
