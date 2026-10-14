import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import Categoria from './Categoria.jsx';

const aMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hoyLima = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Vista previa del sobretiempo con la misma regla que la API: salida posterior a la del horario de la obra. */
function sobretiempo(fila, obra, dow) {
  if (fila.estado !== 'asistio' || !fila.salida || dow === 0) return null;
  const prog = aMin(dow === 6 ? obra.hora_salida_sabado : obra.hora_salida);
  return Math.max(0, aMin(fila.salida) - prog) / 60;
}

export default function Tareo() {
  const params = new URLSearchParams(location.search);
  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState('');
  const [fecha, setFecha] = useState(params.get('fecha') || hoyLima());
  const [hoja, setHoja] = useState(null);
  const [filas, setFilas] = useState({});
  const [errores, setErrores] = useState({});
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { api.get('/obras?activo=true').then((o) => { setObras(o); if (o[0]) setObraId(String(o[0].id)); }); }, []);

  async function cargar() {
    if (!obraId || !fecha) return;
    const h = await api.get(`/asistencias?obra_id=${obraId}&fecha=${fecha}`);
    setHoja(h);
    setFilas(Object.fromEntries(h.filas.map((f) => [f.trabajador_id, {
      estado: !f.registrado ? '' : f.asistio ? 'asistio' : 'falto',
      ingreso: f.hora_ingreso || '', salida: f.hora_salida || '', observacion: f.observacion || '',
    }])));
    setErrores({}); setAviso(null);
  }
  useEffect(() => { cargar().catch((e) => setAviso({ tipo: 'error', texto: e.message })); }, [obraId, fecha]);

  const dow = useMemo(() => new Date(fecha + 'T12:00:00Z').getUTCDay(), [fecha]);
  const cambiar = (id, campo, valor) => setFilas((f) => ({ ...f, [id]: { ...f[id], [campo]: valor } }));

  function completarConHorario() {
    const o = hoja.obra; const salida = dow === 6 ? o.hora_salida_sabado : o.hora_salida;
    setFilas((f) => Object.fromEntries(Object.entries(f).map(([id, x]) => [id,
      x.estado === 'asistio' ? { ...x, ingreso: x.ingreso || o.hora_ingreso, salida: x.salida || salida } : x])));
  }

  async function guardar() {
    const ids = hoja.filas.map((f) => f.trabajador_id).filter((id) => filas[id].estado);
    const registros = ids.map((id) => {
      const x = filas[id];
      return x.estado === 'falto'
        ? { trabajador_id: id, asistio: false, observacion: x.observacion || null }
        : { trabajador_id: id, asistio: true, hora_ingreso: x.ingreso || null, hora_salida: x.salida || null, observacion: x.observacion || null };
    });
    if (!registros.length) { setAviso({ tipo: 'error', texto: 'Marca la asistencia de al menos un trabajador antes de guardar.' }); return; }
    setGuardando(true);
    try {
      const r = await api.put('/asistencias', { obra_id: Number(obraId), fecha, registros });
      await cargar();
      setAviso({ tipo: 'ok', texto: `Hoja guardada: ${r.guardados} registros.` });
    } catch (e) {
      const porId = {};
      (e.datos?.errores || []).forEach((er) => { porId[ids[er.fila - 1]] = er.errores.join('; '); });
      setErrores(porId);
      setAviso({ tipo: 'error', texto: e.message });
    } finally { setGuardando(false); }
  }

  const marcados = Object.values(filas);
  const resumen = hoja && {
    asistieron: marcados.filter((x) => x.estado === 'asistio').length,
    faltaron: marcados.filter((x) => x.estado === 'falto').length,
    pendientes: marcados.filter((x) => !x.estado).length,
    sobretiempo: hoja.filas.reduce((s, f) => s + (sobretiempo(filas[f.trabajador_id] || {}, hoja.obra, dow) || 0), 0),
  };

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">Tareo diario</h1>
          <p className="text-sm text-tinta/70">Transcribe la hoja “Control de asistencia – obreros” de la obra.</p>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-tinta/70">Obra</span>
          <select value={obraId} onChange={(e) => setObraId(e.target.value)} className="rounded border border-linea bg-white px-3 py-2">
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nombre}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-tinta/70">Fecha</span>
          <input type="date" value={fecha} max={hoyLima()} onChange={(e) => setFecha(e.target.value)} className="num rounded border border-linea bg-white px-3 py-2" />
        </label>
      </header>

      {hoja && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-8 gap-y-2 rounded border border-linea bg-hoja px-5 py-3 text-sm">
            <div><span className="text-tinta/60">Día </span><strong className="capitalize">{DIAS[dow]}</strong></div>
            <div className="num"><span className="text-tinta/60">Horario </span>
              {dow === 0 ? 'día no programado' : `${hoja.obra.hora_ingreso} a ${dow === 6 ? hoja.obra.hora_salida_sabado : hoja.obra.hora_salida}`}
              {dow >= 1 && dow <= 5 && <span className="text-tinta/60"> · almuerzo {hoja.obra.almuerzo_inicio} a {hoja.obra.almuerzo_fin}</span>}
            </div>
            <div className="num ml-auto flex gap-6">
              <span><strong>{resumen.asistieron}</strong> asistieron</span>
              <span><strong>{resumen.faltaron}</strong> faltaron</span>
              <span><strong>{resumen.pendientes}</strong> sin marcar</span>
              <span><strong>+{resumen.sobretiempo.toFixed(2).replace(/\.?0+$/, '')}</strong> h de sobretiempo</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-linea bg-hoja">
            <table className="w-full text-sm">
              <thead className="bg-fondo text-left text-xs text-tinta/70">
                <tr>
                  <th className="w-12 whitespace-nowrap px-3 py-2">N.°</th><th className="px-3 py-2">Apellidos y nombres</th><th className="px-3 py-2">DNI</th>
                  <th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Asistencia</th><th className="px-3 py-2">Ingreso</th>
                  <th className="px-3 py-2">Salida</th><th className="px-3 py-2 text-right">Sobretiempo</th><th className="px-3 py-2">Observación</th>
                </tr>
              </thead>
              <tbody>
                {hoja.filas.map((f, i) => {
                  const x = filas[f.trabajador_id] || {}; const st = sobretiempo(x, hoja.obra, dow); const err = errores[f.trabajador_id];
                  return (
                    <tr key={f.trabajador_id} className={`border-t border-linea ${err ? 'bg-red-50' : x.estado === 'falto' ? 'bg-fondo/60' : ''}`}>
                      <td className="num px-3 py-1.5 text-tinta/60">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        <span className="dato-personal">{f.apellidos}, {f.nombres}</span>
                        {err && <div role="alert" className="text-xs text-coez">{err}</div>}
                      </td>
                      <td className="num px-3 py-1.5 dato-personal">{f.dni}</td>
                      <td className="px-3 py-1.5"><Categoria nombre={f.categoria} /></td>
                      <td className="px-3 py-1.5">
                        <select aria-label={`Asistencia de la fila ${i + 1}`} value={x.estado} onChange={(e) => cambiar(f.trabajador_id, 'estado', e.target.value)}
                          className="rounded border border-linea bg-white px-2 py-1">
                          <option value="">Sin marcar</option><option value="asistio">Asistió</option><option value="falto">Faltó</option>
                        </select>
                      </td>
                      {['ingreso', 'salida'].map((c) => (
                        <td key={c} className="px-3 py-1.5">
                          <input type="time" aria-label={`Hora de ${c} de la fila ${i + 1}`} disabled={x.estado !== 'asistio'} value={x[c] || ''}
                            onChange={(e) => cambiar(f.trabajador_id, c, e.target.value)}
                            className="num w-28 rounded border border-linea bg-white px-2 py-1 disabled:bg-transparent disabled:text-transparent" />
                        </td>
                      ))}
                      <td className="num px-3 py-1.5 text-right font-semibold">{st ? `+${st.toFixed(2).replace(/\.?0+$/, '')} h` : st === 0 ? <span className="font-normal text-tinta/40">0</span> : ''}</td>
                      <td className="px-3 py-1.5">
                        <input aria-label={`Observación de la fila ${i + 1}`} value={x.observacion || ''} maxLength={200}
                          onChange={(e) => cambiar(f.trabajador_id, 'observacion', e.target.value)} className="w-full min-w-40 rounded border border-linea bg-white px-2 py-1" />
                      </td>
                    </tr>
                  );
                })}
                {!hoja.filas.length && <tr><td colSpan="9" className="px-3 py-6 text-center text-tinta/60">La obra no tiene trabajadores asignados. Regístralos en Trabajadores.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={completarConHorario} className="rounded border border-tinta px-4 py-2 text-sm font-medium hover:bg-white">
              Completar horas con el horario de la obra
            </button>
            <button onClick={guardar} disabled={guardando} className="rounded bg-coez px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {guardando ? 'Guardando…' : 'Guardar hoja'}
            </button>
            {aviso && <p role="status" className={`text-sm ${aviso.tipo === 'ok' ? 'text-emerald-700' : 'text-coez'}`}>{aviso.texto}</p>}
          </div>
        </>
      )}
    </section>
  );
}
