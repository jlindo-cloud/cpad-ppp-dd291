import { useEffect, useState } from 'react';
import { api } from './api.js';
import Categoria from './Categoria.jsx';
import { Aviso, Campo, Encabezado, Icono, Rotulo, horas } from './ui.jsx';
import { DIAS_CORTOS, diaNum, fechaHora, hoyLima, lunesDe, rango, sumar } from './fechas.js';

const dias = (n, t) => `${n} ${n === 1 ? 'día' : 'días'} ${t}`;
const corto = (t) => (t ? t.replace(/^0/, '') : '');

/** Celda de un día: horario registrado, falta, pendiente o día no aplicable. */
function Dia({ d, pendiente }) {
  if (d.estado === 'A') {
    return (
      <div className="leading-tight">
        <div className="num whitespace-nowrap text-[12.5px]">{corto(d.hora_ingreso)}–{d.hora_salida ? corto(d.hora_salida) : <span className="text-pend">?</span>}</div>
        <div className="num mt-0.5 whitespace-nowrap text-[11.5px] text-tinta-2">
          {horas(d.horas_trabajadas)} h{d.sobretiempo_h > 0 && <strong className="ml-1 font-semibold text-tinta">+{horas(d.sobretiempo_h)}</strong>}
          {d.de_corrido && <span title="De corrido: sin almuerzo" className="ml-1 rounded-sm bg-linea px-1 text-[10.5px] text-tinta">dc</span>}
        </div>
      </div>
    );
  }
  if (d.estado === 'F') return <span className="text-[12.5px] text-tinta-2">Faltó</span>;
  if (pendiente) return <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-pend"><span className="size-1.5 rounded-full bg-pend" />Sin marcar</span>;
  return <span className="text-tinta-2/40">·</span>;
}

