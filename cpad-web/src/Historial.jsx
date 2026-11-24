import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Aviso, Campo, Encabezado, Icono, horas } from './ui.jsx';
import { fechaHora, rango } from './fechas.js';

const sol = (n) => Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pdf = (obra, inicio, t) => `/api/planillas/boletas.pdf?obra_id=${obra}&fecha=${inicio}${t ? `&trabajador_id=${t}` : ''}`;

/** HU12 · Historial de planillas registradas y de las boletas de un trabajador. */
export default function Historial({ obras, obraId, setObraId, setFecha, ir }) {
  const [semanas, setSemanas] = useState(null);
  const [dni, setDni] = useState('');
  const [trab, setTrab] = useState(null);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    if (!obraId) return;
    api.get(`/planillas/historial?obra_id=${obraId}`).then(setSemanas).catch((e) => setAviso(e.message));
  }, [obraId]);

  async function buscar(e) {
    e.preventDefault(); setAviso(null); setTrab(null);
    try { setTrab(await api.get(`/planillas/historial/trabajador?dni=${dni.trim()}`)); } catch (err) { setAviso(err.message); }
  }
  const total = (semanas || []).reduce((a, s) => a + s.total_deposito * 100, 0) / 100;

  return (
    <section>
      <Encabezado titulo="Historial de boletas" detalle="Planillas registradas por semana. Las boletas se emiten tal como se registraron.">
        <Campo etiqueta="Obra">
          <select value={obraId} onChange={(e) => setObraId(e.target.value)} className="campo max-w-[20rem]">
            {obras.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
          </select>
        </Campo>
      </Encabezado>

      <div className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
        <div className="overflow-x-auto">
          <table className="tabla w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="w-24">Semana</th><th>Del – al</th><th className="text-right">Trabajadores</th>
                <th className="text-right">Total depositado</th><th>Registrada</th><th className="w-[19rem]" />
              </tr>
            </thead>
            <tbody>
              {(semanas || []).map((s) => (
                <tr key={s.semana_inicio}>
                  <td className="num font-medium">{s.numero_semana ? `Semana ${s.numero_semana}` : '—'}</td>
                  <td className="num">{rango(s.semana_inicio, s.semana_fin)}</td>
                  <td className="num text-right">{s.trabajadores}</td>
                  <td className="num text-right font-semibold">S/ {sol(s.total_deposito)}</td>
                  <td className="num text-tinta-2">{fechaHora(s.registrado_en)}{s.origen === 'EXCEL' ? ' · desde Excel' : ''}{s.registrado_por ? ` · ${s.registrado_por}` : ''}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" className="btn-quieto h-8" onClick={() => { setFecha(s.semana_inicio); ir('planilla', s.semana_inicio); }}>Ver planilla</button>
                      <a className="btn-secundario h-8" href={pdf(obraId, s.semana_inicio)} target="_blank" rel="noreferrer"><Icono n="planilla" />Boletas (PDF)</a>
                    </div>
                  </td>
                </tr>
              ))}
              {semanas && !semanas.length && (
                <tr><td colSpan="6" className="py-10 text-center text-tinta-2">Aún no hay planillas registradas en esta obra. Se registran desde la planilla semanal.</td></tr>
              )}
            </tbody>
            {!!semanas?.length && (
              <tfoot className="border-t-2 border-linea-2 bg-fondo/60 font-semibold">
                <tr><td className="px-3 py-2.5" colSpan="3">{semanas.length} {semanas.length === 1 ? 'semana registrada' : 'semanas registradas'}</td>
                  <td className="num px-3 text-right">S/ {sol(total)}</td><td colSpan="2" /></tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <form onSubmit={buscar} className="mt-6 flex flex-wrap items-end gap-3">
        <Campo etiqueta="Boletas de un trabajador (DNI)">
          <input value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="8 dígitos" className="campo num w-40" />
        </Campo>
        <button className="btn-secundario" disabled={dni.length !== 8}><Icono n="buscar" />Buscar</button>
      </form>
      {aviso && <Aviso tono="error" icono="alerta" className="mt-4">{aviso}</Aviso>}

      {trab && (
        <div className="mt-4 overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          <div className="border-b border-linea-2 px-4 py-3">
            <div className="dato-personal font-medium">{trab.trabajador.apellidos}, {trab.trabajador.nombres}</div>
            <div className="num text-[12px] text-tinta-2"><span className="dato-personal">DNI {trab.trabajador.dni}</span> · {trab.boletas.length} {trab.boletas.length === 1 ? 'boleta' : 'boletas'}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[720px]">
              <thead><tr><th>Obra</th><th>Semana</th><th>Del – al</th><th>Categoría</th><th className="text-right">Días</th><th className="text-right">H. extra</th><th className="text-right">Depósito</th><th /></tr></thead>
              <tbody>
                {trab.boletas.map((b) => (
                  <tr key={`${b.obra_id}-${b.semana_inicio}`}>
                    <td>{b.obra}</td>
                    <td className="num">{b.numero_semana ?? '—'}</td>
                    <td className="num">{rango(b.semana_inicio, b.semana_fin)}</td>
                    <td className="text-[13px]">{b.categoria ? b.categoria.charAt(0) + b.categoria.slice(1).toLowerCase() : ''}</td>
                    <td className="num text-right">{b.dias}</td>
                    <td className="num text-right">{horas(b.horas_extras) || '0'}</td>
                    <td className="num text-right font-semibold">{sol(b.deposito)}</td>
                    <td className="text-right"><a className="btn-quieto h-8" href={pdf(b.obra_id, b.semana_inicio, trab.trabajador.id)} target="_blank" rel="noreferrer"><Icono n="planilla" />PDF</a></td>
                  </tr>
                ))}
                {!trab.boletas.length && <tr><td colSpan="8" className="py-8 text-center text-tinta-2">El trabajador no tiene boletas en planillas registradas.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
