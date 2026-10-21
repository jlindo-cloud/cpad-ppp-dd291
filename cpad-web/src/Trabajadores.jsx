import { useEffect, useState } from 'react';
import { api } from './api.js';
import Categoria from './Categoria.jsx';
import { Aviso, Campo, Encabezado, Icono } from './ui.jsx';

const pista = (e) => (e.dni && /^\d{7}$/.test(e.dni) ? ' Si el DNI empieza con 0, es posible que Excel lo haya quitado: verifícalo en el documento.' : '');
const VACIO = { dni: '', apellidos: '', nombres: '', categoria_id: '', especialidad_id: '', obra_id: '' };

function NuevoTrabajador({ maestros, alGuardar }) {
  const [f, setF] = useState({ ...VACIO, obra_id: maestros.obras[0]?.id ?? '' });
  const [error, setError] = useState('');
  const campo = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function guardar(e) {
    e.preventDefault(); setError('');
    try {
      await api.post('/trabajadores', { ...f, obra_id: f.obra_id || null });
      setF({ ...VACIO, obra_id: f.obra_id }); alGuardar('Trabajador registrado.');
    } catch (err) { setError([err.message, ...(err.datos?.detalles || [])].join('. ')); }
  }
  const sel = 'campo';
  return (
    <form onSubmit={guardar} className="mb-5 rounded-lg border border-linea-2 bg-hoja p-5 shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
      <h2 className="titulo mb-4 text-[17px]">Nuevo trabajador</h2>
      <div className="grid gap-3 md:grid-cols-6">
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-tinta-2">DNI</span>
          <input required inputMode="numeric" maxLength={8} value={f.dni} onChange={campo('dni')} className={`num w-full ${sel}`} /></label>
        <label className="block md:col-span-2"><span className="mb-1 block text-[12px] font-medium text-tinta-2">Apellidos</span>
          <input required value={f.apellidos} onChange={campo('apellidos')} className={`w-full ${sel}`} /></label>
        <label className="block md:col-span-1"><span className="mb-1 block text-[12px] font-medium text-tinta-2">Nombres</span>
          <input required value={f.nombres} onChange={campo('nombres')} className={`w-full ${sel}`} /></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-tinta-2">Categoría</span>
          <select required value={f.categoria_id} onChange={campo('categoria_id')} className={`w-full ${sel}`}>
            <option value="">Elegir</option>{maestros.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-tinta-2">Especialidad</span>
          <select required value={f.especialidad_id} onChange={campo('especialidad_id')} className={`w-full ${sel}`}>
            <option value="">Elegir</option>{maestros.especialidades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="block md:col-span-3"><span className="mb-1 block text-[12px] font-medium text-tinta-2">Obra</span>
          <select value={f.obra_id} onChange={campo('obra_id')} className={`w-full ${sel}`}>
            <option value="">Sin obra asignada</option>{maestros.obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nombre}</option>)}</select></label>
        <div className="flex items-end md:col-span-3">
          <button className="btn-primario">Registrar trabajador</button>
        </div>
      </div>
      {error && <Aviso tono="error" icono="alerta" className="mt-4">{error}</Aviso>}
    </form>
  );
}

function PegarPadron({ maestros, alGuardar }) {
  const [texto, setTexto] = useState('');
  const [obra, setObra] = useState(maestros.obras[0]?.codigo ?? '');
  const [errores, setErrores] = useState([]);
  const [error, setError] = useState('');
  const filas = texto.split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c.some(Boolean));
  const datos = filas.length && !/^\d+$/.test(filas[0][0]) ? filas.slice(1) : filas; // omite la fila de títulos
  async function cargar() {
    setErrores([]); setError('');
    const lote = datos.map(([dni, apellidos, nombres, categoria, especialidad]) => ({ dni, apellidos, nombres, categoria, especialidad, obra: obra || null }));
    try {
      const r = await api.post('/trabajadores/lote', { trabajadores: lote });
      setTexto(''); alGuardar(`Padrón cargado: ${r.insertados} trabajadores.`);
    } catch (e) { setError(e.message); setErrores(e.datos?.errores || []); }
  }
  return (
    <div className="mb-5 rounded-lg border border-linea-2 bg-hoja p-5 shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
      <h2 className="titulo text-[17px]">Pegar padrón desde Excel</h2>
      <p className="mb-3 mt-1 max-w-[75ch] text-tinta-2">Copia de Excel las columnas DNI, apellidos, nombres, categoría y especialidad, en ese orden, y pégalas aquí. Si una fila tiene un error no se registra ninguna.</p>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} placeholder={'12345678\tPÉREZ QUISPE\tJUAN CARLOS\tOPERARIO\tELECTRICIDAD'}
        className="num w-full rounded-md border border-linea-2 bg-white p-2.5 text-[13px] hover:border-tinta-2" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select value={obra} onChange={(e) => setObra(e.target.value)} className="campo">
          {maestros.obras.map((o) => <option key={o.id} value={o.codigo}>Asignar a {o.codigo}</option>)}
        </select>
        <button onClick={cargar} disabled={!datos.length} className="btn-primario">
          Cargar {datos.length || ''} {datos.length === 1 ? 'trabajador' : 'trabajadores'}
        </button>
      </div>
      {error && (
        <Aviso tono="error" icono="alerta" className="mt-4">
          {error}
          {!!errores.length && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {errores.map((e) => <li key={e.fila}>Fila {e.fila} (DNI {e.dni || 'vacío'}): {e.errores.join('; ')}.{pista(e)}</li>)}
            </ul>
          )}
        </Aviso>
      )}
    </div>
  );
}

