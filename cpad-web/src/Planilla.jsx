import { Fragment, useEffect, useState } from 'react';
import { api } from './api.js';
import Categoria from './Categoria.jsx';
import { Aviso, Campo, Encabezado, Icono, Rotulo, horas } from './ui.jsx';
import { fechaHora, hoyLima, lunesDe, rango, sumar } from './fechas.js';

const sol = (n) => (n == null ? '—' : Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Desglose de la boleta de un trabajador: ingresos, descuentos y aportes del empleador. */
function Desglose({ b, pctSnp }) {
  const bloque = (titulo, filas, total) => (
    <div className="min-w-56 flex-1">
      <div className="mb-1.5 text-[12px] font-medium text-tinta-2">{titulo}</div>
      <dl className="num text-[13px]">
        {filas.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-0.5"><dt className="text-tinta-2">{k}</dt><dd>{sol(v)}</dd></div>
        ))}
        <div className="mt-1 flex justify-between gap-4 border-t border-linea-2 pt-1 font-semibold"><dt>{total[0]}</dt><dd>{sol(total[1])}</dd></div>
      </dl>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-8 bg-fondo/60 px-6 py-4">
      {bloque('Ingresos', [['Jornal semanal', b.jornal_semanal], ['Dominical', b.dominical], ['Horas extras', b.horas_extras], ['BUC', b.buc],
        ['Movilidad', b.movilidad], ['Gratificación', b.gratificacion], ['Bonif. extraordinaria', b.bonif_extraordinaria], ['Vacaciones', b.vacaciones], ['CTS', b.cts]],
        ['Total remuneración', b.total_remuneracion])}
      {bloque('Descuentos', [[`ONP ${horas(pctSnp)} %`, b.snp], ['Adelantos (boleta)', b.adelantos]], ['Total descuentos', b.total_descuento])}
      {bloque('Aportes del empleador', [['EsSalud', b.essalud], ['SCTR salud', b.sctr], ['SCTR pensión', b.sctr_pension]], ['Total aportes', b.total_aportes])}
      <div className="min-w-56 flex-1 text-[13px]">
        <div className="mb-1.5 text-[12px] font-medium text-tinta-2">Cuadre con el pago</div>
        <p className="num">Sueldo semanal {sol(b.sueldo_semanal)} · {b.dias} {b.dias === 1 ? 'día' : 'días'}{b.horas_extras_pagadas ? ` · ${horas(b.horas_extras_pagadas)} h extra a ${sol(b.tarifa_hora_extra)}` : ''}</p>
        <p className="num mt-1">Pago de la semana {sol(b.pago_semana)}{b.adelanto_entregado ? ` − adelanto ${sol(b.adelanto_entregado)}` : ''} = <strong>{sol(b.deposito)}</strong></p>
        <p className="mt-1 text-tinta-2">Jornal de tabla {sol(b.jornal)} ({b.categoria_pago.toLowerCase()}). El neto de la boleta coincide con el depósito{b.cuadre === 'adelantos' ? '; el exceso se registra como adelanto en la boleta' : ''}.</p>
        {b.nota && <p className="mt-1 text-tinta-2">Nota: {b.nota}</p>}
      </div>
    </div>
  );
}

/** Celda editable: guarda al salir del campo o al pulsar Enter. */
function Editable({ valor, onGuardar, ancho = 'w-20', paso = '0.5', etiqueta }) {
  const [v, setV] = useState(valor ?? 0);
  useEffect(() => setV(valor ?? 0), [valor]);
  const guardar = () => { if (Number(v) !== Number(valor ?? 0)) onGuardar(v === '' ? 0 : Number(v)); };
  return (
    <input type="number" min="0" step={paso} value={v} aria-label={etiqueta}
      onChange={(e) => setV(e.target.value)} onBlur={guardar} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`campo-sm num ${ancho} text-right`} />
  );
}

