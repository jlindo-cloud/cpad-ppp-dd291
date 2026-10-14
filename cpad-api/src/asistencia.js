'use strict';
const express = require('express');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const min = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// Fecha de hoy en Lima (UTC-5), para impedir registrar días futuros
function hoyLima() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Calcula horas trabajadas, tardanza y sobretiempo de un registro según el horario de la obra. */
function calcular(reg, obra, fecha) {
  const dow = new Date(fecha + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  const out = { dia_programado: dow !== 0, horas_trabajadas: null, tardanza_min: null, sobretiempo_h: null };
  if (!reg || !reg.asistio || !reg.hora_ingreso) return out;
  const ing = min(reg.hora_ingreso), sal = min(reg.hora_salida);
  const progIng = min(obra.hora_ingreso);
  const progSal = dow === 6 ? min(obra.hora_salida_sabado) : min(obra.hora_salida);
  out.tardanza_min = dow === 0 ? null : Math.max(0, ing - progIng);
  if (sal == null) return out;
  let trabajado = sal - ing;
  if (dow >= 1 && dow <= 5) { // almuerzo solo en días de semana
    const a0 = min(obra.almuerzo_inicio), a1 = min(obra.almuerzo_fin);
    trabajado -= Math.max(0, Math.min(sal, a1) - Math.max(ing, a0));
  }
  out.horas_trabajadas = Math.round(trabajado / 60 * 100) / 100;
  out.sobretiempo_h = dow === 0 ? null : Math.round(Math.max(0, sal - progSal) / 60 * 100) / 100;
  return out;
}

module.exports = function asistenciaRouter(pool, { HttpError, ah }) {
  const r = express.Router();

  async function obraActiva(id) {
    const { rows } = await pool.query('SELECT * FROM obra WHERE id = $1 AND activo', [id]);
    if (!rows.length) throw new HttpError(404, 'No existe una obra activa con ese id');
    return rows[0];
  }
  function params(q) {
    const obra_id = Number(q.obra_id);
    if (!Number.isInteger(obra_id) || obra_id <= 0) throw new HttpError(400, 'obra_id es obligatorio');
    if (!DATE.test(String(q.fecha || '')) || isNaN(Date.parse(q.fecha))) throw new HttpError(400, 'fecha debe tener el formato AAAA-MM-DD');
    return { obra_id, fecha: q.fecha };
  }

  // Hoja del día: todos los trabajadores activos de la obra, con su registro si existe (como el formato impreso)
  r.get('/', ah(async (req, res) => {
    const { obra_id, fecha } = params(req.query);
    const obra = await obraActiva(obra_id);
    const { rows } = await pool.query(`
      SELECT t.id AS trabajador_id, t.dni, t.apellidos, t.nombres, c.nombre AS categoria, e.nombre AS especialidad,
             a.id AS asistencia_id, a.asistio, a.hora_ingreso, a.hora_salida, a.observacion
        FROM trabajador t
        JOIN categoria c ON c.id = t.categoria_id
        JOIN especialidad e ON e.id = t.especialidad_id
        LEFT JOIN asistencia a ON a.trabajador_id = t.id AND a.fecha = $2
       WHERE t.obra_id = $1 AND t.activo
       ORDER BY (c.nombre <> 'CAPATAZ'), t.apellidos, t.nombres`, [obra_id, fecha]);
    const filas = rows.map((x) => ({
      ...x, hora_ingreso: hhmm(x.hora_ingreso), hora_salida: hhmm(x.hora_salida), registrado: x.asistencia_id != null,
      ...calcular(x.asistencia_id ? x : null, obra, fecha),
    }));
    const reg = filas.filter((f) => f.registrado);
    res.json({
      obra: { id: obra.id, codigo: obra.codigo, nombre: obra.nombre, hora_ingreso: hhmm(obra.hora_ingreso), hora_salida: hhmm(obra.hora_salida),
        hora_salida_sabado: hhmm(obra.hora_salida_sabado), almuerzo_inicio: hhmm(obra.almuerzo_inicio), almuerzo_fin: hhmm(obra.almuerzo_fin) },
      fecha,
      resumen: {
        trabajadores: filas.length, registrados: reg.length,
        asistieron: reg.filter((f) => f.asistio).length, faltaron: reg.filter((f) => !f.asistio).length,
        sin_salida: reg.filter((f) => f.asistio && !f.hora_salida).length,
        sobretiempo_h: Math.round(reg.reduce((s, f) => s + (f.sobretiempo_h || 0), 0) * 100) / 100,
      },
      filas,
    });
  }));

  // Registro (o corrección) de la hoja del día completa, en una sola transacción
  r.put('/', ah(async (req, res) => {
    const body = req.body || {};
    const { obra_id, fecha } = params(body);
    if (fecha > hoyLima()) throw new HttpError(400, 'No se puede registrar asistencia de una fecha futura');
    await obraActiva(obra_id);
    const registros = body.registros;
    if (!Array.isArray(registros) || !registros.length) throw new HttpError(400, 'Se requiere la lista "registros"');
    const propios = new Set((await pool.query('SELECT id FROM trabajador WHERE obra_id = $1 AND activo', [obra_id])).rows.map((x) => x.id));
    const errores = []; const vistos = new Set(); const limpios = [];
    registros.forEach((g, i) => {
      const e = []; const fila = i + 1;
      const tid = Number(g && g.trabajador_id);
      if (!propios.has(tid)) e.push('el trabajador no pertenece a la obra o no está activo');
      if (vistos.has(tid)) e.push('trabajador repetido');
      vistos.add(tid);
      const asistio = g.asistio !== false;
      const ing = g.hora_ingreso || null, sal = g.hora_salida || null;
      if (asistio) {
        if (!ing || !TIME.test(ing)) e.push('hora_ingreso es obligatoria (HH:MM) cuando el trabajador asistió');
        if (sal && !TIME.test(sal)) e.push('hora_salida debe tener el formato HH:MM');
        if (ing && sal && TIME.test(ing) && TIME.test(sal) && min(sal) <= min(ing)) e.push('la hora de salida debe ser posterior a la de ingreso');
      } else if (ing || sal) e.push('si el trabajador faltó no se registran horas');
      const obs = g.observacion ? String(g.observacion).trim().slice(0, 200) : null;
      if (e.length) errores.push({ fila, trabajador_id: tid || null, errores: e });
      else limpios.push([tid, asistio, asistio ? ing : null, asistio ? sal : null, obs]);
    });
    if (errores.length) return res.status(400).json({ error: 'La hoja contiene errores; no se guardó ningún registro', guardados: 0, errores });
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      for (const [tid, asistio, ing, sal, obs] of limpios) {
        await cx.query(`INSERT INTO asistencia (trabajador_id, obra_id, fecha, asistio, hora_ingreso, hora_salida, observacion)
                        VALUES ($1,$2,$3,$4,$5,$6,$7)
                        ON CONFLICT (trabajador_id, fecha) DO UPDATE SET obra_id = EXCLUDED.obra_id, asistio = EXCLUDED.asistio,
                          hora_ingreso = EXCLUDED.hora_ingreso, hora_salida = EXCLUDED.hora_salida, observacion = EXCLUDED.observacion`,
        [tid, obra_id, fecha, asistio, ing, sal, obs]);
      }
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); throw err; } finally { cx.release(); }
    res.json({ guardados: limpios.length });
  }));

  return r;
};
module.exports.calcular = calcular;