export default function Trabajadores() {
  const [filas, setFilas] = useState([]);
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(new URLSearchParams(location.search).get('panel') || '');
  const [aviso, setAviso] = useState('');
  const [maestros, setMaestros] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    Promise.all([api.get('/categorias?activo=true'), api.get('/especialidades?activo=true'), api.get('/obras?activo=true')])
      .then(([categorias, especialidades, obras]) => setMaestros({ categorias, especialidades, obras }));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/trabajadores?activo=true' + (q ? '&q=' + encodeURIComponent(q) : '')).then(setFilas).catch((e) => setAviso(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, version]);

  const listo = (msg) => { setAviso(msg); setVersion((v) => v + 1); };
  async function darDeBaja(t) {
    if (!confirm(`¿Dar de baja a ${t.apellidos}, ${t.nombres}? Dejará de aparecer en el tareo, pero se conserva su historial.`)) return;
    await api.del(`/trabajadores/${t.id}`); listo('Trabajador dado de baja.');
  }
  const boton = (id, texto, icono) => (
    <button onClick={() => setPanel(panel === id ? '' : id)} aria-expanded={panel === id}
      className={panel === id ? 'btn border border-tinta bg-tinta text-white' : 'btn-secundario'}><Icono n={icono} />{texto}</button>
  );

  return (
    <section>
      <Encabezado titulo="Trabajadores" detalle={`${filas.length} trabajadores activos${q ? ' que coinciden con la búsqueda' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          {boton('nuevo', 'Nuevo trabajador', 'mas')}
          {boton('pegar', 'Pegar padrón desde Excel', 'pegar')}
        </div>
      </Encabezado>
      {aviso && <Aviso tono="ok" icono="ok" className="mb-4">{aviso}</Aviso>}
      {maestros && panel === 'nuevo' && <NuevoTrabajador maestros={maestros} alGuardar={listo} />}
      {maestros && panel === 'pegar' && <PegarPadron maestros={maestros} alGuardar={listo} />}
      <div className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
        <div className="flex items-center gap-2 border-b border-linea-2 px-4 py-2.5">
          <Icono n="buscar" className="size-4 text-tinta-2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por apellido o DNI" aria-label="Buscar por apellido o DNI"
            className="h-8 w-full max-w-sm bg-transparent outline-none placeholder:text-tinta-2/60" />
        </div>
        <div className="overflow-x-auto">
        <table className="tabla w-full">
          <thead>
            <tr><th className="w-10 text-right">N.°</th><th>Apellidos y nombres</th><th>DNI</th><th>Categoría</th><th>Especialidad</th><th>Obra</th><th><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {filas.map((t, i) => (
              <tr key={t.id} className="group">
                <td className="num text-right text-tinta-2">{i + 1}</td>
                <td className="font-medium"><span className="dato-personal">{t.apellidos}, {t.nombres}</span></td>
                <td className="num text-tinta-2"><span className="dato-personal">{t.dni}</span></td>
                <td><Categoria nombre={t.categoria} /></td>
                <td>{t.especialidad.charAt(0) + t.especialidad.slice(1).toLowerCase()}</td>
                <td className="num">{t.obra || '—'}</td>
                <td className="text-right"><button onClick={() => darDeBaja(t)} className="btn-quieto h-7 text-[13px] opacity-70 group-hover:opacity-100 focus:opacity-100">Dar de baja</button></td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan="7" className="py-10 text-center text-tinta-2">No hay trabajadores que coincidan. Regístralos con “Nuevo trabajador” o “Pegar padrón desde Excel”.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}
