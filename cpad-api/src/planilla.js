'use strict';
// Sprint 3 · HU07: motor de cálculo de la planilla semanal del obrero de construcción civil.
// Todo se calcula en céntimos enteros con redondeo al céntimo más cercano (mitad hacia arriba),
// para que el resultado coincida exactamente con las boletas emitidas.
const express = require('express');
const { generarBoletas } = require('./boleta-pdf');

const c = (soles) => Math.round(Number(soles) * 100);          // soles -> céntimos
const s = (cent) => Math.round(cent) / 100;                    // céntimos -> soles
const pct = (baseCent, p) => Math.round((baseCent * Number(p)) / 100);

/** Número correlativo de la semana en la obra: la semana base es la 1. Sin base, o antes de ella, no hay número. */
function numeroSemana(inicio, base) {
  if (!base) return null;
  const n = Math.round((Date.parse(inicio) - Date.parse(base)) / (7 * 864e5)) + 1;
  return n > 0 ? n : null;
}

/**
 * Depósito de la semana según lo que la empresa paga en la práctica:
 * sueldo semanal × días ÷ 6 + horas extras × tarifa, redondeado al sol hacia arriba, menos el descuento (DSCTO).
 * Las horas extras que se pagan con la semana N son las trabajadas en la semana N + 1 («semana adentro»).
 * Reproduce los 11 depósitos de la semana 30 de 2026.
 */
function calcularDeposito({ sueldo_semanal, dias, horas_extras = 0, tarifa_hora_extra = 0, descuento = 0 }) {
  const bruto = Math.round((c(sueldo_semanal) * Number(dias)) / 6 + Number(horas_extras) * c(tarifa_hora_extra || 0));
  const pago = Math.ceil(bruto / 100) * 100;              // al sol, siempre hacia arriba
  const des = c(descuento || 0);
  return { pago_semana: s(pago), descuento: s(des), deposito: s(pago - des) };
}

/**
 * Calcula la boleta semanal de un trabajador.
 * t: { jornal, pct_buc, valor_hora_extra, dias, horas_extras, depositado? }
 * p: parámetros vigentes (movilidad, gratificación, porcentajes)
 * Si se indica el monto depositado, el dominical es el ajuste que hace que el neto coincida con él;
 * si el resto de conceptos ya lo supera, el dominical queda en cero y la diferencia se registra como adelanto.
 */
function calcularBoleta(t, p) {
  const J = c(t.jornal); const d = Number(t.dias) || 0;
  const r = {};
  r.jornal_semanal = J * d;
  r.horas_extras = Math.round(Number(t.horas_extras || 0) * c(t.valor_hora_extra));
  r.buc = pct(r.jornal_semanal, t.pct_buc);
  r.movilidad = c(p.movilidad_diaria) * d;
  r.gratificacion = Math.round((J * Number(p.dias_gratificacion)) / Number(p.base_gratificacion)) * d;
  r.bonif_extraordinaria = pct(r.gratificacion, p.pct_bonif_extra);
  r.vacaciones = pct(J, p.pct_vacaciones) * d;
  r.cts = pct(J, p.pct_cts) * d;
  const sinDominical = r.jornal_semanal + r.horas_extras + r.buc + r.movilidad + r.gratificacion + r.bonif_extraordinaria + r.vacaciones + r.cts;
  const snp = (tot) => pct(tot, p.pct_snp);
  let total; r.dominical = 0; r.adelantos = 0; let cuadre = 'sin_deposito';
  if (t.depositado != null && t.depositado !== '') {
    const V = c(t.depositado);
    // total de remuneración cuyo neto (total - SNP) es exactamente el depósito
    const base = Math.round((V * 100) / (100 - Number(p.pct_snp)));
    total = [base, base - 1, base + 1, base - 2, base + 2].find((x) => x - snp(x) === V) ?? base;
    if (total >= sinDominical) { r.dominical = total - sinDominical; cuadre = 'dominical'; }
    else { total = sinDominical; r.adelantos = total - snp(total) - V; cuadre = 'adelantos'; }
  } else total = sinDominical;
  r.total_remuneracion = total;
  r.snp = snp(total);
  r.total_descuento = r.snp + r.adelantos;
  r.neto = total - r.total_descuento;
  r.essalud = pct(r.jornal_semanal, p.pct_essalud);
  r.sctr = pct(r.jornal_semanal, p.pct_sctr);
  r.sctr_pension = pct(r.jornal_semanal, p.pct_sctr_pension);
  r.total_aportes = r.essalud + r.sctr + r.sctr_pension;
  const out = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, s(v)]));
  return { ...out, dias: d, horas_extras_pagadas: Number(t.horas_extras || 0), cuadre };
}

