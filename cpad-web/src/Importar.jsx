import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Aviso, Campo, Encabezado, Icono } from './ui.jsx';

const ESTADO = {
  nuevo: ['Nuevo', 'bg-[#eef6f1] text-[#1f5c39]'],
  actualiza: ['Actualiza datos', 'bg-[#eef3fb] text-[#1f4e8c]'],
  sin_cambios: ['Sin cambios', 'bg-fondo text-tinta-2'],
  error: ['Error', 'bg-[#fcf0ed] text-coez-osc'],
};
const CAMPO = { fecha_nacimiento: 'fecha de nacimiento', fecha_ingreso: 'fecha de ingreso', banco: 'banco', cuenta_bancaria: 'cuenta', cci: 'CCI' };
const cap = (t) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

async function subir(archivo, q = '') {
  const r = await fetch(`/api/importaciones/padron${q}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: archivo });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `Error ${r.status}`); e.datos = d; throw e; }
  return d;
}

/** HU11 · Importa el padrón (datos personales y bancarios) desde la planilla en Excel de la empresa. */
export default function Importar({ obras, obraId, setObraId }) {
  const [archivo, setArchivo] = useState(null);
  const [vista, setVista] = useState(null);
  const [esp, setEsp] = useState('');
  const [especialidades, setEspecialidades] = useState([]);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { api.get('/especialidades?activo=true').then(setEspecialidades); }, []);

  async function leer(f) {
    setArchivo(f); setVista(null); setAviso(null);
    if (!f) return;
    setOcupado(true);
    try { setVista(await subir(f)); } catch (e) { setAviso({ tono: 'error', texto: e.message }); } finally { setOcupado(false); }
  }
  async function confirmar() {
    setOcupado(true);
    try {
      const r = await subir(archivo, `?confirmar=1&obra_id=${obraId}&especialidad_id=${esp}`);
      setAviso({ tono: 'ok', texto: `Padrón importado: ${r.registrados} ${r.registrados === 1 ? 'trabajador nuevo' : 'trabajadores nuevos'}, ${r.actualizados} ${r.actualizados === 1 ? 'actualizado' : 'actualizados'} y ${r.sin_cambios} sin cambios.` });
      setVista(await subir(archivo));
    } catch (e) { setAviso({ tono: 'error', texto: e.message }); } finally { setOcupado(false); }
  }

  const r = vista?.resumen;
  const puede = r && !r.errores && (r.nuevos + r.actualiza > 0) && (!r.nuevos || esp);
  return (
    <section>
      <Encabezado titulo="Importar desde Excel" detalle="Carga el padrón desde la planilla semanal de la empresa: DNI, categoría, fechas, banco, cuenta y CCI." />

      <div className="rounded-lg border border-linea-2 bg-hoja p-5 shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-[12px] font-medium text-tinta-2">Archivo de la planilla (.xlsx)</span>
            <label className="btn-secundario cursor-pointer">
              <Icono n="importar" />{archivo ? 'Cambiar archivo' : 'Elegir archivo'}
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
                onChange={(e) => { leer(e.target.files[0] || null); e.target.value = ''; }} />
            </label>
            {archivo && <span className="ml-3 text-[13px]">{archivo.name}</span>}
          </div>
          {vista && (
            <div className="text-[13px] text-tinta-2">
              Hoja «{vista.hoja}»{vista.semana ? ` · semana ${vista.semana.numero}, del ${vista.semana.desde} al ${vista.semana.hasta}` : ''} · {r.filas} filas
            </div>
          )}
        </div>
        <p className="mt-3 text-[12px] text-tinta-2">
          Se busca la fila de encabezados con «Apellidos y Nombres» y «DNI». Los trabajadores que ya existen solo actualizan sus datos personales y bancarios;
          su nombre y su categoría no cambian. No se registra nada hasta confirmar.
        </p>
      </div>

      {aviso && <Aviso tono={aviso.tono} icono={aviso.tono === 'ok' ? 'ok' : 'alerta'} className="mt-4">{aviso.texto}</Aviso>}
      {ocupado && <p className="mt-4 text-tinta-2">Leyendo el archivo…</p>}

      {vista && (
        <div className="mt-4 overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          <dl className="num grid grid-cols-2 border-b border-linea-2 md:grid-cols-4">
            {[['Nuevos', r.nuevos], ['Actualizan datos', r.actualiza], ['Sin cambios', r.sin_cambios], ['Con error', r.errores]].map(([k, v], i) => (
              <div key={k} className="border-linea px-4 py-3 [&:not(:first-child)]:border-l">
                <dt className="text-[11.5px] text-tinta-2">{k}</dt>
                <dd className={`titulo mt-0.5 text-[22px] leading-none ${i === 3 && v ? 'text-coez' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[1100px]">
              <thead>
                <tr><th className="w-14 text-right">Fila</th><th>Estado</th><th>DNI</th><th>Apellidos</th><th>Nombres</th><th>Categoría</th>
                  <th>F. nacimiento</th><th>F. ingreso</th><th>Banco</th><th>Cuenta</th><th>Observaciones</th></tr>
              </thead>
              <tbody>
                {vista.filas.map((f) => (
                  <tr key={f.fila} className="align-top">
                    <td className="num text-right text-tinta-2">{f.fila}</td>
                    <td><span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium ${ESTADO[f.estado][1]}`}>{ESTADO[f.estado][0]}</span></td>
                    <td className="num dato-personal">{f.dni}</td>
                    <td className="dato-personal">{f.apellidos}</td>
                    <td className="dato-personal">{f.nombres}</td>
                    <td className="text-[13px]">{cap(f.categoria)}</td>
                    <td className="num dato-personal">{dmy(f.fecha_nacimiento)}</td>
                    <td className="num">{dmy(f.fecha_ingreso)}</td>
                    <td>{f.banco}</td>
                    <td className="num dato-personal text-[13px]">{f.cuenta_bancaria}</td>
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
              <>
                <Campo etiqueta="Obra de los nuevos">
                  <select value={obraId} onChange={(e) => setObraId(e.target.value)} className="campo max-w-[18rem]">
                    {obras.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta="Especialidad de los nuevos">
                  <select value={esp} onChange={(e) => setEsp(e.target.value)} className="campo">
                    <option value="">Elegir</option>{especialidades.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                </Campo>
              </>
            )}
            <span className="text-tinta-2">{r.errores ? 'Corrija en el Excel las filas con error y vuelva a cargar el archivo.' : ''}</span>
            <button type="button" className="btn-primario ml-auto" disabled={!puede || ocupado} onClick={confirmar}><Icono n="ok" />Importar padrón</button>
          </div>
        </div>
      )}
    </section>
  );
}
