'use strict';
// Sprint 3 · HU07: motor de cálculo de la planilla semanal del obrero de construcción civil.
// Todo se calcula en céntimos enteros con redondeo al céntimo más cercano (mitad hacia arriba),
// para que el resultado coincida exactamente con las boletas emitidas.
const express = require('express');

const c = (soles) => Math.round(Number(soles) * 100);          // soles -> céntimos
const s = (cent) => Math.round(cent) / 100;                    // céntimos -> soles
const pct = (baseCent, p) => Math.round((baseCent * Number(p)) / 100);

/**
 * Calcula la boleta semanal de un trabajador.
 * t: { jornal, pct_buc, valor_hora_extra, dias, horas_extras, depositado? }
 * p: parámetros vigentes (movilidad, gratificación, porcentajes)
 * Si se indica el monto depositado, el dominical es el ajuste que hace que el neto coincida con él;
 * si el resto de conceptos ya lo supera, el dominical queda en cero y la diferencia se registra como adelanto.
 */
/**
 * Depósito de la semana según lo que la empresa paga en la práctica:
 * sueldo semanal × días ÷ 6 + horas extras × tarifa, redondeado al sol hacia arriba, menos el adelanto entregado.
 * Reproduce los 11 depósitos de la semana 30 de 2026.
 */
