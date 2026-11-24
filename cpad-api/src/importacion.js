'use strict';
// HU11 · Importación desde la planilla semanal en Excel de la empresa (un archivo por semana).
// /padron carga los datos personales y bancarios; /planilla además registra lo pagado esa semana en el historial.
// Sin «confirmar» devuelve la vista previa; con «confirmar=1» aplica todo en una sola transacción.
// El archivo se vuelve a leer al confirmar: no se confía en filas editadas por el cliente.
const express = require('express');
const { leerPlanilla, separarNombre, fecha, cuenta, texto, norm, valor } = require('./excel');
const { calcularBoleta, numeroSemana } = require('./planilla');

const CATEGORIA = { peon: 'AYUDANTE', ayudante: 'AYUDANTE' };
const CAMPOS = ['fecha_nacimiento', 'fecha_ingreso', 'banco', 'cuenta_bancaria', 'cci'];

module.exports = function importacionRouter(pool, { HttpError, ah, planillas }) {
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
      // Lo pagado: días de la semana, horas extras de la semana siguiente, DSCTO y total depositado
      const num = (k) => { const x = valor(get(k)); return x == null || x === '' ? null : Number(x); };
      const pago = { dias: num('dias'), horas_extras: num('horas') ?? 0, sueldo: num('sueldo'), monto_horas: num('monto_horas') ?? 0, descuento: num('dscto') ?? 0, total_pago: num('total_pago') };
      const errPago = [];
      if (!Number.isInteger(pago.dias) || pago.dias < 0 || pago.dias > 6) errPago.push('días asistidos inválidos');
      for (const k of ['horas_extras', 'monto_horas', 'descuento']) if (!(pago[k] >= 0)) errPago.push(`${k.replace('_', ' ')} inválido`);
      if (!(pago.sueldo >= 0) || !(pago.total_pago >= 0)) errPago.push('falta el sueldo o el total pagado');
      else if (Math.round((pago.sueldo + pago.monto_horas - pago.descuento) * 100) !== Math.round(pago.total_pago * 100)) {
        errPago.push(`SUELDO + TOT HOR − DSCTO (${pago.sueldo + pago.monto_horas - pago.descuento}) no coincide con TOTAL PAGO (${pago.total_pago})`);
      }
      return { fila, dni, nombre_completo: completo, apellidos, nombres, categoria: cat?.nombre || catTxt || null, categoria_id: cat?.id || null,
        ...d, banco, cuenta_bancaria: cta.v, cci: cci.v, errores, avisos, pago, errores_pago: errPago };
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

  const confirmado = (q) => ['1', 'true', 'si'].includes(String(q.confirmar || '').toLowerCase());

  /** Obra y especialidad para los trabajadores nuevos. */
  async function destino(v, q) {
    const obra_id = Number(q.obra_id); const esp = Number(q.especialidad_id);
    if (v.filas.some((f) => f.estado === 'nuevo')) {
      const { rows: o } = Number.isInteger(obra_id) && obra_id > 0 ? await pool.query('SELECT 1 FROM obra WHERE id = $1 AND activo', [obra_id]) : { rows: [] };
      if (!o.length) throw new HttpError(400, 'Indique la obra activa a la que se asignan los trabajadores nuevos');
      const { rows: e } = Number.isInteger(esp) && esp > 0 ? await pool.query('SELECT 1 FROM especialidad WHERE id = $1 AND activo', [esp]) : { rows: [] };
      if (!e.length) throw new HttpError(400, 'Indique la especialidad de los trabajadores nuevos');
    }
    return { obra_id, esp };
  }

  /** Registra los nuevos y actualiza los existentes dentro de la transacción. Devuelve el id de cada DNI. */
  async function aplicarPadron(cx, v, { obra_id, esp }) {
    const ids = new Map(v.filas.filter((f) => f.trabajador_id).map((f) => [f.dni, f.trabajador_id]));
    for (const f of v.filas.filter((x) => x.estado === 'nuevo')) {
      const { rows: [n] } = await cx.query(`INSERT INTO trabajador (dni, apellidos, nombres, categoria_id, especialidad_id, obra_id, fecha_ingreso, fecha_nacimiento, banco, cuenta_bancaria, cci)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [f.dni, f.apellidos, f.nombres, f.categoria_id, esp, obra_id, f.fecha_ingreso, f.fecha_nacimiento, f.banco, f.cuenta_bancaria, f.cci]);
      ids.set(f.dni, n.id);
    }
    for (const f of v.filas.filter((x) => x.estado === 'actualiza')) {
      const sets = f.cambios.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await cx.query(`UPDATE trabajador SET ${sets} WHERE id = $1`, [f.trabajador_id, ...f.cambios.map((k) => f[k])]);
    }
    return ids;
  }

  async function transaccion(fn) {
    const cx = await pool.connect();
    try { await cx.query('BEGIN'); const out = await fn(cx); await cx.query('COMMIT'); return out; }
    catch (e) { await cx.query('ROLLBACK'); throw e; } finally { cx.release(); }
  }

  r.post('/padron', crudo, ah(async (req, res) => {
    const v = await analizar(req.body);
    for (const f of v.filas) { delete f.pago; delete f.errores_pago; }
    if (!confirmado(req.query)) return res.json(v);
    if (v.resumen.errores) return res.status(400).json({ error: 'El archivo tiene filas con errores; no se registró ninguna', ...v });
    const dst = await destino(v, req.query);
    await transaccion((cx) => aplicarPadron(cx, v, dst));
    res.status(201).json({ registrados: v.resumen.nuevos, actualizados: v.resumen.actualiza, sin_cambios: v.resumen.sin_cambios, filas: v.filas.length });
  }));

  const sumar = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  /** Vista previa de la semana pagada: ubica la semana por su número en la obra y valida lo pagado. */
  async function analizarPlanilla(buffer, obra_id) {
    const v = await analizar(buffer);
    const errores = [];
    const { rows: [o] } = Number.isInteger(obra_id) && obra_id > 0
      ? await pool.query('SELECT id, codigo, nombre, centro_costo, semana_base FROM obra WHERE id = $1 AND activo', [obra_id]) : { rows: [] };
    if (!o) throw new HttpError(400, 'Indique la obra de la planilla');
    const base = o.semana_base instanceof Date ? o.semana_base.toISOString().slice(0, 10) : o.semana_base;
    let inicio = null;
    if (!v.semana) errores.push('El título de la hoja no indica la semana, por ejemplo «(SEMANA 30) 28/09 AL 03/10»');
    else if (!base) errores.push(`La obra ${o.codigo} no tiene definida la semana desde la que se numeran sus semanas`);
    else {
      inicio = sumar(base, (v.semana.numero - 1) * 7);
      if (ddmm(inicio) !== v.semana.desde) errores.push(`El título dice semana ${v.semana.numero} del ${v.semana.desde}, pero en la obra la semana ${v.semana.numero} empieza el ${ddmm(inicio)}`);
    }
    let registrada = false;
    if (inicio) {
      const { rows } = await pool.query('SELECT 1 FROM planilla_registro WHERE obra_id = $1 AND semana_inicio = $2', [o.id, inicio]);
      registrada = rows.length > 0;
      if (registrada) errores.push(`La planilla de la semana ${v.semana.numero} ya está registrada en el historial`);
    }
    for (const f of v.filas) if (f.errores_pago.length && f.estado !== 'error') { f.estado = 'error'; f.errores.push(...f.errores_pago); }
    for (const f of v.filas) if (f.estado === 'error') f.errores = [...new Set([...f.errores, ...f.errores_pago])];
    const cuenta_ = (e) => v.filas.filter((f) => f.estado === e).length;
    v.resumen = { ...v.resumen, nuevos: cuenta_('nuevo'), actualiza: cuenta_('actualiza'), sin_cambios: cuenta_('sin_cambios'), errores: cuenta_('error') };
    const pagados = v.filas.filter((f) => f.pago.total_pago > 0);
    const tot = (k) => Math.round(pagados.reduce((a, f) => a + (f.pago[k] || 0) * 100, 0)) / 100;
    v.planilla = { obra: { id: o.id, codigo: o.codigo, nombre: o.nombre, centro_costo: o.centro_costo || null }, numero: v.semana?.numero ?? null,
      inicio, fin: inicio && sumar(inicio, 5), pago: inicio && sumar(inicio, 12), registrada, errores,
      trabajadores: pagados.length, total_pago: tot('total_pago'), total_descuento: tot('descuento') };
    return v;
  }

  // HU11 · Registra en el historial lo pagado en una semana anterior, según la planilla en Excel de la empresa
  r.post('/planilla', crudo, ah(async (req, res) => {
    const v = await analizarPlanilla(req.body, Number(req.query.obra_id));
    if (!confirmado(req.query)) return res.json(v);
    if (v.planilla.errores.length || v.resumen.errores) {
      return res.status(v.planilla.registrada ? 409 : 400).json({ error: v.planilla.errores[0] || 'El archivo tiene filas con errores; no se registró nada', ...v });
    }
    const dst = await destino(v, { ...req.query, obra_id: v.planilla.obra.id });
    const pl = v.planilla;
    const empresa = await planillas.empleador();
    const { p, jornales, pagos } = await planillas.vigentes(pl.inicio);
    const sinTabla = v.filas.filter((f) => f.pago.total_pago > 0 && !jornales.get(f.categoria_id));
    if (sinTabla.length) throw new HttpError(409, `La categoría ${sinTabla[0].categoria} no tiene jornal de tabla vigente para desglosar la boleta`);
    const out = await transaccion(async (cx) => {
      const ids = await aplicarPadron(cx, v, dst);
      const { rows: tr } = await cx.query(`SELECT t.id, t.apellidos, t.nombres, t.fecha_ingreso, t.fecha_nacimiento, t.banco, t.cuenta_bancaria, t.afiliacion, t.cuspp,
          e.nombre AS especialidad FROM trabajador t JOIN especialidad e ON e.id = t.especialidad_id WHERE t.id = ANY($1)`, [[...ids.values()]]);
      const tPor = new Map(tr.map((x) => [x.id, x]));
      const d10 = (x) => (x instanceof Date ? x.toISOString().slice(0, 10) : x);
      await cx.query('INSERT INTO planilla_registro (obra_id, semana_inicio, numero_semana, origen, empresa, obra, registrado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [pl.obra.id, pl.inicio, pl.numero, 'EXCEL', empresa, pl.obra, req.usuario?.usuario || null]);
      let n = 0;
      for (const f of v.filas.filter((x) => x.pago.total_pago > 0)) {
        const id = ids.get(f.dni); const t = tPor.get(id); const j = jornales.get(f.categoria_id); const g = pagos.get(f.categoria_id);
        const pago_semana = Math.round((f.pago.sueldo + f.pago.monto_horas) * 100) / 100;
        const datos = {
          trabajador_id: id, dni: f.dni, apellidos: t.apellidos, nombres: t.nombres, categoria_tareo: f.categoria, categoria_pago: j.categoria,
          jornal: Number(j.jornal), sueldo_semanal: g ? Number(g.sueldo_semanal) : null, tarifa_hora_extra: g?.tarifa_hora_extra != null ? Number(g.tarifa_hora_extra) : null,
          horas_normales: null, sobretiempo_tareo: null, nota: 'Importada desde la planilla en Excel',
          pago_semana, descuento: f.pago.descuento, deposito: f.pago.total_pago,
          ...calcularBoleta({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: f.pago.dias, horas_extras: f.pago.horas_extras, depositado: pago_semana }, p),
          fecha_ingreso: d10(t.fecha_ingreso), fecha_nacimiento: d10(t.fecha_nacimiento), banco: t.banco, cuenta_bancaria: t.cuenta_bancaria,
          afiliacion: t.afiliacion, cuspp: t.cuspp, especialidad: t.especialidad,
        };
        await cx.query('INSERT INTO boleta_emitida (obra_id, semana_inicio, trabajador_id, deposito, datos) VALUES ($1,$2,$3,$4,$5)', [pl.obra.id, pl.inicio, id, datos.deposito, datos]);
        n++;
      }
      return n;
    });
    res.status(201).json({ semana: pl.numero, inicio: pl.inicio, boletas: out, total_pago: pl.total_pago,
      registrados: v.resumen.nuevos, actualizados: v.resumen.actualiza });
  }));

  return r;
};
