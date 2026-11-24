'use strict';
// HU14 · Usuarios y roles. Sesión en cookie HttpOnly; la clave se guarda con scrypt y sal propia.
const crypto = require('node:crypto');
const express = require('express');

const COOKIE = 'cpad_sesion';
const HORAS_SESION = 12;
const ROLES = ['ADMINISTRADOR', 'GERENTE', 'CONSULTA'];
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 10;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(clave, sal, 32);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}
function verificarClave(clave, guardado) {
  const [alg, sal, h] = String(guardado || '').split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const calc = crypto.scryptSync(String(clave), Buffer.from(sal, 'hex'), 32);
  const esp = Buffer.from(h, 'hex');
  return esp.length === calc.length && crypto.timingSafeEqual(esp, calc);
}

/** Política mínima: 8 caracteres, con letras y números. */
function validarClave(clave) {
  const c = String(clave ?? '');
  if (c.length < 8 || c.length > 72) return 'La clave debe tener entre 8 y 72 caracteres';
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(c) || !/\d/.test(c)) return 'La clave debe combinar letras y números';
  return null;
}

/**
 * Qué puede hacer cada rol. La lectura (GET) está permitida a todos los roles.
 *  - ADMINISTRADOR: todo, incluida la gestión de usuarios.
 *  - GERENTE: consulta todo y registra o anula la planilla semanal (la aprueba).
 *  - CONSULTA: solo lectura.
 */
function permitido(rol, metodo, ruta) {
  if (ruta.startsWith('/api/usuarios')) return rol === 'ADMINISTRADOR';
  if (metodo === 'GET' || metodo === 'HEAD') return true;
  if (rol === 'ADMINISTRADOR') return true;
  if (rol === 'GERENTE') return ruta.startsWith('/api/planillas/registro');
  return false;
}

function leerCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function ponerCookie(req, res, token, maxAge) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`);
}

const publico = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo, ultimo_ingreso: u.ultimo_ingreso });

/** Crea el primer administrador si la tabla está vacía. Devuelve la clave generada, si la hubo. */
async function asegurarAdmin(pool, clave) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM usuario');
  if (rows[0].n > 0) return null;
  const c = clave || crypto.randomBytes(6).toString('base64url') + '7';
  const err = validarClave(c);
  if (err) throw new Error(`CPAD_ADMIN_CLAVE no es válida: ${err}`);
  await pool.query(`INSERT INTO usuario (usuario, nombre, rol, clave_hash) VALUES ('admin', 'Administrador', 'ADMINISTRADOR', $1)`, [hashClave(c)]);
  return clave ? null : c;
}

module.exports = function auth(pool, { HttpError, ah }) {
  const fallos = new Map(); // usuario → { n, hasta }

  /** Middleware: exige sesión en toda la API salvo el ingreso y el chequeo de salud. */
  const exigir = ah(async (req, _res, next) => {
    if (!req.path.startsWith('/api/') || req.path === '/api/salud' || req.path === '/api/auth/ingresar') return next();
    const token = leerCookie(req);
    if (!token) throw new HttpError(401, 'Inicia sesión para continuar');
    const { rows } = await pool.query(
      `SELECT u.* FROM sesion s JOIN usuario u ON u.id = s.usuario_id
        WHERE s.token_hash = $1 AND s.expira_en > now() AND u.activo`, [sha(token)]);
    if (!rows.length) throw new HttpError(401, 'La sesión expiró; vuelve a iniciar sesión');
    req.usuario = rows[0];
    if (!req.path.startsWith('/api/auth/') && !permitido(req.usuario.rol, req.method, req.path)) {
      throw new HttpError(403, `Tu rol (${req.usuario.rol.toLowerCase()}) no permite esta acción`);
    }
    next();
  });

  const r = express.Router();
  r.post('/ingresar', ah(async (req, res) => {
    const usuario = String(req.body?.usuario ?? '').trim().toLowerCase();
    const clave = String(req.body?.clave ?? '');
    const f = fallos.get(usuario);
    if (f && f.hasta > Date.now()) throw new HttpError(429, `Demasiados intentos fallidos; espera ${BLOQUEO_MIN} minutos`);
    const { rows } = await pool.query('SELECT * FROM usuario WHERE usuario = $1 AND activo', [usuario]);
    if (!rows.length || !verificarClave(clave, rows[0].clave_hash)) {
      const n = (f && f.hasta <= Date.now() && f.n >= MAX_INTENTOS ? 0 : f?.n || 0) + 1;
      fallos.set(usuario, { n, hasta: n >= MAX_INTENTOS ? Date.now() + BLOQUEO_MIN * 60000 : 0 });
      throw new HttpError(401, 'Usuario o clave incorrectos');
    }
    fallos.delete(usuario);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`DELETE FROM sesion WHERE expira_en < now()`);
    await pool.query(`INSERT INTO sesion (token_hash, usuario_id, expira_en) VALUES ($1, $2, now() + interval '${HORAS_SESION} hours')`, [sha(token), rows[0].id]);
    const { rows: u } = await pool.query('UPDATE usuario SET ultimo_ingreso = now() WHERE id = $1 RETURNING *', [rows[0].id]);
    ponerCookie(req, res, token, HORAS_SESION * 3600);
    res.json(publico(u[0]));
  }));
  r.post('/salir', ah(async (req, res) => {
    const token = leerCookie(req);
    if (token) await pool.query('DELETE FROM sesion WHERE token_hash = $1', [sha(token)]);
    ponerCookie(req, res, '', 0);
    res.json({ ok: true });
  }));
  r.get('/yo', (req, res) => res.json(publico(req.usuario)));
  r.put('/clave', ah(async (req, res) => {
    if (!verificarClave(req.body?.actual ?? '', req.usuario.clave_hash)) throw new HttpError(400, 'La clave actual no es correcta');
    const err = validarClave(req.body?.nueva);
    if (err) throw new HttpError(400, err);
    await pool.query('UPDATE usuario SET clave_hash = $1 WHERE id = $2', [hashClave(req.body.nueva), req.usuario.id]);
    // Cierra las demás sesiones del usuario
    await pool.query('DELETE FROM sesion WHERE usuario_id = $1 AND token_hash <> $2', [req.usuario.id, sha(leerCookie(req))]);
    res.json({ ok: true });
  }));

  // ---------- gestión de usuarios (solo administrador) ----------
  const u = express.Router();
  function validar(body, nuevo) {
    const errores = [];
    const out = {};
    if (nuevo) {
      const us = String(body.usuario ?? '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(us)) errores.push('usuario: de 3 a 40 caracteres (letras, números, punto, guion)');
      out.usuario = us;
    }
    if (nuevo || body.nombre !== undefined) {
      const n = String(body.nombre ?? '').trim();
      if (!n || n.length > 100) errores.push('nombre es obligatorio (máximo 100 caracteres)');
      out.nombre = n;
    }
    if (nuevo || body.rol !== undefined) {
      const rol = String(body.rol ?? '').toUpperCase();
      if (!ROLES.includes(rol)) errores.push(`rol debe ser ${ROLES.join(', ')}`);
      out.rol = rol;
    }
    if (nuevo || body.clave) {
      const e = validarClave(body.clave);
      if (e) errores.push(e);
      else out.clave_hash = hashClave(body.clave);
    }
    if (body.activo !== undefined) out.activo = body.activo !== false && body.activo !== 'false';
    if (errores.length) throw new HttpError(400, 'Datos inválidos', errores);
    return out;
  }
  async function quedaAdmin(excluirId) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM usuario WHERE rol = 'ADMINISTRADOR' AND activo AND id <> $1`, [excluirId]);
    return rows[0].n > 0;
  }
  u.get('/', ah(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM usuario ORDER BY activo DESC, usuario');
    res.json(rows.map(publico));
  }));
  u.post('/', ah(async (req, res) => {
    const d = validar(req.body || {}, true);
    const { rows } = await pool.query('INSERT INTO usuario (usuario, nombre, rol, clave_hash) VALUES ($1,$2,$3,$4) RETURNING *',
      [d.usuario, d.nombre, d.rol, d.clave_hash]);
    res.status(201).json(publico(rows[0]));
  }));
  u.put('/:id', ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'El id debe ser un entero positivo');
    const d = validar(req.body || {}, false);
    const quitaAdmin = (d.rol && d.rol !== 'ADMINISTRADOR') || d.activo === false;
    if (quitaAdmin && !(await quedaAdmin(id))) {
      const { rows } = await pool.query('SELECT rol, activo FROM usuario WHERE id = $1', [id]);
      if (rows[0]?.rol === 'ADMINISTRADOR' && rows[0].activo) throw new HttpError(409, 'Debe quedar al menos un administrador activo');
    }
    const cols = Object.keys(d);
    if (!cols.length) throw new HttpError(400, 'No hay cambios');
    const { rows } = await pool.query(`UPDATE usuario SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => d[c]), id]);
    if (!rows.length) throw new HttpError(404, 'No existe ese usuario');
    // Un cambio de rol, de clave o una baja cierran las sesiones abiertas del usuario
    if (d.rol || d.clave_hash || d.activo === false) await pool.query('DELETE FROM sesion WHERE usuario_id = $1', [id]);
    res.json(publico(rows[0]));
  }));

  return { exigir, rutas: r, usuarios: u };
};
module.exports.asegurarAdmin = asegurarAdmin;
module.exports.permitido = permitido;
module.exports.hashClave = hashClave;
module.exports.verificarClave = verificarClave;
