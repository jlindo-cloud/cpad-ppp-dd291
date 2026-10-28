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

/**
 * Calcula horas trabajadas, tardanza y sobretiempo de un registro según el horario de la obra.
 * Almuerzo: de lunes a viernes, 1 h en el horario de almuerzo de la obra (12:00 a 13:00);
 * el sábado, la hora siguiente a la salida programada (13:00 a 14:00) si la jornada se extiende.
 * Si el registro es «de corrido», el almuerzo no se descuenta y la hora que cae dentro
 * de la jornada programada se suma al sobretiempo («se le considera 1 hora más»).
 */
function calcular(reg, obra, fecha) {
  const dow = new Date(fecha + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  const out = { dia_programado: dow !== 0, horas_trabajadas: null, tardanza_min: null, sobretiempo_h: null };
  if (!reg || !reg.asistio || !reg.hora_ingreso) return out;
  const ing = min(reg.hora_ingreso), sal = min(reg.hora_salida);
  const progIng = min(obra.hora_ingreso);
  const progSal = dow === 6 ? min(obra.hora_salida_sabado) : min(obra.hora_salida);
  out.tardanza_min = dow === 0 ? null : Math.max(0, ing - progIng);
  if (sal == null) return out;
  const cruce = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  let a0 = null, a1 = null;
  if (dow >= 1 && dow <= 5) { a0 = min(obra.almuerzo_inicio); a1 = min(obra.almuerzo_fin); }
  else if (dow === 6) { a0 = progSal; a1 = progSal + (min(obra.almuerzo_fin) - min(obra.almuerzo_inicio)); }
  const corrido = !!reg.de_corrido;
  const almuerzo = a0 == null ? 0 : cruce(ing, sal, a0, a1);
  out.horas_trabajadas = Math.round((sal - ing - (corrido ? 0 : almuerzo)) / 60 * 100) / 100;
  if (dow !== 0) {
    let extra = Math.max(0, sal - progSal);
    if (a0 != null) {
      if (!corrido) extra -= cruce(progSal, sal, a0, a1);             // almuerzo tomado después de la salida
      else extra += cruce(Math.max(ing, progIng), Math.min(sal, progSal), a0, a1); // almuerzo no tomado en la jornada
    }
    out.sobretiempo_h = Math.round(Math.max(0, extra) / 60 * 100) / 100;
  }
  return out;
}

// Lunes de la semana a la que pertenece una fecha (la semana va de lunes a domingo)
function lunes(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function sumar(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
const r2 = (x) => Math.round(x * 100) / 100;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

module.exports = function asistenciaRouter(pool, { HttpError, ah }) {
  const r = express.Router();

  async function cierre(obra_id, fecha) {
    const { rows } = await pool.query('SELECT cerrado_en, observacion FROM semana_cierre WHERE obra_id = $1 AND semana_inicio = $2', [obra_id, lunes(fecha)]);
    return rows[0] || null;
  }

  /** Resumen de la semana (lunes a domingo) por trabajador: días, faltas, horas, sobretiempo y pendientes. */
  async function resumenSemana(obra, fecha) {
    const inicio = lunes(fecha); const fin = sumar(inicio, 6); const hoy = hoyLima();
    const dias = Array.from({ length: 7 }, (_, i) => sumar(inicio, i));
    const { rows: trab } = await pool.query(`
      SELECT t.id AS trabajador_id, t.dni, t.apellidos, t.nombres, t.fecha_ingreso, t.activo, c.nombre AS categoria
        FROM trabajador t JOIN categoria c ON c.id = t.categoria_id
       WHERE (t.obra_id = $1 AND t.activo)
          OR t.id IN (SELECT trabajador_id FROM asistencia WHERE obra_id = $1 AND fecha BETWEEN $2 AND $3)
       ORDER BY (c.nombre <> 'CAPATAZ'), t.apellidos, t.nombres`, [obra.id, inicio, fin]);
    const { rows: regs } = await pool.query(
      'SELECT trabajador_id, fecha, asistio, hora_ingreso, hora_salida, de_corrido, observacion FROM asistencia WHERE obra_id = $1 AND fecha BETWEEN $2 AND $3',
      [obra.id, inicio, fin]);
    const porClave = new Map(regs.map((x) => [x.trabajador_id + '|' + iso(x.fecha), x]));
    const filas = trab.map((t) => {
      const ingreso = iso(t.fecha_ingreso);
      const f = { trabajador_id: t.trabajador_id, dni: t.dni, apellidos: t.apellidos, nombres: t.nombres, categoria: t.categoria,
        dias: [], dias_asistidos: 0, faltas: 0, sin_marcar: 0, sin_salida: 0,
        horas_trabajadas: 0, sobretiempo_h: 0, horas_domingo: 0, tardanza_min: 0 };
      dias.forEach((d, i) => {
        const g = porClave.get(t.trabajador_id + '|' + d);
        const c = calcular(g ? { ...g, hora_ingreso: hhmm(g.hora_ingreso), hora_salida: hhmm(g.hora_salida) } : null, obra, d);
        const dia = { fecha: d, estado: g ? (g.asistio ? 'A' : 'F') : null, hora_ingreso: g ? hhmm(g.hora_ingreso) : null,
          hora_salida: g ? hhmm(g.hora_salida) : null, de_corrido: g ? g.de_corrido : false, observacion: g ? g.observacion : null, ...c };
        dia.pendiente = !g && i < 6 && d <= hoy && (!ingreso || d >= ingreso);
        f.dias.push(dia);
        if (g && g.asistio) {
          if (i < 6) f.dias_asistidos += 1;
          if (!g.hora_salida) f.sin_salida += 1;
          if (i === 6) f.horas_domingo += c.horas_trabajadas || 0;
          else { f.horas_trabajadas += c.horas_trabajadas || 0; f.sobretiempo_h += c.sobretiempo_h || 0; f.tardanza_min += c.tardanza_min || 0; }
        } else if (g) f.faltas += 1;
        // Día programado (lunes a sábado), ya transcurrido y posterior al ingreso del trabajador, sin marcar
        else if (dia.pendiente) f.sin_marcar += 1;
      });
      f.horas_trabajadas = r2(f.horas_trabajadas); f.sobretiempo_h = r2(f.sobretiempo_h); f.horas_domingo = r2(f.horas_domingo);
      return f;
    });
    const tot = (k) => r2(filas.reduce((s, f) => s + f[k], 0));
    return {
      obra: { id: obra.id, codigo: obra.codigo, nombre: obra.nombre },
      semana: { inicio, fin, dias },
      cierre: await cierre(obra.id, inicio),
      resumen: { trabajadores: filas.length, dias_asistidos: tot('dias_asistidos'), faltas: tot('faltas'),
        horas_trabajadas: tot('horas_trabajadas'), sobretiempo_h: tot('sobretiempo_h'), horas_domingo: tot('horas_domingo'),
        sin_marcar: tot('sin_marcar'), sin_salida: tot('sin_salida') },
      filas,
    };
  }

  r.get('/semana', ah(async (req, res) => {
    const { obra_id, fecha } = params(req.query);
    res.json(await resumenSemana(await obraActiva(obra_id), fecha));
  }));

  // Cierre: solo una semana ya terminada (sábado transcurrido) y sin días pendientes
  r.post('/semana/cierre', ah(async (req, res) => {
    const body = req.body || {};
    const { obra_id, fecha } = params(body);
    const obra = await obraActiva(obra_id);
    const s = await resumenSemana(obra, fecha);
    if (s.cierre) throw new HttpError(409, 'La semana ya está cerrada');
    if (sumar(s.semana.inicio, 5) > hoyLima()) throw new HttpError(400, 'Solo se puede cerrar una semana cuyo sábado ya transcurrió');
    const pend = s.filas.filter((f) => f.sin_marcar || f.sin_salida)
      .map((f) => ({ trabajador_id: f.trabajador_id, trabajador: `${f.apellidos}, ${f.nombres}`, sin_marcar: f.sin_marcar, sin_salida: f.sin_salida }));
    if (pend.length) return res.status(409).json({ error: 'La semana tiene días sin marcar o sin hora de salida', pendientes: pend });
    const obs = body.observacion ? String(body.observacion).trim().slice(0, 200) : null;
    await pool.query('INSERT INTO semana_cierre (obra_id, semana_inicio, observacion) VALUES ($1,$2,$3)', [obra_id, s.semana.inicio, obs]);
    res.status(201).json(await resumenSemana(obra, fecha));
  }));

  // Reapertura para corregir una semana cerrada
  r.delete('/semana/cierre', ah(async (req, res) => {
    const { obra_id, fecha } = params(req.query);
    const { rowCount } = await pool.query('DELETE FROM semana_cierre WHERE obra_id = $1 AND semana_inicio = $2', [obra_id, lunes(fecha)]);
    if (!rowCount) throw new HttpError(404, 'La semana no está cerrada');
    res.json(await resumenSemana(await obraActiva(obra_id), fecha));
  }));

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
             a.id AS asistencia_id, a.asistio, a.hora_ingreso, a.hora_salida, a.de_corrido, a.observacion
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
      semana_cerrada: !!(await cierre(obra.id, fecha)),
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
    if (await cierre(obra_id, fecha)) throw new HttpError(409, 'La semana de esa fecha está cerrada; reábrala para corregir la hoja');
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
      const corrido = asistio && g.de_corrido === true;
      if (e.length) errores.push({ fila, trabajador_id: tid || null, errores: e });
      else limpios.push([tid, asistio, asistio ? ing : null, asistio ? sal : null, corrido, obs]);
    });
    if (errores.length) return res.status(400).json({ error: 'La hoja contiene errores; no se guardó ningún registro', guardados: 0, errores });
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      for (const [tid, asistio, ing, sal, corrido, obs] of limpios) {
        await cx.query(`INSERT INTO asistencia (trabajador_id, obra_id, fecha, asistio, hora_ingreso, hora_salida, de_corrido, observacion)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                        ON CONFLICT (trabajador_id, fecha) DO UPDATE SET obra_id = EXCLUDED.obra_id, asistio = EXCLUDED.asistio,
                          hora_ingreso = EXCLUDED.hora_ingreso, hora_salida = EXCLUDED.hora_salida, de_corrido = EXCLUDED.de_corrido,
                          observacion = EXCLUDED.observacion`,
        [tid, obra_id, fecha, asistio, ing, sal, corrido, obs]);
      }
      await cx.query('COMMIT');
    } catch (err) { await cx.query('ROLLBACK'); throw err; } finally { cx.release(); }
    res.json({ guardados: limpios.length });
  }));

  r.resumenSemana = resumenSemana; r.obraActiva = obraActiva; // los usa el motor de planilla
  return r;
};
module.exports.calcular = calcular;
module.exports.lunes = lunes;
