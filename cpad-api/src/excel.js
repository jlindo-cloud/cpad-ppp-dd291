'use strict';
// HU11 · Lectura de la planilla semanal en Excel que lleva la empresa (formato «PERSONAL EN OBRA»).
// La fila de encabezados se busca por sus nombres, no por su posición, para tolerar filas o columnas añadidas.
const ExcelJS = require('exceljs');

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[º°ª#.:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Nombre normalizado del encabezado → clave interna. */
const COLUMNAS = [
  [/^apellidos y nombres$|^apellidos y nombre$|^trabajador$/, 'nombre'],
  [/^categoria$/, 'categoria'],
  [/^dni$/, 'dni'],
  [/^fecha (de )?nacimiento$/, 'fecha_nacimiento'],
  [/^fecha (de )?ingreso$/, 'fecha_ingreso'],
  [/^banco$/, 'banco'],
  [/^n?o? ?cuenta$|^numero de cuenta$/, 'cuenta_bancaria'],
  [/^cci$/, 'cci'],
  [/^dias asist|^dias$/, 'dias'],
  [/^dscto$|^descuento$/, 'dscto'],
  [/^sueldo$/, 'sueldo'],
  [/^horas$/, 'horas'],
  [/^tot hor$|^total horas$/, 'monto_horas'],
  [/^total pago$/, 'total_pago'],
];

/** Valor plano de una celda de exceljs (fórmulas, texto enriquecido, hipervínculos). */
function valor(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return valor(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('');
    if ('text' in v) return valor(v.text);
    if ('error' in v) return null;
  }
  return v;
}

const texto = (v) => { const x = valor(v); return x == null ? '' : (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)).trim(); };

/** Fecha de la celda: fecha de Excel o texto dd/mm/aaaa. Devuelve AAAA-MM-DD, null si está vacía, o undefined si no es válida. */
function fecha(v) {
  const x = valor(v);
  if (x == null || x === '') return null;
  if (x instanceof Date) return Number.isNaN(x.getTime()) ? undefined : x.toISOString().slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(String(x).trim());
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(iso + 'T12:00:00Z');
  return d.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** Número de cuenta o CCI: se conserva como texto. Si Excel lo guardó como número largo pudo perder dígitos. */
function cuenta(v) {
  const x = valor(v);
  if (x == null || x === '') return { v: null };
  if (typeof x === 'number') {
    const s = BigInt(Math.round(x)).toString();
    return { v: s, aviso: s.length > 15 ? 'está guardado como número en Excel y pudo perder dígitos' : null };
  }
  return { v: String(x).replace(/\s+/g, '').trim() || null };
}

const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'Y', 'DA', 'DI', 'VAN', 'VON', 'MC']);

/** Separa «APELLIDO1 APELLIDO2 NOMBRES», respetando apellidos compuestos (DE LA CRUZ, DEL CASTILLO). */
function separarNombre(completo) {
  const t = String(completo || '').toUpperCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const apellido = () => { const a = []; while (t.length && PARTICULAS.has(t[0])) a.push(t.shift()); if (t.length) a.push(t.shift()); return a.join(' '); };
  if (t.length < 2) return { apellidos: t.join(' '), nombres: '' };
  const a1 = apellido();
  if (t.length <= 1) return { apellidos: a1, nombres: t.join(' ') };
  const a2 = apellido();
  if (!t.length) return { apellidos: a1, nombres: a2 }; // dos palabras más partículas: un solo apellido
  return { apellidos: `${a1} ${a2}`, nombres: t.join(' ') };
}

/** Título «(SEMANA 30) 28/09 AL 03/10». El año no figura en la hoja. */
function semanaDelTitulo(t) {
  const m = /SEMANA\s*(\d+)\)?\s*(\d{1,2})\/(\d{1,2})\s*AL\s*(\d{1,2})\/(\d{1,2})/i.exec(t || '');
  return m ? { numero: Number(m[1]), desde: `${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`, hasta: `${m[4].padStart(2, '0')}/${m[5].padStart(2, '0')}` } : null;
}

/** Lee la primera hoja con la tabla de personal. Lanza Error con un mensaje para el usuario si el archivo no sirve. */
async function leerPlanilla(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error('El archivo no es un Excel (.xlsx) válido'); }
  for (const ws of wb.worksheets) {
    let cab = null; let mapa = null; let titulo = null;
    const max = Math.min(ws.rowCount, 40);
    for (let i = 1; i <= max && !cab; i++) {
      const row = ws.getRow(i);
      const m = {};
      row.eachCell({ includeEmpty: false }, (c, col) => {
        const h = norm(texto(c.value));
        if (!titulo && /semana\s*\d+/i.test(texto(c.value))) titulo = texto(c.value);
        const k = COLUMNAS.find(([re]) => re.test(h));
        if (k && !(k[1] in m)) m[k[1]] = col;
      });
      if ('dni' in m && 'nombre' in m) { cab = i; mapa = m; }
    }
    if (!cab) continue;
    const filas = [];
    for (let i = cab + 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const get = (k) => (mapa[k] ? row.getCell(mapa[k]).value : null);
      const nombre = texto(get('nombre')); const dni = texto(get('dni'));
      if (!nombre && !dni) break; // fin de la tabla (fila de total o vacía)
      filas.push({ fila: i, get });
    }
    return { hoja: ws.name, titulo, semana: semanaDelTitulo(titulo), columnas: Object.keys(mapa), filas };
  }
  throw new Error('No se encontró la tabla de personal: falta una fila de encabezados con «Apellidos y Nombres» y «DNI»');
}

module.exports = { leerPlanilla, separarNombre, fecha, cuenta, texto, valor, norm, semanaDelTitulo };
