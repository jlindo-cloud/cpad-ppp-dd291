'use strict';
// HU11 · Importación del padrón desde la planilla en Excel de la empresa.
// Sin «confirmar» devuelve la vista previa; con «confirmar=1» registra los nuevos y actualiza los existentes
// en una sola transacción. El archivo se vuelve a leer al confirmar: no se confía en filas editadas por el cliente.
const express = require('express');
const { leerPlanilla, separarNombre, fecha, cuenta, texto, norm } = require('./excel');

const CATEGORIA = { peon: 'AYUDANTE', ayudante: 'AYUDANTE' };
const CAMPOS = ['fecha_nacimiento', 'fecha_ingreso', 'banco', 'cuenta_bancaria', 'cci'];

module.exports = function importacionRouter(pool, { HttpError, ah }) {
  const r = express.Router();
  const crudo = express.raw({ type: () => true, limit: '5mb' });

  async function analizar(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, 'Adjunte el archivo Excel (.xlsx)');
    let hoja;
    try { hoja = await leerPlanilla(buffer); } catch (e) { throw new HttpError(400, e.message); }
    const { rows: cats } = await pool.query('SELECT id, nombre FROM categoria WHERE activo');
    const catPor = new Map(cats.map((c) => [norm(c.nombre), c]));
    const dnis = [];
    const filas = hoja.filas.map(({ fila, get }) => {
      const errores = []; const avisos = [];
      let dni = texto(get('dni')).replace(/\D/g, '');
      if (/^\d{7}$/.test(dni)) { dni = '0' + dni; avisos.push('el DNI perdió el cero inicial en Excel; se completó'); }
      if (!/^\d{8}$/.test(dni)) errores.push('DNI inválido');
      const completo = texto(get('nombre')).replace(/\s+/g, ' ');
      const { apellidos, nombres } = separarNombre(completo);
      if (!apellidos || !nombres) errores.push('no se pudo separar apellidos y nombres');
      const catTxt = texto(get('categoria'));
      const cat = catPor.get(norm(CATEGORIA[norm(catTxt)] || catTxt));
      if (!cat) errores.push(catTxt ? `categoría «${catTxt}» no registrada` : 'falta la categoría');
      const d = { fecha_nacimiento: fecha(get('fecha_nacimiento')), fecha_ingreso: fecha(get('fecha_ingreso')) };
      for (const k of ['fecha_nacimiento', 'fecha_ingreso']) if (d[k] === undefined) { errores.push(`${k.replace('_', ' de ')} inválida`); d[k] = null; }
      const banco = texto(get('banco')).toUpperCase().slice(0, 40) || null;
      const cta = cuenta(get('cuenta_bancaria')); const cci = cuenta(get('cci'));
      if (cta.aviso) avisos.push(`la cuenta ${cta.aviso}`);
      if (cci.aviso) avisos.push(`el CCI ${cci.aviso}`);
      if (cta.v && cta.v.length > 30) errores.push('número de cuenta demasiado largo');
      if (cci.v && !/^\d{20}$/.test(cci.v)) errores.push('el CCI debe tener 20 dígitos');
      if (dnis.includes(dni)) errores.push('DNI repetido en el archivo');
      dnis.push(dni);
      return { fila, dni, nombre_completo: completo, apellidos, nombres, categoria: cat?.nombre || catTxt || null, categoria_id: cat?.id || null,
        ...d, banco, cuenta_bancaria: cta.v, cci: cci.v, errores, avisos };
    });
    const { rows: ex } = await pool.query(`SELECT t.id, t.dni, t.apellidos, t.nombres, t.categoria_id, c.nombre AS categoria,
        t.fecha_nacimiento, t.fecha_ingreso, t.banco, t.cuenta_bancaria, t.cci
      FROM trabajador t JOIN categoria c ON c.id = t.categoria_id WHERE t.dni = ANY($1)`, [dnis.filter((x) => /^\d{8}$/.test(x))]);
    const exPor = new Map(ex.map((x) => [x.dni, x]));
    for (const f of filas) {
      const t = exPor.get(f.dni);
      if (f.errores.length) { f.estado = 'error'; continue; }
      if (!t) { f.estado = 'nuevo'; continue; }
      f.trabajador_id = t.id;
      f.cambios = CAMPOS.filter((k) => f[k] != null && String(f[k]) !== String(t[k] ?? ''));
      if (t.categoria_id !== f.categoria_id) f.avisos.push(`en CPAD figura como ${t.categoria}; la categoría no se cambia desde la importación`);
      if (norm(`${t.apellidos} ${t.nombres}`) !== norm(`${f.apellidos} ${f.nombres}`)) f.avisos.push(`en CPAD figura como ${t.apellidos}, ${t.nombres}; el nombre no se cambia`);
      f.estado = f.cambios.length ? 'actualiza' : 'sin_cambios';
    }
    const cuenta_ = (e) => filas.filter((f) => f.estado === e).length;
    return { hoja: hoja.hoja, titulo: hoja.titulo, semana: hoja.semana, columnas: hoja.columnas, filas,
      resumen: { filas: filas.length, nuevos: cuenta_('nuevo'), actualiza: cuenta_('actualiza'), sin_cambios: cuenta_('sin_cambios'), errores: cuenta_('error') } };
  }

  r.post('/padron', crudo, ah(async (req, res) => {
    const v = await analizar(req.body);
    if (!['1', 'true', 'si'].includes(String(req.query.confirmar || '').toLowerCase())) return res.json(v);
    if (v.resumen.errores) return res.status(400).json({ error: 'El archivo tiene filas con errores; no se registró ninguna', ...v });
    const nuevos = v.filas.filter((f) => f.estado === 'nuevo');
    const obra_id = Number(req.query.obra_id); const esp = Number(req.query.especialidad_id);
    if (nuevos.length) {
      const { rows: o } = Number.isInteger(obra_id) && obra_id > 0 ? await pool.query('SELECT 1 FROM obra WHERE id = $1 AND activo', [obra_id]) : { rows: [] };
      if (!o.length) throw new HttpError(400, 'Indique la obra activa a la que se asignan los trabajadores nuevos');
      const { rows: e } = Number.isInteger(esp) && esp > 0 ? await pool.query('SELECT 1 FROM especialidad WHERE id = $1 AND activo', [esp]) : { rows: [] };
      if (!e.length) throw new HttpError(400, 'Indique la especialidad de los trabajadores nuevos');
    }
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      for (const f of nuevos) {
        await cx.query(`INSERT INTO trabajador (dni, apellidos, nombres, categoria_id, especialidad_id, obra_id, fecha_ingreso, fecha_nacimiento, banco, cuenta_bancaria, cci)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [f.dni, f.apellidos, f.nombres, f.categoria_id, esp, obra_id, f.fecha_ingreso, f.fecha_nacimiento, f.banco, f.cuenta_bancaria, f.cci]);
      }
      for (const f of v.filas.filter((x) => x.estado === 'actualiza')) {
        const sets = f.cambios.map((k, i) => `${k} = $${i + 2}`).join(', ');
        await cx.query(`UPDATE trabajador SET ${sets} WHERE id = $1`, [f.trabajador_id, ...f.cambios.map((k) => f[k])]);
      }
      await cx.query('COMMIT');
    } catch (e) { await cx.query('ROLLBACK'); throw e; } finally { cx.release(); }
    res.status(201).json({ registrados: nuevos.length, actualizados: v.resumen.actualiza, sin_cambios: v.resumen.sin_cambios, filas: v.filas.length });
  }));

  return r;
};