module.exports = function planillaRouter(pool, { HttpError, ah, resumenSemana, obraActiva }) {
  const r = express.Router();
  const FECHA = /^\d{4}-\d{2}-\d{2}$/;

  async function vigentes(fecha) {
    const { rows: [p] } = await pool.query('SELECT * FROM parametro_planilla WHERE vigente_desde <= $1 ORDER BY vigente_desde DESC LIMIT 1', [fecha]);
    if (!p) throw new HttpError(400, 'No hay parámetros de planilla vigentes para esa fecha');
    const { rows: js } = await pool.query(`
      SELECT DISTINCT ON (j.categoria_id) j.categoria_id, c.nombre AS categoria, j.jornal, j.pct_buc, j.valor_hora_extra, j.vigente_desde
        FROM jornal_categoria j JOIN categoria c ON c.id = j.categoria_id
       WHERE j.vigente_desde <= $1 ORDER BY j.categoria_id, j.vigente_desde DESC`, [fecha]);
    const { rows: ps } = await pool.query(`
      SELECT DISTINCT ON (g.categoria_id) g.categoria_id, c.nombre AS categoria, g.sueldo_semanal, g.tarifa_hora_extra, g.vigente_desde
        FROM pago_categoria g JOIN categoria c ON c.id = g.categoria_id
       WHERE g.vigente_desde <= $1 ORDER BY g.categoria_id, g.vigente_desde DESC`, [fecha]);
    return { p, jornales: new Map(js.map((j) => [j.categoria_id, j])), lista: js, pagos: new Map(ps.map((x) => [x.categoria_id, x])), lista_pagos: ps };
  }

  r.get('/parametros', ah(async (req, res) => {
    const fecha = FECHA.test(String(req.query.fecha || '')) ? req.query.fecha : new Date().toISOString().slice(0, 10);
    const { p, lista, lista_pagos } = await vigentes(fecha);
    res.json({ parametros: p, jornales: lista, pagos: lista_pagos });
  }));

  async function semanaCerrada(obra_id, fecha) {
    if (!Number.isInteger(obra_id) || obra_id <= 0) throw new HttpError(400, 'obra_id es obligatorio');
    if (!FECHA.test(String(fecha || ''))) throw new HttpError(400, 'fecha debe tener el formato AAAA-MM-DD');
    const obra = await obraActiva(obra_id);
    const sem = await resumenSemana(obra, fecha);
    if (!sem.cierre) throw new HttpError(409, 'La planilla solo se calcula sobre una semana cerrada');
    return sem;
  }

  /**
   * Calcula la planilla de una semana cerrada. Las horas extras pagadas y el descuento (DSCTO) salen de lo registrado por el
   * administrador (ajuste_planilla); el cuerpo de la petición puede reemplazarlos. El depósito se calcula con el
   * sueldo semanal de la categoría de pago, salvo que se indique explícitamente.
   */
  async function calcularSemana(sem, o = {}) {
    const { p, jornales, pagos } = await vigentes(sem.semana.inicio);
    const { rows: aj } = await pool.query('SELECT trabajador_id, horas_extras, descuento, nota FROM ajuste_planilla WHERE obra_id = $1 AND semana_inicio = $2', [sem.obra.id, sem.semana.inicio]);
    const ajuste = new Map(aj.map((x) => [x.trabajador_id, x]));
    const he = o.horas_extras || {}; const dep = o.depositado || {}; const des = o.descuentos || {};
    const { rows: cats } = await pool.query('SELECT id, categoria_id, categoria_pago_id FROM trabajador WHERE id = ANY($1)', [sem.filas.map((f) => f.trabajador_id)]);
    const catDe = new Map(cats.map((x) => [x.id, x.categoria_pago_id || x.categoria_id]));
    // Las horas extras que se pagan con esta semana son las de la semana siguiente: su sobretiempo del tareo es la referencia
    const sig = await resumenSemana(sem.obra, new Date(Date.parse(sem.semana.inicio + 'T12:00:00Z') + 7 * 864e5).toISOString().slice(0, 10));
    const sobreSig = new Map(sig.filas.map((x) => [x.trabajador_id, x.sobretiempo_h]));
    const errores = []; const boletas = [];
    for (const f of sem.filas) {
      if (!f.dias_asistidos) continue; // sin días laborados no hay boleta
      const e = [];
      const cat = catDe.get(f.trabajador_id);
      const j = jornales.get(cat); const g = pagos.get(cat); const a = ajuste.get(f.trabajador_id);
      if (!j) e.push('su categoría de pago no tiene jornal de tabla vigente');
      const h = Number(he[f.trabajador_id] ?? a?.horas_extras ?? 0);
      if (!(h >= 0) || h > 60) e.push('horas extras inválidas');
      const ds = Number(des[f.trabajador_id] ?? a?.descuento ?? 0);
      if (!(ds >= 0)) e.push('descuento inválido');
      let v = dep[f.trabajador_id]; let d = null;
      if (v != null && v !== '') { if (!(Number(v) > 0)) e.push('monto depositado inválido'); }
      else if (!g) e.push('su categoría de pago no tiene sueldo semanal vigente');
      else if (h > 0 && g.tarifa_hora_extra == null) e.push('falta definir la tarifa de la hora extra de su categoría');
      else {
        d = calcularDeposito({ sueldo_semanal: g.sueldo_semanal, dias: f.dias_asistidos, horas_extras: h, tarifa_hora_extra: g.tarifa_hora_extra, descuento: ds });
        if (d.deposito <= 0) e.push('el descuento iguala o supera el pago de la semana');
        v = d.deposito;
      }
      if (e.length) { errores.push({ trabajador_id: f.trabajador_id, trabajador: `${f.apellidos}, ${f.nombres}`, categoria_pago: j?.categoria || g?.categoria || null, errores: e }); continue; }
      const horas_normales = f.dias.slice(0, 6).reduce((acc, x, i) => acc + (x.estado === 'A' ? (i === 5 ? 5.5 : 8.5) : 0), 0);
      boletas.push({
        trabajador_id: f.trabajador_id, dni: f.dni, apellidos: f.apellidos, nombres: f.nombres,
        categoria_tareo: f.categoria, categoria_pago: j.categoria, jornal: Number(j.jornal),
        sueldo_semanal: g ? Number(g.sueldo_semanal) : null, tarifa_hora_extra: g?.tarifa_hora_extra != null ? Number(g.tarifa_hora_extra) : null,
        horas_normales, sobretiempo_tareo: sobreSig.get(f.trabajador_id) || 0, nota: a?.nota || null,
        pago_semana: d ? d.pago_semana : null, descuento: d ? d.descuento : 0, deposito: Number(v),
        ...calcularBoleta({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: f.dias_asistidos, horas_extras: h, depositado: d ? d.pago_semana : v }, p),
      });
    }
    const sum = (k) => Math.round(boletas.reduce((acc, x) => acc + x[k] * 100, 0)) / 100;
    const semana_horas_extras = { inicio: sig.semana.inicio, fin: sig.semana.fin, cerrada: !!sig.cierre };
    return { obra: sem.obra, semana: sem.semana, cierre: sem.cierre, semana_horas_extras, parametros: { pct_snp: Number(p.pct_snp) }, boletas, errores,
      totales: { trabajadores: boletas.length, total_remuneracion: sum('total_remuneracion'), total_descuento: sum('total_descuento'),
        neto: sum('neto'), deposito: sum('deposito'), descuento: sum('descuento'), total_aportes: sum('total_aportes') } };
  }

  // Vista de la planilla para la pantalla: siempre responde, e informa qué trabajadores no se pudieron calcular
  async function vistaSemana(sem) {
    const reg = await registro(sem.obra.id, sem.semana.inicio);
    if (!reg) return { ...(await calcularSemana(sem)), registro: null };
    return vistaRegistro(reg, await calcularSemana(sem));
  }

  /** Planilla registrada tal como se guardó; sirve también para semanas importadas sin asistencia en CPAD. */
  function vistaRegistro(reg, out = null, pctSnp = null) {
    const sum = (k) => Math.round(reg.boletas.reduce((acc, x) => acc + (Number(x[k]) || 0) * 100, 0)) / 100;
    const base = out || { obra: { ...reg.obra }, semana: { inicio: reg.semana_inicio, fin: new Date(Date.parse(reg.semana_inicio + 'T12:00:00Z') + 6 * 864e5).toISOString().slice(0, 10) },
      cierre: null, semana_horas_extras: null, parametros: { pct_snp: pctSnp } };
    return { ...base, boletas: reg.boletas, errores: [],
      registro: { registrado_en: reg.registrado_en, numero_semana: reg.numero_semana, origen: reg.origen },
      totales: { trabajadores: reg.boletas.length, total_remuneracion: sum('total_remuneracion'), total_descuento: sum('total_descuento'),
        neto: sum('neto'), deposito: sum('deposito'), descuento: sum('descuento'), total_aportes: sum('total_aportes') } };
  }

  r.get('/semana', ah(async (req, res) => {
    const obra_id = Number(req.query.obra_id);
    let sem;
    try { sem = await semanaCerrada(obra_id, req.query.fecha); } catch (e) {
      // Una semana importada desde Excel no tiene asistencia en CPAD: se muestra lo registrado
      const reg = e.status === 409 && Number.isInteger(obra_id) ? await registro(obra_id, lunesDe(req.query.fecha)) : null;
      if (!reg) throw e;
      const { p } = await vigentes(reg.semana_inicio);
      return res.json(vistaRegistro(reg, null, Number(p.pct_snp)));
    }
    res.json(await vistaSemana(sem));
  }));

  // Cálculo con valores indicados en la petición (compatibilidad con la versión 0.5)
  r.post('/calculo', ah(async (req, res) => {
    const b = req.body || {};
    const sem = await semanaCerrada(Number(b.obra_id), b.fecha);
    const out = await calcularSemana(sem, b);
    if (out.errores.length) return res.status(400).json({ error: 'No se puede calcular la planilla', errores: out.errores });
    delete out.errores;
    res.json(out);
  }));

  // HU09: registra las horas extras pagadas (las de la semana siguiente) y el descuento (DSCTO) de un trabajador
  r.put('/ajustes', ah(async (req, res) => {
    const b = req.body || {};
    const sem = await semanaCerrada(Number(b.obra_id), b.fecha);
    if (await registro(sem.obra.id, sem.semana.inicio)) throw new HttpError(409, 'La planilla de esa semana ya está registrada; anule el registro para corregirla');
    const tid = Number(b.trabajador_id);
    if (!sem.filas.some((f) => f.trabajador_id === tid)) throw new HttpError(404, 'El trabajador no pertenece a la planilla de esa semana');
    const errores = [];
    const h = b.horas_extras == null || b.horas_extras === '' ? 0 : Number(b.horas_extras);
    const dv = b.descuento ?? b.adelanto; // «adelanto» se acepta por compatibilidad con la versión 0.8.0
    const ad = dv == null || dv === '' ? 0 : Number(dv);
    if (!(h >= 0 && h <= 60) || Math.round(h * 100) !== h * 100) errores.push('horas_extras debe estar entre 0 y 60');
    if (!(ad >= 0 && ad < 100000) || Math.abs(Math.round(ad * 100) - ad * 100) > 1e-6) errores.push('descuento debe ser un monto de 0 o más, con dos decimales como máximo');
    const nota = b.nota == null ? null : String(b.nota).trim().slice(0, 120) || null;
    if (errores.length) throw new HttpError(400, 'Datos inválidos', errores);
    await pool.query(`INSERT INTO ajuste_planilla (obra_id, semana_inicio, trabajador_id, horas_extras, descuento, nota)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (obra_id, semana_inicio, trabajador_id) DO UPDATE SET horas_extras = EXCLUDED.horas_extras,
        descuento = EXCLUDED.descuento, nota = EXCLUDED.nota, actualizado_en = now()`, [sem.obra.id, sem.semana.inicio, tid, h, ad, nota]);
    res.json(await vistaSemana(sem));
  }));
  const dia = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  const sabadoDe = (inicio) => new Date(Date.parse(inicio + 'T12:00:00Z') + 5 * 864e5).toISOString().slice(0, 10);

  /** Completa las boletas con los datos del trabajador que imprime la boleta (HU10). */
  async function conDatosBoleta(boletas) {
    const { rows: extra } = await pool.query(`SELECT t.id, t.fecha_ingreso, t.fecha_nacimiento, t.banco, t.cuenta_bancaria, t.afiliacion, t.cuspp, e.nombre AS especialidad
      FROM trabajador t JOIN especialidad e ON e.id = t.especialidad_id WHERE t.id = ANY($1)`, [boletas.map((b) => b.trabajador_id)]);
    const ex = new Map(extra.map((x) => [x.id, x]));
    return boletas.map((b) => { const { id, ...x } = ex.get(b.trabajador_id) || {}; return { ...b, ...x, fecha_ingreso: dia(x.fecha_ingreso), fecha_nacimiento: dia(x.fecha_nacimiento) }; });
  }

  async function empleador() {
    const { rows: [empresa] } = await pool.query('SELECT razon_social, ruc, direccion, representante, cargo_representante FROM empresa WHERE id = 1');
    if (!empresa) throw new HttpError(409, 'Faltan los datos del empleador');
    return empresa;
  }

  /** Planilla registrada de una semana (HU12), o null si aún no se registró. */
  async function registro(obra_id, inicio) {
    const { rows: [reg] } = await pool.query('SELECT * FROM planilla_registro WHERE obra_id = $1 AND semana_inicio = $2', [obra_id, inicio]);
    if (!reg) return null;
    const { rows } = await pool.query(`SELECT b.datos FROM boleta_emitida b WHERE b.obra_id = $1 AND b.semana_inicio = $2
      ORDER BY b.datos->>'apellidos', b.datos->>'nombres'`, [obra_id, inicio]);
    return { ...reg, semana_inicio: dia(reg.semana_inicio), boletas: rows.map((x) => x.datos) };
  }

  const lunesDe = (fecha) => {
    if (!FECHA.test(String(fecha || ''))) throw new HttpError(400, 'fecha debe tener el formato AAAA-MM-DD');
    const d = new Date(fecha + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  // HU10 · HU12: boletas en PDF (A4 horizontal), de toda la semana o de un trabajador.
  // Si la planilla está registrada se emiten las boletas guardadas; si no, se calculan sobre la semana cerrada.
  r.get('/boletas.pdf', ah(async (req, res) => {
    const obra_id = Number(req.query.obra_id);
    if (!Number.isInteger(obra_id) || obra_id <= 0) throw new HttpError(400, 'obra_id es obligatorio');
    const reg = await registro(obra_id, lunesDe(req.query.fecha));
    let boletas; let errores = []; let ctx;
    if (reg) {
      boletas = reg.boletas;
      ctx = { empresa: reg.empresa, obra: reg.obra, numero: reg.numero_semana, inicio: reg.semana_inicio };
    } else {
      const sem = await semanaCerrada(obra_id, req.query.fecha);
      const out = await calcularSemana(sem);
      boletas = out.boletas; errores = out.errores;
      ctx = { empresa: null, obra: sem.obra, numero: numeroSemana(sem.semana.inicio, dia(sem.obra.semana_base)), inicio: sem.semana.inicio };
    }
    if (req.query.trabajador_id) {
      const tid = Number(req.query.trabajador_id);
      boletas = boletas.filter((b) => b.trabajador_id === tid);
      if (!boletas.length) {
        const e = errores.find((x) => x.trabajador_id === tid);
        throw new HttpError(e ? 409 : 404, e ? `No se puede emitir la boleta: ${e.errores.join('; ')}` : 'El trabajador no tiene boleta en esa semana');
      }
    }
    if (!boletas.length) throw new HttpError(409, 'No hay boletas que emitir en esa semana');
    if (!reg) { ctx.empresa = await empleador(); boletas = await conDatosBoleta(boletas); }
    const inicio = ctx.inicio;
    res.setHeader('Content-Type', 'application/pdf');
    const nombre = boletas.length === 1 ? `boleta_${inicio}_${boletas[0].dni}.pdf` : `boletas_${ctx.obra.codigo}_${inicio}.pdf`;
    res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="${nombre}"`);
    generarBoletas(res, boletas, { empresa: ctx.empresa, obra: ctx.obra, semana: { inicio, sabado: sabadoDe(inicio) }, numero: ctx.numero });
  }));

  // HU12 · Registra la planilla de una semana cerrada: guarda cada boleta tal como se emite
  r.post('/registro', ah(async (req, res) => {
    const b = req.body || {};
    const sem = await semanaCerrada(Number(b.obra_id), b.fecha);
    if (await registro(sem.obra.id, sem.semana.inicio)) throw new HttpError(409, 'La planilla de esa semana ya está registrada');
    const out = await calcularSemana(sem);
    if (out.errores.length) return res.status(409).json({ error: 'No se puede registrar: hay trabajadores sin calcular', errores: out.errores });
    if (!out.boletas.length) throw new HttpError(409, 'La semana no tiene boletas que registrar');
    const empresa = await empleador();
    const boletas = await conDatosBoleta(out.boletas);
    const o = sem.obra;
    const obra = { id: o.id, codigo: o.codigo, nombre: o.nombre, centro_costo: o.centro_costo || null };
    const numero = numeroSemana(sem.semana.inicio, dia(o.semana_base));
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query('INSERT INTO planilla_registro (obra_id, semana_inicio, numero_semana, origen, empresa, obra, registrado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [o.id, sem.semana.inicio, numero, 'CPAD', empresa, obra, req.usuario?.usuario || null]);
      for (const x of boletas) {
        await cx.query('INSERT INTO boleta_emitida (obra_id, semana_inicio, trabajador_id, deposito, datos) VALUES ($1,$2,$3,$4,$5)',
          [o.id, sem.semana.inicio, x.trabajador_id, x.deposito, x]);
      }
      await cx.query('COMMIT');
    } catch (e) { await cx.query('ROLLBACK'); throw e; } finally { cx.release(); }
    res.status(201).json(await vistaSemana(sem));
  }));

  // Anula el registro para corregir la semana (las boletas guardadas se eliminan)
  r.delete('/registro', ah(async (req, res) => {
    const obra_id = Number(req.query.obra_id);
    const { rowCount } = await pool.query('DELETE FROM planilla_registro WHERE obra_id = $1 AND semana_inicio = $2', [obra_id, lunesDe(req.query.fecha)]);
    if (!rowCount) throw new HttpError(404, 'La planilla de esa semana no está registrada');
    res.json({ anulado: true });
  }));

  // HU12 · Historial de planillas registradas de una obra
  r.get('/historial', ah(async (req, res) => {
    const obra_id = Number(req.query.obra_id);
    if (!Number.isInteger(obra_id) || obra_id <= 0) throw new HttpError(400, 'obra_id es obligatorio');
    const { rows } = await pool.query(`SELECT r.semana_inicio, r.numero_semana, r.origen, r.registrado_en, r.registrado_por,
        COUNT(b.*)::int AS trabajadores, COALESCE(SUM(b.deposito), 0)::float AS total_deposito
      FROM planilla_registro r LEFT JOIN boleta_emitida b ON b.obra_id = r.obra_id AND b.semana_inicio = r.semana_inicio
      WHERE r.obra_id = $1 GROUP BY r.obra_id, r.semana_inicio ORDER BY r.semana_inicio DESC`, [obra_id]);
    res.json(rows.map((x) => ({ ...x, semana_inicio: dia(x.semana_inicio), semana_fin: sabadoDe(dia(x.semana_inicio)) })));
  }));

  // HU12 · Boletas de un trabajador en todas las semanas registradas (por id o DNI)
  r.get('/historial/trabajador', ah(async (req, res) => {
    const dni = String(req.query.dni || '').trim();
    const where = req.query.trabajador_id ? 't.id = $1' : 't.dni = $1';
    const v = req.query.trabajador_id ? Number(req.query.trabajador_id) : dni;
    if (!req.query.trabajador_id && !/^\d{8}$/.test(dni)) throw new HttpError(400, 'Indique el DNI (8 dígitos) o trabajador_id');
    const { rows: [t] } = await pool.query(`SELECT t.id, t.dni, t.apellidos, t.nombres FROM trabajador t WHERE ${where}`, [v]);
    if (!t) throw new HttpError(404, 'No existe un trabajador con ese DNI');
    const { rows } = await pool.query(`SELECT b.obra_id, r.obra->>'codigo' AS obra, b.semana_inicio, r.numero_semana, r.origen,
        b.deposito::float AS deposito, (b.datos->>'dias')::int AS dias, (b.datos->>'horas_extras_pagadas')::float AS horas_extras,
        b.datos->>'categoria_pago' AS categoria, (b.datos->>'total_remuneracion')::float AS total_remuneracion
      FROM boleta_emitida b JOIN planilla_registro r ON r.obra_id = b.obra_id AND r.semana_inicio = b.semana_inicio
      WHERE b.trabajador_id = $1 ORDER BY b.semana_inicio DESC`, [t.id]);
    res.json({ trabajador: t, boletas: rows.map((x) => ({ ...x, semana_inicio: dia(x.semana_inicio), semana_fin: sabadoDe(dia(x.semana_inicio)) })) });
  }));
  // HU13 · Costo de mano de obra por obra: lo pagado en las planillas registradas, por semana y por categoría
  r.get('/costos', ah(async (req, res) => {
    const desde = req.query.desde || '1900-01-01'; const hasta = req.query.hasta || '2999-12-31';
    const valida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f + 'T12:00:00Z')) && new Date(f + 'T12:00:00Z').toISOString().slice(0, 10) === f;
    for (const f of [desde, hasta]) if (!valida(f)) throw new HttpError(400, 'desde y hasta deben tener el formato AAAA-MM-DD');
    const { rows } = await pool.query(`SELECT r.obra_id, r.obra->>'codigo' AS codigo, r.obra->>'nombre' AS nombre, r.obra->>'centro_costo' AS centro_costo,
        r.semana_inicio, r.numero_semana, COALESCE(b.datos->>'categoria_pago', b.datos->>'categoria') AS categoria,
        COUNT(*)::int AS boletas, SUM(b.deposito)::float AS deposito,
        SUM(COALESCE((b.datos->>'pago_semana')::numeric, b.deposito))::float AS pago,
        SUM(COALESCE((b.datos->>'horas_extras_pagadas')::numeric, 0))::float AS horas_extras,
        SUM(COALESCE((b.datos->>'dias')::numeric, 0))::int AS dias
      FROM planilla_registro r JOIN boleta_emitida b ON b.obra_id = r.obra_id AND b.semana_inicio = r.semana_inicio
      WHERE r.semana_inicio BETWEEN $1 AND $2
      GROUP BY r.obra_id, r.obra, r.semana_inicio, r.numero_semana, 7 ORDER BY r.obra->>'codigo', r.semana_inicio`, [desde, hasta]);
    const obras = new Map();
    for (const x of rows) {
      const k = x.obra_id;
      if (!obras.has(k)) obras.set(k, { obra_id: k, codigo: x.codigo, nombre: x.nombre, centro_costo: x.centro_costo, total_pago: 0, total_deposito: 0, jornales: 0, horas_extras: 0, semanas: new Map(), categorias: new Map() });
      const o = obras.get(k); const ini = dia(x.semana_inicio);
      o.total_pago += x.pago; o.total_deposito += x.deposito; o.jornales += x.dias; o.horas_extras += x.horas_extras;
      const s = o.semanas.get(ini) || { semana_inicio: ini, semana_fin: sabadoDe(ini), numero_semana: x.numero_semana, trabajadores: 0, pago: 0, deposito: 0 };
      s.trabajadores += x.boletas; s.pago += x.pago; s.deposito += x.deposito; o.semanas.set(ini, s);
      const cat = x.categoria || 'SIN CATEGORÍA';
      const c = o.categorias.get(cat) || { categoria: cat, pago: 0, jornales: 0 };
      c.pago += x.pago; c.jornales += x.dias; o.categorias.set(cat, c);
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    res.json([...obras.values()].map((o) => ({
      ...o, total_pago: r2(o.total_pago), total_deposito: r2(o.total_deposito), horas_extras: r2(o.horas_extras),
      costo_jornal: o.jornales ? r2(o.total_pago / o.jornales) : null,
      semanas: [...o.semanas.values()].map((s) => ({ ...s, pago: r2(s.pago), deposito: r2(s.deposito) })),
      categorias: [...o.categorias.values()].map((c) => ({ ...c, pago: r2(c.pago) })).sort((a, b) => b.pago - a.pago),
    })));
  }));
  r.vigentes = vigentes; r.empleador = empleador;
  return r;
};
module.exports.calcularBoleta = calcularBoleta;
module.exports.calcularDeposito = calcularDeposito;
module.exports.numeroSemana = numeroSemana;
