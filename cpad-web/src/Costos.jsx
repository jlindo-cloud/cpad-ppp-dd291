import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Aviso, Encabezado, Rotulo, horas } from './ui.jsx';
import { rango } from './fechas.js';

const sol = (n) => Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');

/** HU13 · Costo de mano de obra por obra, a partir de las planillas registradas. */
export default function Costos() {
  const [obras, setObras] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/planillas/costos').then(setObras).catch((e) => setError(e.message)); }, []);

  return (
    <section>
      <Encabezado titulo="Costo de mano de obra por obra" detalle="Lo pagado al personal obrero en las planillas registradas, por semana y por categoría." />
      {error && <Aviso tono="error" icono="alerta">{error}</Aviso>}
      {obras && !obras.length && <Aviso>Aún no hay planillas registradas. El costo aparece en cuanto se registra la primera semana.</Aviso>}
      <div className="space-y-5">
        {(obras || []).map((o) => {
          const max = Math.max(...o.semanas.map((s) => s.pago), 1);
          return (
            <article key={o.obra_id} className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-linea-2 px-4 py-3">
                <span className="num rounded bg-tinta px-2 py-0.5 text-[12px] font-medium text-white">{o.codigo}</span>
                <h2 className="titulo text-[17px]">{o.nombre}</h2>
                {o.centro_costo && <span className="text-[13px] text-tinta-2">Centro de costo: {o.centro_costo}</span>}
              </div>
              <Rotulo celdas={[
                { etiqueta: 'Costo de mano de obra', valor: <span className="text-[18px]">S/ {sol(o.total_pago)}</span>, ancho: 'col-span-2 md:col-span-3' },
                { etiqueta: 'Semanas registradas', valor: o.semanas.length, ancho: 'md:col-span-2' },
                { etiqueta: 'Jornales pagados', valor: o.jornales, ancho: 'md:col-span-2' },
                { etiqueta: 'Costo promedio por jornal', valor: `S/ ${sol(o.costo_jornal)}`, ancho: 'md:col-span-3' },
                { etiqueta: 'Horas extra', valor: horas(o.horas_extras) || '0', ancho: 'md:col-span-2' },
              ]} />
              <div className="grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="overflow-x-auto border-linea-2 md:border-r">
                  <table className="tabla w-full min-w-[520px]">
                    <thead><tr><th>Semana</th><th>Del – al</th><th className="text-right">Trab.</th><th className="w-[38%]">Costo de la semana</th><th className="text-right">Depositado</th></tr></thead>
                    <tbody>
                      {o.semanas.map((s) => (
                        <tr key={s.semana_inicio}>
                          <td className="num font-medium">{s.numero_semana ?? '—'}</td>
                          <td className="num">{rango(s.semana_inicio, s.semana_fin)}</td>
                          <td className="num text-right">{s.trabajadores}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 flex-1 rounded-sm bg-fondo"><div className="h-full rounded-sm bg-coez" style={{ width: `${(s.pago / max) * 100}%` }} /></div>
                              <span className="num w-24 text-right font-semibold">S/ {sol(s.pago)}</span>
                            </div>
                          </td>
                          <td className="num text-right text-tinta-2">{sol(s.deposito)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3">
                  <div className="mb-2 text-[12px] font-medium text-tinta-2">Por categoría</div>
                  <ul className="space-y-2.5">
                    {o.categorias.map((c) => (
                      <li key={c.categoria}>
                        <div className="flex justify-between text-[13.5px]"><span>{cap(c.categoria)}</span><span className="num font-medium">S/ {sol(c.pago)}</span></div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-sm bg-fondo"><div className="h-full rounded-sm bg-tinta" style={{ width: `${(c.pago / o.total_pago) * 100}%` }} /></div>
                          <span className="num w-20 text-right text-[12px] text-tinta-2">{Math.round((c.pago / o.total_pago) * 100)} % · {c.jornales} jor.</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="border-t border-linea-2 bg-fondo/60 px-4 py-2 text-[12px] text-tinta-2">
                El costo es lo pagado en la semana (días y horas extra). El depositado ya tiene restados los descuentos (DSCTO), que no son un menor costo de la obra.
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
