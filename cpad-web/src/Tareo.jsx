import { useEffect, useState } from 'react';
import { api } from './api.js';
import Categoria from './Categoria.jsx';
import { Aviso, Campo, Encabezado, Icono, Rotulo, horas } from './ui.jsx';
import { diaSemana, hoyLima, larga, sumar } from './fechas.js';

const sumarHora = (t, o) => { const m = aMin(t) + aMin(o.almuerzo_fin) - aMin(o.almuerzo_inicio); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const aMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Vista previa del sobretiempo con la misma regla que la API (almuerzo y «de corrido» incluidos). */
function sobretiempo(fila, obra, dow) {
  if (fila.estado !== 'asistio' || !fila.salida || !fila.ingreso || dow === 0) return null;
  const ing = aMin(fila.ingreso), sal = aMin(fila.salida);
  const progIng = aMin(obra.hora_ingreso), progSal = aMin(dow === 6 ? obra.hora_salida_sabado : obra.hora_salida);
  const dur = aMin(obra.almuerzo_fin) - aMin(obra.almuerzo_inicio);
  const [a0, a1] = dow === 6 ? [progSal, progSal + dur] : [aMin(obra.almuerzo_inicio), aMin(obra.almuerzo_fin)];
  const cruce = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  let extra = Math.max(0, sal - progSal);
  if (!fila.corrido) extra -= cruce(progSal, sal, a0, a1);
  else extra += cruce(Math.max(ing, progIng), Math.min(sal, progSal), a0, a1);
  return Math.max(0, extra) / 60;
}

function Marcar({ valor, onChange, fila, bloqueado }) {
  const op = [['asistio', 'Asistió'], ['falto', 'Faltó']];
  return (
    <div role="group" aria-label={`Asistencia de la fila ${fila}`} className="inline-flex rounded-md border border-linea-2 bg-white p-0.5">
      {op.map(([v, t]) => {
        const on = valor === v;
        return (
          <button key={v} type="button" disabled={bloqueado} aria-pressed={on} onClick={() => onChange(on ? '' : v)}
            className={`h-7 rounded px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed ${on ? (v === 'asistio' ? 'bg-ok text-white' : 'bg-tinta text-white') : 'text-tinta-2 hover:bg-fondo hover:text-tinta'}`}>
            {t}
          </button>
        );
      })}
    </div>
  );
}

export default function Tareo({ obras, obraId, setObraId, fecha, setFecha, ir }) {
  const [hoja, setHoja] = useState(null);
  const [filas, setFilas] = useState({});
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false);

  async function cargar() {
    if (!obraId || !fecha) return;
    const h = await api.get(`/asistencias?obra_id=${obraId}&fecha=${fecha}`);
    setHoja(h);
    setFilas(Object.fromEntries(h.filas.map((f) => [f.trabajador_id, {
      estado: !f.registrado ? '' : f.asistio ? 'asistio' : 'falto',
      ingreso: f.hora_ingreso || '', salida: f.hora_salida || '', corrido: !!f.de_corrido, observacion: f.observacion || '',
    }])));
    setErrores({}); setCambios(false);
  }
  useEffect(() => { setAviso(null); cargar().catch((e) => setAviso({ tono: 'error', texto: e.message })); }, [obraId, fecha]);

  const dow = diaSemana(fecha);
  const cerrada = hoja?.semana_cerrada;
  const cambiar = (id, campo, valor) => { setCambios(true); setFilas((f) => ({ ...f, [id]: { ...f[id], [campo]: valor } })); };

  function completarConHorario() {
    const o = hoja.obra; const salida = dow === 6 ? o.hora_salida_sabado : o.hora_salida;
    setCambios(true);
    setFilas((f) => Object.fromEntries(Object.entries(f).map(([id, x]) => [id,
      x.estado === 'asistio' ? { ...x, ingreso: x.ingreso || o.hora_ingreso, salida: x.salida || salida } : x])));
  }

  async function guardar() {
    const ids = hoja.filas.map((f) => f.trabajador_id).filter((id) => filas[id].estado);
    const registros = ids.map((id) => {
      const x = filas[id];
      return x.estado === 'falto'
        ? { trabajador_id: id, asistio: false, observacion: x.observacion || null }
        : { trabajador_id: id, asistio: true, hora_ingreso: x.ingreso || null, hora_salida: x.salida || null, de_corrido: !!x.corrido, observacion: x.observacion || null };
    });
    if (!registros.length) { setAviso({ tono: 'error', texto: 'Marca la asistencia de al menos un trabajador antes de guardar.' }); return; }
    setGuardando(true);
    try {
      const r = await api.put('/asistencias', { obra_id: Number(obraId), fecha, registros });
      await cargar();
      setAviso({ tono: 'ok', texto: `Hoja guardada: ${r.guardados} registros.` });
    } catch (e) {
      const porId = {};
      (e.datos?.errores || []).forEach((er) => { porId[ids[er.fila - 1]] = er.errores.join('; '); });
      setErrores(porId);
      setAviso({ tono: 'error', texto: e.message });
    } finally { setGuardando(false); }
  }

  const marcados = Object.values(filas);
  const resumen = hoja && {
    asistieron: marcados.filter((x) => x.estado === 'asistio').length,
    faltaron: marcados.filter((x) => x.estado === 'falto').length,
    pendientes: marcados.filter((x) => !x.estado).length,
    sobretiempo: hoja.filas.reduce((s, f) => s + (sobretiempo(filas[f.trabajador_id] || {}, hoja.obra, dow) || 0), 0),
  };
  const o = hoja?.obra;

  return (
    <section>
      <Encabezado titulo="Tareo diario" detalle="Transcribe la hoja «Control de asistencia – obreros» que envía el capataz.">
        <Campo etiqueta="Obra">
          <select value={obraId} onChange={(e) => setObraId(e.target.value)} className="campo max-w-[26rem]">
            {obras.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Fecha">
          <div className="flex items-center gap-1">
            <button type="button" className="btn-quieto h-9" aria-label="Día anterior" onClick={() => setFecha(sumar(fecha, -1))}><Icono n="izq" /></button>
            <input type="date" value={fecha} max={hoyLima()} onChange={(e) => e.target.value && setFecha(e.target.value)} className="campo num" />
            <button type="button" className="btn-quieto h-9" aria-label="Día siguiente" disabled={fecha >= hoyLima()} onClick={() => setFecha(sumar(fecha, 1))}><Icono n="der" /></button>
          </div>
        </Campo>
      </Encabezado>

      {hoja && (
        <div className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          <Rotulo celdas={[
            { etiqueta: 'Obra', valor: o.nombre, ancho: 'col-span-2 md:col-span-3' },
            { etiqueta: 'Fecha', valor: <span className="first-letter:uppercase inline-block">{larga(fecha)}</span>, ancho: 'col-span-2 md:col-span-3' },
            { etiqueta: 'Horario', valor: dow === 0 ? 'Día no programado' : `${o.hora_ingreso} a ${dow === 6 ? o.hora_salida_sabado : o.hora_salida}`, ancho: 'md:col-span-2' },
            { etiqueta: 'Almuerzo', valor: dow >= 1 && dow <= 5 ? `${o.almuerzo_inicio} a ${o.almuerzo_fin}` : dow === 6 ? `${o.hora_salida_sabado} a ${sumarHora(o.hora_salida_sabado, o)}` : 'No aplica', ancho: 'md:col-span-2' },
            { etiqueta: 'Semana', valor: cerrada ? <span className="inline-flex items-center gap-1 text-ok"><Icono n="candado" className="size-3.5" />Cerrada</span> : 'Abierta', ancho: 'md:col-span-2' },
          ]} />

          <div className="flex flex-wrap items-center gap-x-7 gap-y-1 border-b border-linea bg-fondo/60 px-4 py-2.5 text-[13px] num">
            <span><strong className="text-[15px] text-ok">{resumen.asistieron}</strong> asistieron</span>
            <span><strong className="text-[15px]">{resumen.faltaron}</strong> faltaron</span>
            <span className={resumen.pendientes ? 'text-pend' : ''}><strong className="text-[15px]">{resumen.pendientes}</strong> sin marcar</span>
            <span className="ml-auto"><strong className="text-[15px]">{horas(resumen.sobretiempo) || 0}</strong> h de sobretiempo</span>
          </div>

          {cerrada && (
            <Aviso tono="ok" icono="candado" className="m-4 mb-0">
              La semana de esta hoja está cerrada y no admite cambios. Para corregirla, reábrela en{' '}
              <button className="font-medium underline" onClick={() => ir('semana')}>Resumen semanal</button>.
            </Aviso>
          )}

          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[1080px]">
              <thead>
                <tr>
                  <th className="w-10 text-right">N.°</th><th>Apellidos y nombres</th><th>DNI</th><th>Categoría</th>
                  <th>Asistencia</th><th>Ingreso</th><th>Salida</th><th title="No tomó la hora de almuerzo">De corrido</th><th className="text-right">Sobretiempo</th><th className="w-[18%]">Observación</th>
                </tr>
              </thead>
              <tbody>
                {hoja.filas.map((f, i) => {
                  const x = filas[f.trabajador_id] || {}; const st = sobretiempo(x, o, dow); const err = errores[f.trabajador_id];
                  const borde = err ? 'shadow-[inset_3px_0_0_var(--color-coez)] bg-[#fcf0ed]' : x.estado === 'asistio' ? 'shadow-[inset_3px_0_0_var(--color-ok)]' : x.estado === 'falto' ? 'shadow-[inset_3px_0_0_var(--color-tinta)] bg-fondo/50' : '';
                  return (
                    <tr key={f.trabajador_id} className={borde}>
                      <td className="num text-right text-tinta-2">{i + 1}</td>
                      <td className="min-w-52">
                        <span className="dato-personal font-medium">{f.apellidos}, {f.nombres}</span>
                        {err && <div role="alert" className="mt-0.5 text-[12px] text-coez-osc">{err}</div>}
                      </td>
                      <td className="num text-tinta-2"><span className="dato-personal">{f.dni}</span></td>
                      <td><Categoria nombre={f.categoria} /></td>
                      <td><Marcar valor={x.estado} fila={i + 1} bloqueado={cerrada} onChange={(v) => cambiar(f.trabajador_id, 'estado', v)} /></td>
                      {['ingreso', 'salida'].map((c) => (
                        <td key={c}>
                          {cerrada ? <span className="num px-2 text-[13px]">{x[c] || ''}</span> : <input type="time" aria-label={`Hora de ${c} de la fila ${i + 1}`} disabled={cerrada || x.estado !== 'asistio'} value={x[c] || ''}
                            onChange={(e) => cambiar(f.trabajador_id, c, e.target.value)} className="campo-sm num w-[6.3rem]" />}
                        </td>
                      ))}
                      <td>
                        {x.estado === 'asistio' && (
                          <input type="checkbox" aria-label={`De corrido, sin almuerzo, fila ${i + 1}`} checked={!!x.corrido} disabled={cerrada}
                            onChange={(e) => cambiar(f.trabajador_id, 'corrido', e.target.checked)} className="size-4 accent-[var(--color-tinta)]" />
                        )}
                      </td>
                      <td className="num text-right">{st ? <strong>+{horas(st)} h</strong> : st === 0 ? <span className="text-tinta-2/50">—</span> : ''}</td>
                      <td>
                        <input aria-label={`Observación de la fila ${i + 1}`} value={x.observacion || ''} maxLength={200} disabled={cerrada}
                          onChange={(e) => cambiar(f.trabajador_id, 'observacion', e.target.value)}
                          className="h-8 w-full min-w-32 rounded border border-transparent bg-transparent px-2 text-[13px] hover:border-linea-2 focus:border-linea-2 focus:bg-white disabled:hover:border-transparent" placeholder={cerrada ? '' : 'Añadir nota'} />
                      </td>
                    </tr>
                  );
                })}
                {!hoja.filas.length && <tr><td colSpan="10" className="py-10 text-center text-tinta-2">La obra no tiene trabajadores asignados. Regístralos en Trabajadores.</td></tr>}
              </tbody>
            </table>
          </div>

          {!cerrada && (
            <div className="flex flex-wrap items-center gap-3 border-t border-linea-2 bg-fondo/60 px-4 py-3">
              <button onClick={completarConHorario} className="btn-secundario"><Icono n="reloj" />Completar horas con el horario de la obra</button>
              <span className="text-[13px] text-tinta-2">{cambios ? 'Hay cambios sin guardar.' : ''}</span>
              <button onClick={guardar} disabled={guardando} className="btn-primario ml-auto">{guardando ? 'Guardando…' : 'Guardar hoja'}</button>
            </div>
          )}
        </div>
      )}
      {aviso && <Aviso tono={aviso.tono} icono={aviso.tono === 'ok' ? 'ok' : 'alerta'} className="mt-4">{aviso.texto}</Aviso>}
    </section>
  );
}