export default function Semana({ obras, obraId, setObraId, fecha, setFecha, ir }) {
  const [s, setS] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [pendientes, setPendientes] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const inicio = lunesDe(fecha);
  const hoy = hoyLima();

  async function cargar() {
    if (!obraId) return;
    setS(await api.get(`/asistencias/semana?obra_id=${obraId}&fecha=${inicio}`));
  }
  useEffect(() => { setAviso(null); setPendientes([]); cargar().catch((e) => setAviso({ tono: 'error', texto: e.message })); }, [obraId, inicio]);

  async function cerrar() {
    setOcupado(true); setPendientes([]); setAviso(null);
    try {
      setS(await api.post('/asistencias/semana/cierre', { obra_id: Number(obraId), fecha: inicio }));
      setAviso({ tono: 'ok', texto: 'Semana cerrada. Las hojas de estos días ya no admiten cambios y quedan listas para el cálculo de la planilla.' });
    } catch (e) {
      setPendientes(e.datos?.pendientes || []);
      setAviso({ tono: 'error', texto: e.message });
    } finally { setOcupado(false); }
  }
  async function reabrir() {
    if (!confirm('¿Reabrir la semana? Las hojas de estos días podrán corregirse y habrá que volver a cerrarla.')) return;
    setOcupado(true);
    try { setS(await api.del(`/asistencias/semana/cierre?obra_id=${obraId}&fecha=${inicio}`)); setAviso({ tono: 'info', texto: 'Semana reabierta para corregir.' }); }
    catch (e) { setAviso({ tono: 'error', texto: e.message }); } finally { setOcupado(false); }
  }

  const terminada = sumar(inicio, 5) <= hoy;
  const r = s?.resumen;

  return (
    <section>
      <Encabezado titulo="Resumen semanal" detalle="Revisa la asistencia de lunes a domingo y ciérrala para el cálculo de la planilla.">
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

      {s && (
        <div className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          <Rotulo celdas={[
            { etiqueta: 'Obra', valor: s.obra.nombre, ancho: 'col-span-2 md:col-span-4' },
            { etiqueta: 'Semana', valor: `Del ${rango(s.semana.inicio, s.semana.fin)}`, ancho: 'col-span-2 md:col-span-4' },
            { etiqueta: 'Estado', ancho: 'col-span-2 md:col-span-4', valor: s.cierre
              ? <span className="inline-flex items-center gap-1.5 text-ok"><Icono n="candado" className="size-3.5" />Cerrada el {fechaHora(s.cierre.cerrado_en)}</span>
              : <span className="inline-flex items-center gap-1.5"><Icono n="abierto" className="size-3.5 text-tinta-2" />Abierta{!terminada && <span className="text-tinta-2">, en curso</span>}</span> },
          ]} />
          <dl className="num grid grid-cols-3 border-b border-linea-2 md:grid-cols-6">
            {[['Trabajadores', r.trabajadores], ['Días asistidos', r.dias_asistidos], ['Faltas', r.faltas],
              ['Horas trabajadas', horas(r.horas_trabajadas) || 0], ['Sobretiempo', `${horas(r.sobretiempo_h) || 0} h`], ['Horas en domingo', horas(r.horas_domingo) || 0]].map(([k, v]) => (
              <div key={k} className="border-linea px-4 py-3 [&:not(:first-child)]:border-l">
                <dt className="text-[11.5px] text-tinta-2">{k}</dt>
                <dd className="titulo mt-0.5 text-[22px] leading-none">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[1100px]">
              <thead>
                <tr>
                  <th className="w-10 text-right">N.°</th><th>Trabajador</th>
                  {s.semana.dias.map((d, i) => (
                    <th key={d} className={`w-[96px] ${i === 6 ? 'bg-fondo/70' : ''}`}>
                      <button className="text-left hover:text-coez" title="Abrir la hoja de ese día" onClick={() => ir('tareo', d)}>
                        {DIAS_CORTOS[(i + 1) % 7]} <span className="num text-tinta">{diaNum(d)}</span>
                      </button>
                    </th>
                  ))}
                  <th className="border-l border-linea text-right">Días</th><th className="text-right">Faltas</th>
                  <th className="text-right">Horas</th><th className="text-right">Sobret.</th><th className="text-right">Dom.</th>
                </tr>
              </thead>
              <tbody>
                {s.filas.map((f, n) => (
                  <tr key={f.trabajador_id}>
                    <td className="num text-right text-tinta-2">{n + 1}</td>
                    <td className="min-w-56">
                      <div className="dato-personal font-medium leading-tight">{f.apellidos}, {f.nombres}</div>
                      <Categoria nombre={f.categoria} className="mt-0.5 text-[12px] text-tinta-2" />
                    </td>
                    {f.dias.map((d, i) => <td key={d.fecha} className={i === 6 ? 'bg-fondo/70' : ''}><Dia d={d} pendiente={d.pendiente} /></td>)}
                    <td className="num border-l border-linea text-right font-medium">{f.dias_asistidos}</td>
                    <td className="num text-right">{f.faltas || <span className="text-tinta-2/40">0</span>}</td>
                    <td className="num text-right">{horas(f.horas_trabajadas) || 0}</td>
                    <td className="num text-right font-semibold">{f.sobretiempo_h ? horas(f.sobretiempo_h) : <span className="font-normal text-tinta-2/40">0</span>}</td>
                    <td className="num text-right">{f.horas_domingo ? horas(f.horas_domingo) : <span className="text-tinta-2/40">0</span>}</td>
                  </tr>
                ))}
                {!s.filas.length && <tr><td colSpan="14" className="py-10 text-center text-tinta-2">Sin trabajadores en esta obra.</td></tr>}
              </tbody>
              {!!s.filas.length && (
                <tfoot className="border-t-2 border-linea-2 bg-fondo/60 font-semibold">
                  <tr>
                    <td /><td className="px-3 py-2.5">Total de la semana</td><td colSpan="7" />
                    <td className="num border-l border-linea px-3 text-right">{r.dias_asistidos}</td><td className="num px-3 text-right">{r.faltas}</td>
                    <td className="num px-3 text-right">{horas(r.horas_trabajadas) || 0}</td><td className="num px-3 text-right">{horas(r.sobretiempo_h) || 0}</td>
                    <td className="num px-3 text-right">{horas(r.horas_domingo) || 0}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <p className="border-t border-linea px-4 py-2 text-[12px] text-tinta-2">
            Cada día muestra ingreso–salida, horas trabajadas y, en negrita, el sobretiempo. «dc»: de corrido, sin almuerzo. Un punto indica un día que no corresponde al trabajador (domingo sin registro o anterior a su ingreso).
          </p>
          <div className="flex flex-wrap items-center gap-3 border-t border-linea-2 bg-fondo/60 px-4 py-3 text-[13px]">
            {s.cierre ? (
              <>
                <span className="text-tinta-2">Cerrada: las hojas de esta semana no admiten cambios.</span>
                <button onClick={reabrir} disabled={ocupado} className="btn-secundario ml-auto"><Icono n="abierto" />Reabrir semana</button>
              </>
            ) : (
              <>
                <span className={r.sin_marcar || r.sin_salida ? 'text-pend' : 'text-tinta-2'}>
                  {!terminada ? 'La semana podrá cerrarse cuando haya transcurrido el sábado.'
                    : r.sin_marcar || r.sin_salida ? `Antes de cerrar falta registrar ${[r.sin_marcar && dias(r.sin_marcar, 'sin marcar'), r.sin_salida && dias(r.sin_salida, 'sin hora de salida')].filter(Boolean).join(' y ')}.`
                      : 'Todos los días programados están registrados.'}
                </span>
                <button onClick={cerrar} disabled={ocupado || !terminada} className="btn-primario ml-auto"><Icono n="candado" />Cerrar semana</button>
              </>
            )}
          </div>
        </div>
      )}
      {aviso && (
        <Aviso tono={aviso.tono} icono={aviso.tono === 'ok' ? 'ok' : aviso.tono === 'error' ? 'alerta' : 'abierto'} className="mt-4">
          {aviso.texto}
          {!!pendientes.length && (
            <ul className="mt-1.5 list-disc pl-5">
              {pendientes.map((p) => (
                <li key={p.trabajador_id}><span className="dato-personal">{p.trabajador}</span>: {[p.sin_marcar && dias(p.sin_marcar, 'sin marcar'), p.sin_salida && dias(p.sin_salida, 'sin hora de salida')].filter(Boolean).join(' y ')}</li>
              ))}
            </ul>
          )}
        </Aviso>
      )}
    </section>
  );
}
