import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Aviso, Campo, Encabezado, Icono, horas } from './ui.jsx';
import { rango } from './fechas.js';

const ESTADO = {
  nuevo: ['Nuevo', 'bg-[#eef6f1] text-[#1f5c39]'],
  actualiza: ['Actualiza datos', 'bg-[#eef3fb] text-[#1f4e8c]'],
  sin_cambios: ['Sin cambios', 'bg-fondo text-tinta-2'],
  error: ['Error', 'bg-[#fcf0ed] text-coez-osc'],
};
const CAMPO = { fecha_nacimiento: 'fecha de nacimiento', fecha_ingreso: 'fecha de ingreso', banco: 'banco', cuenta_bancaria: 'cuenta', cci: 'CCI' };
const cap = (t) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const sol = (n) => Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MODOS = {
  planilla: { ruta: 'planilla', nombre: 'Semana pagada', detalle: 'Registra en el historial lo pagado esa semana y actualiza el padrón.' },
  padron: { ruta: 'padron', nombre: 'Solo padrón', detalle: 'Carga los datos personales y bancarios, sin registrar pagos.' },
};

async function subir(ruta, archivo, q = '') {
  const r = await fetch(`/api/importaciones/${ruta}${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Error ${r.status}`); e.datos = d; throw e; }
  return d;
}

