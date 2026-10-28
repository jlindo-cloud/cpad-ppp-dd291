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

  async function vigentes(fecha) {
    const { rows: [p] } = await pool.query('SELECT * FROM parametro_planilla WHERE vigente_desde <= $1 ORDER BY vigente_desde DESC LIMIT 1', [fecha]);
    if (!p) throw new HttpError(400, 'No hay parámetros de planilla vigentes para esa fecha');
    const { rows: js } = await pool.query(`
      SELECT DISTINCT ON (j.categoria_id) j.categoria_id, c.nombre AS categoria, j.jornal, j.pct_buc, j.valor_hora_extra, j.vigente_desde
        FROM jornal_categoria j JOIN categoria c ON c.id = j.categoria_id
       WHERE j.vigente_desde <= $1 ORDER BY j.categoria_id, j.vigente_desde DESC`, [fecha]);
    return { p, jornales: new Map(js.map((j) => [j.categoria_id, j])), lista: js };
  }

  r.get('/parametros', ah(async (req, res) => {
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? req.query.fecha : new Date().toISOString().slice(0, 10);
    const { p, lista } = await vigentes(fecha);
    res.json({ parametros: p, jornales: lista });
  }));

  // Cálculo de la planilla de una semana cerrada: días del tareo, horas extras que define el administrador y depósito
  r.post('/calculo', ah(async (req, res) => {
    const b = req.body || {};
    const obra_id = Number(b.obra_id);
    if (!Number.isInteger(obra_id) || obra_id <= 0) throw new HttpError(400, 'obra_id es obligatorio');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha || ''))) throw new HttpError(400, 'fecha debe tener el formato AAAA-MM-DD');
    const obra = await obraActiva(obra_id);
    const sem = await resumenSemana(obra, b.fecha);
    if (!sem.cierre) throw new HttpError(409, 'La planilla solo se calcula sobre una semana cerrada');
    const { p, jornales } = await vigentes(sem.semana.inicio);
    const he = b.horas_extras || {}; const dep = b.depositado || {};
    const { rows: cats } = await pool.query('SELECT id, categoria_id, categoria_pago_id FROM trabajador WHERE id = ANY($1)', [sem.filas.map((f) => f.trabajador_id)]);
    const catDe = new Map(cats.map((x) => [x.id, x.categoria_pago_id || x.categoria_id]));
    const errores = []; const boletas = [];
    for (const f of sem.filas) {
      if (!f.dias_asistidos) continue; // sin días laborados no hay boleta
      const e = [];
      const j = jornales.get(catDe.get(f.trabajador_id));
      if (!j) e.push('su categoría de pago no tiene jornal vigente');
      const h = he[f.trabajador_id] ?? 0;
      if (!(Number(h) >= 0) || Number(h) > 60) e.push('horas extras inválidas');
      const v = dep[f.trabajador_id];
      if (v != null && v !== '' && !(Number(v) > 0)) e.push('monto depositado inválido');
      if (e.length) { errores.push({ trabajador_id: f.trabajador_id, trabajador: `${f.apellidos}, ${f.nombres}`, errores: e }); continue; }
      const horas_normales = f.dias.slice(0, 6).reduce((acc, d, i) => acc + (d.estado === 'A' ? (i === 5 ? 5.5 : 8.5) : 0), 0);
      boletas.push({
        trabajador_id: f.trabajador_id, dni: f.dni, apellidos: f.apellidos, nombres: f.nombres,
        categoria_tareo: f.categoria, categoria_pago: j.categoria, jornal: Number(j.jornal),
        horas_normales, sobretiempo_tareo: f.sobretiempo_h,
        ...calcularBoleta({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: f.dias_asistidos, horas_extras: h, depositado: v }, p),
      });
    }
    if (errores.length) return res.status(400).json({ error: 'No se puede calcular la planilla', errores });
    const sum = (k) => Math.round(boletas.reduce((a, x) => a + x[k] * 100, 0)) / 100;
    res.json({ obra: sem.obra, semana: sem.semana, boletas,
      totales: { trabajadores: boletas.length, total_remuneracion: sum('total_remuneracion'), total_descuento: sum('total_descuento'), neto: sum('neto'), total_aportes: sum('total_aportes') } });
  }));
  return r;
};
module.exports.calcularBoleta = calcularBoleta;