function calcularDeposito({ sueldo_semanal, dias, horas_extras = 0, tarifa_hora_extra = 0, adelanto = 0 }) {
  const bruto = Math.round((c(sueldo_semanal) * Number(dias)) / 6 + Number(horas_extras) * c(tarifa_hora_extra || 0));
  const pago = Math.ceil(bruto / 100) * 100;              // al sol, siempre hacia arriba
  const ade = c(adelanto || 0);
  return { pago_semana: s(pago), adelanto_entregado: s(ade), deposito: s(pago - ade) };
}

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
   * Calcula la planilla de una semana cerrada. Las horas extras y los adelantos salen de lo registrado por el
   * administrador (ajuste_planilla); el cuerpo de la petición puede reemplazarlos. El depósito se calcula con el
   * sueldo semanal de la categoría de pago, salvo que se indique explícitamente.
   */
  async function calcularSemana(sem, o = {}) {
    const { p, jornales, pagos } = await vigentes(sem.semana.inicio);
    const { rows: aj } = await pool.query('SELECT trabajador_id, horas_extras, adelanto, nota FROM ajuste_planilla WHERE obra_id = $1 AND semana_inicio = $2', [sem.obra.id, sem.semana.inicio]);
    const ajuste = new Map(aj.map((x) => [x.trabajador_id, x]));
    const he = o.horas_extras || {}; const dep = o.depositado || {}; const ade = o.adelantos || {};
    const { rows: cats } = await pool.query('SELECT id, categoria_id, categoria_pago_id FROM trabajador WHERE id = ANY($1)', [sem.filas.map((f) => f.trabajador_id)]);
    const catDe = new Map(cats.map((x) => [x.id, x.categoria_pago_id || x.categoria_id]));
    const errores = []; const boletas = [];
    for (const f of sem.filas) {
      if (!f.dias_asistidos) continue; // sin días laborados no hay boleta
      const e = [];
      const cat = catDe.get(f.trabajador_id);
      const j = jornales.get(cat); const g = pagos.get(cat); const a = ajuste.get(f.trabajador_id);
      if (!j) e.push('su categoría de pago no tiene jornal de tabla vigente');
      const h = Number(he[f.trabajador_id] ?? a?.horas_extras ?? 0);
      if (!(h >= 0) || h > 60) e.push('horas extras inválidas');
      const ad = Number(ade[f.trabajador_id] ?? a?.adelanto ?? 0);
      if (!(ad >= 0)) e.push('adelanto inválido');
      let v = dep[f.trabajador_id]; let d = null;
      if (v != null && v !== '') { if (!(Number(v) > 0)) e.push('monto depositado inválido'); }
      else if (!g) e.push('su categoría de pago no tiene sueldo semanal vigente');
      else if (h > 0 && g.tarifa_hora_extra == null) e.push('falta definir la tarifa de la hora extra de su categoría');
      else {
        d = calcularDeposito({ sueldo_semanal: g.sueldo_semanal, dias: f.dias_asistidos, horas_extras: h, tarifa_hora_extra: g.tarifa_hora_extra, adelanto: ad });
        if (d.deposito <= 0) e.push('el adelanto iguala o supera el pago de la semana');
        v = d.deposito;
      }
      if (e.length) { errores.push({ trabajador_id: f.trabajador_id, trabajador: `${f.apellidos}, ${f.nombres}`, categoria_pago: j?.categoria || g?.categoria || null, errores: e }); continue; }
      const horas_normales = f.dias.slice(0, 6).reduce((acc, x, i) => acc + (x.estado === 'A' ? (i === 5 ? 5.5 : 8.5) : 0), 0);
      boletas.push({
        trabajador_id: f.trabajador_id, dni: f.dni, apellidos: f.apellidos, nombres: f.nombres,
        categoria_tareo: f.categoria, categoria_pago: j.categoria, jornal: Number(j.jornal),
        sueldo_semanal: g ? Number(g.sueldo_semanal) : null, tarifa_hora_extra: g?.tarifa_hora_extra != null ? Number(g.tarifa_hora_extra) : null,
        horas_normales, sobretiempo_tareo: f.sobretiempo_h, nota: a?.nota || null,
        pago_semana: d ? d.pago_semana : null, adelanto_entregado: d ? d.adelanto_entregado : ad, deposito: Number(v),
        ...calcularBoleta({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: f.dias_asistidos, horas_extras: h, depositado: v }, p),
      });
    }
    const sum = (k) => Math.round(boletas.reduce((acc, x) => acc + x[k] * 100, 0)) / 100;
    return { obra: sem.obra, semana: sem.semana, cierre: sem.cierre, parametros: { pct_snp: Number(p.pct_snp) }, boletas, errores,
      totales: { trabajadores: boletas.length, total_remuneracion: sum('total_remuneracion'), total_descuento: sum('total_descuento'),
        neto: sum('neto'), deposito: sum('deposito'), adelanto_entregado: sum('adelanto_entregado'), total_aportes: sum('total_aportes') } };
  }

  // Vista de la planilla para la pantalla: siempre responde, e informa qué trabajadores no se pudieron calcular
  r.get('/semana', ah(async (req, res) => {
    const sem = await semanaCerrada(Number(req.query.obra_id), req.query.fecha);
    res.json(await calcularSemana(sem));
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

  // HU09: registra las horas extras y el adelanto de un trabajador en la semana
  r.put('/ajustes', ah(async (req, res) => {
    const b = req.body || {};
    const sem = await semanaCerrada(Number(b.obra_id), b.fecha);
    const tid = Number(b.trabajador_id);
    if (!sem.filas.some((f) => f.trabajador_id === tid)) throw new HttpError(404, 'El trabajador no pertenece a la planilla de esa semana');
    const errores = [];
    const h = b.horas_extras == null || b.horas_extras === '' ? 0 : Number(b.horas_extras);
    const ad = b.adelanto == null || b.adelanto === '' ? 0 : Number(b.adelanto);
    if (!(h >= 0 && h <= 60) || Math.round(h * 100) !== h * 100) errores.push('horas_extras debe estar entre 0 y 60');
    if (!(ad >= 0 && ad < 100000) || Math.abs(Math.round(ad * 100) - ad * 100) > 1e-6) errores.push('adelanto debe ser un monto de 0 o más, con dos decimales como máximo');
    const nota = b.nota == null ? null : String(b.nota).trim().slice(0, 120) || null;
    if (errores.length) throw new HttpError(400, 'Datos inválidos', errores);
    await pool.query(`INSERT INTO ajuste_planilla (obra_id, semana_inicio, trabajador_id, horas_extras, adelanto, nota)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (obra_id, semana_inicio, trabajador_id) DO UPDATE SET horas_extras = EXCLUDED.horas_extras,
        adelanto = EXCLUDED.adelanto, nota = EXCLUDED.nota, actualizado_en = now()`, [sem.obra.id, sem.semana.inicio, tid, h, ad, nota]);
    res.json(await calcularSemana(sem));
  }));
  return r;
};
module.exports.calcularBoleta = calcularBoleta;
module.exports.calcularDeposito = calcularDeposito;