export default function Planilla({ obras, obraId, setObraId, fecha, setFecha, ir }) {
  const [p, setP] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [abierta, setAbierta] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const inicio = lunesDe(fecha);
  const hoy = hoyLima();

  async function cargar() {
    if (!obraId) return;
    setAbierta(false);
    try { setP(await api.get(`/planillas/semana?obra_id=${obraId}&fecha=${inicio}`)); }
    catch (e) { setP(null); if (e.message.includes('semana cerrada')) setAbierta(true); else setAviso({ tono: 'error', texto: e.message }); }
  }
  useEffect(() => { setAviso(null); setAbierto(null); cargar(); }, [obraId, inicio]);

  async function guardar(trabajador_id, cambio) {
    const actual = p.boletas.find((x) => x.trabajador_id === trabajador_id);
    const base = { horas_extras: actual?.horas_extras_pagadas ?? 0, adelanto: actual?.adelanto_entregado ?? 0, nota: actual?.nota ?? null };
    try { setP(await api.put('/planillas/ajustes', { obra_id: Number(obraId), fecha: inicio, trabajador_id, ...base, ...cambio })); setAviso(null); }
    catch (e) { setAviso({ tono: 'error', texto: [e.message, ...(e.datos?.detalles || [])].join(' ') }); }
  }

  const t = p?.totales;
  return (
    <section>
      <Encabezado titulo="Planilla semanal" detalle="Calcula la planilla a partir de la asistencia cerrada: horas extras, adelantos, depósito y boleta de cada trabajador.">
        <Campo etiqueta="Obra">
          <select value={obraId} onChange={(e) => setObraId(e.target.value)} className="campo max-w-[20rem]">
            {obras.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Semana">
          <div className="flex items-center gap-1">
            <button type="button" className="btn-quieto h-9" aria-label="Semana anterior" onClick={() => setFecha(sumar(inicio, -7))}><Icono n="izq" /></button>
            <input type="date" value={inicio} onChange={(e) => e.target.value && setFecha(e.target.value)} className="campo num" aria-label="Ir a la semana de la fecha" />
            <button type="button" className="btn-quieto h-9" aria-label="Semana siguiente" disabled={sumar(inicio, 7) > hoy} onClick={() => setFecha(sumar(inicio, 7))}><Icono n="der" /></button>
          </div>
        </Campo>
      </Encabezado>

      {abierta && (
        <Aviso tono="pend" icono="abierto">
          La semana del {rango(inicio, sumar(inicio, 6))} aún no está cerrada. La planilla se calcula sobre la asistencia cerrada.{' '}
          <button className="font-medium underline" onClick={() => ir('semana', inicio)}>Ir al resumen semanal</button>
        </Aviso>
      )}

      {p && (
        <div className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          <Rotulo celdas={[
            { etiqueta: 'Obra', valor: p.obra.nombre, ancho: 'col-span-2 md:col-span-4' },
            { etiqueta: 'Semana', valor: `Del ${rango(p.semana.inicio, p.semana.fin)}`, ancho: 'col-span-2 md:col-span-4' },
            { etiqueta: 'Asistencia', ancho: 'col-span-2 md:col-span-4', valor: <span className="inline-flex items-center gap-1.5 text-ok"><Icono n="candado" className="size-3.5" />Cerrada el {fechaHora(p.cierre.cerrado_en)}</span> },
          ]} />
          <dl className="num grid grid-cols-2 border-b border-linea-2 md:grid-cols-5">
            {[['Trabajadores', t.trabajadores], ['Total remuneración', sol(t.total_remuneracion)], [`ONP y descuentos`, sol(t.total_descuento)],
              ['Adelantos entregados', sol(t.adelanto_entregado)], ['Depósito de la semana', sol(t.deposito)]].map(([k, v], i) => (
              <div key={k} className="border-linea px-4 py-3 [&:not(:first-child)]:border-l">
                <dt className="text-[11.5px] text-tinta-2">{k}</dt>
                <dd className={`titulo mt-0.5 text-[22px] leading-none ${i === 4 ? 'text-coez' : ''}`}>{i ? `S/ ${v}` : v}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[1150px]">
              <thead>
                <tr>
                  <th className="w-10 text-right">N.°</th><th>Trabajador</th><th className="text-right">Días</th>
                  <th className="text-right" title="Sobretiempo registrado en el tareo, como referencia">Sobret. tareo</th>
                  <th className="text-right">H. extra pagadas</th><th className="text-right">Pago semana</th><th className="text-right">Adelanto</th>
                  <th className="border-l border-linea text-right">Total rem.</th><th className="text-right">ONP {horas(p.parametros.pct_snp)} %</th>
                  <th className="text-right">Neto = depósito</th><th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {p.boletas.map((b, n) => (
                  <Fragment key={b.trabajador_id}>
                    <tr className={abierto === b.trabajador_id ? 'bg-fondo/60' : ''}>
                      <td className="num text-right text-tinta-2">{n + 1}</td>
                      <td className="min-w-56">
                        <div className="dato-personal font-medium leading-tight">{b.apellidos}, {b.nombres}</div>
                        <div className="flex items-center gap-1.5 text-[12px] text-tinta-2">
                          <Categoria nombre={b.categoria_tareo} />{b.categoria_pago !== b.categoria_tareo && <span>· cobra como {b.categoria_pago.toLowerCase()}</span>}
                        </div>
                      </td>
                      <td className="num text-right">{b.dias}</td>
                      <td className="num text-right text-tinta-2">{b.sobretiempo_tareo ? horas(b.sobretiempo_tareo) : '·'}</td>
                      <td className="text-right"><Editable valor={b.horas_extras_pagadas} etiqueta="Horas extras pagadas" ancho="w-16" onGuardar={(v) => guardar(b.trabajador_id, { horas_extras: v })} /></td>
                      <td className="num text-right">{sol(b.pago_semana)}</td>
                      <td className="text-right"><Editable valor={b.adelanto_entregado} etiqueta="Adelanto entregado" paso="1" onGuardar={(v) => guardar(b.trabajador_id, { adelanto: v })} /></td>
                      <td className="num border-l border-linea text-right">{sol(b.total_remuneracion)}</td>
                      <td className="num text-right">{sol(b.snp)}</td>
                      <td className="num text-right font-semibold">{sol(b.neto)}</td>
                      <td>
                        <button className="btn-quieto h-7 px-1.5" aria-expanded={abierto === b.trabajador_id} aria-label="Ver boleta"
                          onClick={() => setAbierto(abierto === b.trabajador_id ? null : b.trabajador_id)}>
                          <Icono n="der" className={`size-4 transition-transform ${abierto === b.trabajador_id ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                    </tr>
                    {abierto === b.trabajador_id && <tr><td colSpan="11" className="p-0"><Desglose b={b} pctSnp={p.parametros.pct_snp} /></td></tr>}
                  </Fragment>
                ))}
                {!p.boletas.length && <tr><td colSpan="11" className="py-10 text-center text-tinta-2">No hay trabajadores con días laborados en esta semana.</td></tr>}
              </tbody>
              {!!p.boletas.length && (
                <tfoot className="border-t-2 border-linea-2 bg-fondo/60 font-semibold">
                  <tr>
                    <td /><td className="px-3 py-2.5">Total de la semana</td><td colSpan="4" />
                    <td className="num px-3 text-right">{sol(t.adelanto_entregado)}</td>
                    <td className="num border-l border-linea px-3 text-right">{sol(t.total_remuneracion)}</td>
                    <td className="num px-3 text-right">{sol(p.boletas.reduce((a, x) => a + x.snp * 100, 0) / 100)}</td>
                    <td className="num px-3 text-right">{sol(t.neto)}</td><td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="border-t border-linea px-4 py-2 text-[12px] text-tinta-2">
            Pago de la semana = sueldo semanal × días ÷ 6 + horas extras × tarifa, redondeado al sol hacia arriba. El depósito descuenta el adelanto entregado.
            La boleta desglosa ese depósito según el régimen de construcción civil. Pulse la flecha de una fila para ver la boleta.
          </p>
        </div>
      )}

      {!!p?.errores?.length && (
        <Aviso tono="pend" icono="alerta" className="mt-4">
          No se pudo calcular a {p.errores.length === 1 ? 'un trabajador' : `${p.errores.length} trabajadores`}:
          <ul className="mt-1.5 list-disc pl-5">
            {p.errores.map((e) => <li key={e.trabajador_id}><span className="dato-personal">{e.trabajador}</span>: {e.errores.join('; ')}</li>)}
          </ul>
        </Aviso>
      )}
      {aviso && <Aviso tono={aviso.tono} icono="alerta" className="mt-4">{aviso.texto}</Aviso>}
    </section>
  );
}
