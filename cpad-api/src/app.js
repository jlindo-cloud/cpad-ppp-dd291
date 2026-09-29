'use strict';
const express = require('express');

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'El id debe ser un entero positivo');
  return id;
}

function text(v, field, max, errors, required = true) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) errors.push(`${field} es obligatorio`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) errors.push(`${field} admite como máximo ${max} caracteres`);
  return s;
}

// ---------- validadores ----------
function validarCatalogo(body) {
  const errors = [];
  const nombre = text(body.nombre, 'nombre', 40, errors);
  if (errors.length) throw new HttpError(400, 'Datos inválidos', errors);
  return { nombre: nombre.toUpperCase() };
}

function validarObra(body) {
  const errors = [];
  const o = {
    codigo: text(body.codigo, 'codigo', 20, errors),
    nombre: text(body.nombre, 'nombre', 150, errors),
    direccion: text(body.direccion, 'direccion', 250, errors, false),
    distrito: text(body.distrito, 'distrito', 80, errors, false),
  };
  for (const f of ['hora_ingreso', 'hora_salida', 'hora_salida_sabado', 'almuerzo_inicio', 'almuerzo_fin']) {
    if (body[f] !== undefined) {
      if (!TIME.test(String(body[f]))) errors.push(`${f} debe tener el formato HH:MM`);
      else o[f] = body[f];
    }
  }
  if (errors.length) throw new HttpError(400, 'Datos inválidos', errors);
  return o;
}

function validarTrabajador(body) {
  const errors = [];
  const dni = String(body.dni ?? '').trim();
  if (!/^\d{8}$/.test(dni)) errors.push('dni debe tener exactamente 8 dígitos');
  const t = {
    dni,
    apellidos: text(body.apellidos, 'apellidos', 100, errors),
    nombres: text(body.nombres, 'nombres', 100, errors),
  };
  for (const f of ['categoria_id', 'especialidad_id']) {
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n <= 0) errors.push(`${f} es obligatorio y debe ser un entero positivo`);
    else t[f] = n;
  }
  if (body.obra_id !== undefined && body.obra_id !== null) {
    const n = Number(body.obra_id);
    if (!Number.isInteger(n) || n <= 0) errors.push('obra_id debe ser un entero positivo');
    else t.obra_id = n;
  } else t.obra_id = null;
  if (body.fecha_ingreso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.fecha_ingreso) || isNaN(Date.parse(body.fecha_ingreso)))
      errors.push('fecha_ingreso debe tener el formato AAAA-MM-DD');
    else t.fecha_ingreso = body.fecha_ingreso;
  } else t.fecha_ingreso = null;
  if (t.apellidos) t.apellidos = t.apellidos.toUpperCase();
  if (t.nombres) t.nombres = t.nombres.toUpperCase();
  if (errors.length) throw new HttpError(400, 'Datos inválidos', errors);
  return t;
}

// ---------- CRUD genérico ----------
function crud(pool, table, validar, { order = 'id', filters = () => ({ where: [], params: [] }), select } = {}) {
  const r = express.Router();
  const sel = select || `SELECT * FROM ${table}`;

  r.get('/', ah(async (req, res) => {
    const { where, params } = filters(req.query);
    if (req.query.activo !== undefined) {
      params.push(req.query.activo !== 'false');
      where.push(`${table}.activo = $${params.length}`);
    }
    const sql = `${sel}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  }));

  r.get('/:id', ah(async (req, res) => {
    const { rows } = await pool.query(`${sel} WHERE ${table}.id = $1`, [idParam(req)]);
    if (!rows.length) throw new HttpError(404, `No existe ${table} con ese id`);
    res.json(rows[0]);
  }));

  r.post('/', ah(async (req, res) => {
    const data = validar(req.body || {});
    const cols = Object.keys(data);
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
      cols.map((c) => data[c]));
    res.status(201).json(rows[0]);
  }));

  r.put('/:id', ah(async (req, res) => {
    const id = idParam(req);
    const data = validar(req.body || {});
    const cols = Object.keys(data);
    const { rows } = await pool.query(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => data[c]), id]);
    if (!rows.length) throw new HttpError(404, `No existe ${table} con ese id`);
    res.json(rows[0]);
  }));

  // Baja lógica: se conserva el histórico para planillas ya emitidas
  r.delete('/:id', ah(async (req, res) => {
    const { rows } = await pool.query(`UPDATE ${table} SET activo = FALSE WHERE id = $1 RETURNING *`, [idParam(req)]);
    if (!rows.length) throw new HttpError(404, `No existe ${table} con ese id`);
    res.json(rows[0]);
  }));

  return r;
}

function createApp(pool) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/salud', ah(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ estado: 'ok', servicio: 'cpad-api', version: '0.1.0' });
  }));

  app.use('/api/categorias', crud(pool, 'categoria', validarCatalogo, { order: 'nombre' }));
  app.use('/api/especialidades', crud(pool, 'especialidad', validarCatalogo, { order: 'nombre' }));
  app.use('/api/obras', crud(pool, 'obra', validarObra, { order: 'codigo' }));

  const trabajadores = express.Router();
  trabajadores.get('/dni/:dni', ah(async (req, res) => {
    if (!/^\d{8}$/.test(req.params.dni)) throw new HttpError(400, 'dni debe tener exactamente 8 dígitos');
    const { rows } = await pool.query(`${SEL_TRAB} WHERE trabajador.dni = $1`, [req.params.dni]);
    if (!rows.length) throw new HttpError(404, 'No existe un trabajador con ese DNI');
    res.json(rows[0]);
  }));
  trabajadores.use(crud(pool, 'trabajador', validarTrabajador, {
    order: 'trabajador.apellidos, trabajador.nombres',
    select: SEL_TRAB,
    filters: (q) => {
      const where = [], params = [];
      for (const f of ['obra_id', 'categoria_id', 'especialidad_id']) {
        if (q[f] !== undefined) { params.push(Number(q[f])); where.push(`trabajador.${f} = $${params.length}`); }
      }
      if (q.q) {
        params.push(`%${String(q.q).toUpperCase()}%`);
        where.push(`(trabajador.apellidos || ' ' || trabajador.nombres LIKE $${params.length} OR trabajador.dni LIKE $${params.length})`);
      }
      return { where, params };
    },
  }));
  app.use('/api/trabajadores', trabajadores);

  app.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado' });
    if (err.code === '23505') return res.status(409).json({ error: 'Registro duplicado', detalle: err.detail });
    if (err.code === '23503') return res.status(409).json({ error: 'Referencia inexistente', detalle: err.detail });
    if (err.code === '23514') return res.status(400).json({ error: 'Restricción de datos incumplida', detalle: err.constraint });
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Error interno' : err.message, ...(err.details ? { detalles: err.details } : {}) });
  });
  return app;
}

const SEL_TRAB = `SELECT trabajador.*, categoria.nombre AS categoria, especialidad.nombre AS especialidad, obra.codigo AS obra
  FROM trabajador
  JOIN categoria ON categoria.id = trabajador.categoria_id
  JOIN especialidad ON especialidad.id = trabajador.especialidad_id
  LEFT JOIN obra ON obra.id = trabajador.obra_id`;

module.exports = { createApp, HttpError };