/** HU11 · Importa la planilla semanal en Excel de la empresa: lo pagado esa semana y el padrón, o solo el padrón. */
export default function Importar({ obras, obraId, setObraId, ir }) {
  const [modo, setModo] = useState('planilla');
  const [archivo, setArchivo] = useState(null);
  const [vista, setVista] = useState(null);
  const [esp, setEsp] = useState('');
  const [especialidades, setEspecialidades] = useState([]);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { api.get('/especialidades?activo=true').then(setEspecialidades); }, []);
  const ruta = MODOS[modo].ruta;

  async function leer(f, m = modo) {
    setArchivo(f); setVista(null); setAviso(null);
    if (!f) return;
    setOcupado(true);
    try { setVista(await subir(MODOS[m].ruta, f, `?obra_id=${obraId}`)); } catch (e) { setAviso({ tono: 'error', texto: e.message }); } finally { setOcupado(false); }
  }
  useEffect(() => { if (archivo) leer(archivo, modo); }, [modo, obraId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmar() {
    setOcupado(true);
    try {
      const r = await subir(ruta, archivo, `?confirmar=1&obra_id=${obraId}&especialidad_id=${esp}`);
      setAviso({ tono: 'ok', texto: modo === 'planilla'
        ? `Semana ${r.semana} registrada en el historial: ${r.boletas} boletas por S/ ${sol(r.total_pago)}. Padrón: ${r.registrados} nuevos y ${r.actualizados} actualizados.`
        : `Padrón importado: ${r.registrados} nuevos, ${r.actualizados} actualizados y ${r.sin_cambios} sin cambios.` });
      setVista(await subir(ruta, archivo, `?obra_id=${obraId}`));
    } catch (e) { setAviso({ tono: 'error', texto: e.message }); } finally { setOcupado(false); }
  }

  const r = vista?.resumen; const pl = vista?.planilla;
  const puede = r && !r.errores && (!r.nuevos || esp) && (modo === 'planilla' ? pl && !pl.errores.length : r.nuevos + r.actualiza > 0);
  return (
    <section>
      <Encabezado titulo="Importar desde Excel" detalle="Carga la planilla semanal en Excel de la empresa: un archivo por semana." />

      <div className="rounded-lg border border-linea-2 bg-hoja p-5 shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <span className="mb-1 block text-[12px] font-medium text-tinta-2">Qué importar</span>
            <div className="inline-flex rounded-md border border-linea-2 bg-fondo p-0.5">
              {Object.entries(MODOS).map(([k, m]) => (
                <button key={k} type="button" onClick={() => setModo(k)} title={m.detalle}
                  className={`rounded px-3 py-1.5 text-[13px] font-medium ${modo === k ? 'bg-white text-tinta shadow-sm' : 'text-tinta-2'}`}>{m.nombre}</button>
              ))}
            </div>
          </div>
          <Campo etiqueta="Obra">
            <select value={obraId} onChange={(e) => setObraId(e.target.value)} className="campo max-w-[18rem]">
              {obras.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
            </select>
          </Campo>
          <div>
            <span className="mb-1 block text-[12px] font-medium text-tinta-2">Archivo de la planilla (.xlsx)</span>
            <label className="btn-secundario cursor-pointer">
              <Icono n="importar" />{archivo ? 'Cambiar archivo' : 'Elegir archivo'}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
                onChange={(e) => { leer(e.target.files[0] || null); e.target.value = ''; }} />
            </label>
            {archivo && <span className="ml-3 text-[13px]">{archivo.name}</span>}
          </div>
        </div>
        <p className="mt-3 text-[12px] text-tinta-2">
          {MODOS[modo].detalle} La semana se ubica por el título de la hoja, por ejemplo «(SEMANA 30) 28/09 AL 03/10». Las horas extras de la hoja son las de la semana
          siguiente, que se pagan con ella, y el DSCTO ya está restado en el TOTAL PAGO. Los trabajadores que ya existen solo actualizan sus datos personales y bancarios.
          No se registra nada hasta confirmar.
        </p>
      </div>

      {aviso && <Aviso tono={aviso.tono} icono={aviso.tono === 'ok' ? 'ok' : 'alerta'} className="mt-4">{aviso.texto}</Aviso>}
      {ocupado && <p className="mt-4 text-tinta-2">Leyendo el archivo…</p>}

      {vista && (
        <div className="mt-4 overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          {pl && (
            <div className="border-b border-linea-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="titulo text-[18px]">{pl.numero ? `Semana ${pl.numero}` : 'Semana sin identificar'}</span>
                {pl.inicio && <span className="num text-tinta-2">Días del {rango(pl.inicio, pl.fin)} · pagada el sábado {dmy(pl.pago)}</span>}
                <span className="num ml-auto">{pl.trabajadores} trabajadores · total pagado <strong>S/ {sol(pl.total_pago)}</strong>{pl.total_descuento ? ` · DSCTO S/ ${sol(pl.total_descuento)}` : ''}</span>
              </div>
              {pl.errores.map((e) => <Aviso key={e} tono="error" icono="alerta" className="mt-2">{e}</Aviso>)}
              {pl.registrada && <button type="button" className="btn-quieto mt-2" onClick={() => ir('historial')}>Ver el historial</button>}
            </div>
          )}
          <dl className="num grid grid-cols-2 border-b border-linea-2 md:grid-cols-4">
            {[['Nuevos', r.nuevos], ['Actualizan datos', r.actualiza], ['Sin cambios', r.sin_cambios], ['Con error', r.errores]].map(([k, v], i) => (
              <div key={k} className="border-linea px-4 py-3 [&:not(:first-child)]:border-l">
                <dt className="text-[11.5px] text-tinta-2">{k}</dt>
                <dd className={`titulo mt-0.5 text-[22px] leading-none ${i === 3 && v ? 'text-coez' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[1150px]">
              <thead>
                <tr><th className="w-14 text-right">Fila</th><th>Estado</th><th>DNI</th><th>Apellidos y nombres</th><th>Categoría</th>
                  {modo === 'planilla'
                    ? <><th className="text-right">Días</th><th className="text-right">H. extra</th><th className="text-right">Sueldo</th><th className="text-right">Tot. horas</th><th className="text-right">DSCTO</th><th className="text-right">Total pago</th></>
                    : <><th>F. nacimiento</th><th>F. ingreso</th><th>Banco</th><th>Cuenta</th></>}
                  <th>Observaciones</th></tr>
              </thead>
              <tbody>
                {vista.filas.map((f) => (
                  <tr key={f.fila} className="align-top">
                    <td className="num text-right text-tinta-2">{f.fila}</td>
                    <td><span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium ${ESTADO[f.estado][1]}`}>{ESTADO[f.estado][0]}</span></td>
                    <td className="num dato-personal">{f.dni}</td>
                    <td className="dato-personal">{f.apellidos}, {f.nombres}</td>
                    <td className="text-[13px]">{cap(f.categoria)}</td>
                    {modo === 'planilla' ? (
                      <>
                        <td className="num text-right">{f.pago?.dias}</td>
                        <td className="num text-right">{horas(f.pago?.horas_extras) || '0'}</td>
                        <td className="num text-right">{sol(f.pago?.sueldo)}</td>
                        <td className="num text-right">{sol(f.pago?.monto_horas)}</td>
                        <td className="num text-right">{f.pago?.descuento ? sol(f.pago.descuento) : '·'}</td>
                        <td className="num text-right font-semibold">{sol(f.pago?.total_pago)}</td>
                      </>
                    ) : (
                      <>
                        <td className="num dato-personal">{dmy(f.fecha_nacimiento)}</td>
                        <td className="num">{dmy(f.fecha_ingreso)}</td>
                        <td>{f.banco}</td>
                        <td className="num dato-personal text-[13px]">{f.cuenta_bancaria}</td>
                      </>
                    )}
                    <td className="max-w-[22rem] text-[12.5px]">
                      {f.errores.map((e) => <div key={e} className="text-coez-osc">{e}</div>)}
                      {f.cambios?.length > 0 && <div className="text-[#1f4e8c]">Actualiza: {f.cambios.map((k) => CAMPO[k]).join(', ')}</div>}
                      {f.avisos.map((e) => <div key={e} className="text-tinta-2">{e}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-linea-2 bg-fondo/60 px-4 py-3 text-[13px]">
            {r.nuevos > 0 && (
              <Campo etiqueta="Especialidad de los nuevos">
                <select value={esp} onChange={(e) => setEsp(e.target.value)} className="campo">
                  <option value="">Elegir</option>{especialidades.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </Campo>
            )}
            <span className="text-tinta-2">{r.errores ? 'Corrija en el Excel las filas con error y vuelva a cargar el archivo.' : r.nuevos ? 'Los nuevos se registran en la obra elegida.' : ''}</span>
            <button type="button" className="btn-primario ml-auto" disabled={!puede || ocupado} onClick={confirmar}>
              <Icono n="ok" />{modo === 'planilla' ? `Registrar ${pl?.numero ? `semana ${pl.numero}` : 'semana'} en el historial` : 'Importar padrón'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
