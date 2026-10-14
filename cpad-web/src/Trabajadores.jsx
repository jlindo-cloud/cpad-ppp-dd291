import { useEffect, useState } from 'react';
import { api } from './api.js';
import Categoria from './Categoria.jsx';

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
  const sel = 'rounded border border-linea bg-white px-2 py-2';
  return (
    <form onSubmit={guardar} className="mb-5 rounded border border-linea bg-hoja p-4">
      <h2 className="mb-3 font-semibold">Nuevo trabajador</h2>
      <div className="grid gap-3 md:grid-cols-6">
        <label className="text-sm"><span className="mb-1 block text-xs text-tinta/70">DNI</span>
          <input required inputMode="numeric" maxLength={8} value={f.dni} onChange={campo('dni')} className={`num w-full ${sel}`} /></label>
        <label className="text-sm md:col-span-2"><span className="mb-1 block text-xs text-tinta/70">Apellidos</span>
          <input required value={f.apellidos} onChange={campo('apellidos')} className={`w-full ${sel}`} /></label>
        <label className="text-sm md:col-span-1"><span className="mb-1 block text-xs text-tinta/70">Nombres</span>
          <input required value={f.nombres} onChange={campo('nombres')} className={`w-full ${sel}`} /></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-tinta/70">Categoría</span>
          <select required value={f.categoria_id} onChange={campo('categoria_id')} className={`w-full ${sel}`}>
            <option value="">Elegir</option>{maestros.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="text-sm"><span className="mb-1 block text-xs text-tinta/70">Especialidad</span>
          <select required value={f.especialidad_id} onChange={campo('especialidad_id')} className={`w-full ${sel}`}>
            <option value="">Elegir</option>{maestros.especialidades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label className="text-sm md:col-span-3"><span className="mb-1 block text-xs text-tinta/70">Obra</span>
          <select value={f.obra_id} onChange={campo('obra_id')} className={`w-full ${sel}`}>
            <option value="">Sin obra asignada</option>{maestros.obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nombre}</option>)}</select></label>
        <div className="flex items-end md:col-span-3">
          <button className="rounded bg-coez px-5 py-2 text-sm font-semibold text-white">Registrar trabajador</button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-coez">{error}</p>}
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
    <div className="mb-5 rounded border border-linea bg-hoja p-4">
      <h2 className="font-semibold">Pegar padrón desde Excel</h2>
      <p className="mb-3 text-sm text-tinta/70">Copia de Excel las columnas DNI, apellidos, nombres, categoría y especialidad, en ese orden, y pégalas aquí. Si una fila tiene un error no se registra ninguna.</p>
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} placeholder={'12345678\tPÉREZ QUISPE\tJUAN CARLOS\tOPERARIO\tELECTRICIDAD'}
        className="num w-full rounded border border-linea bg-white p-2 font-mono text-xs" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select value={obra} onChange={(e) => setObra(e.target.value)} className="rounded border border-linea bg-white px-2 py-2 text-sm">
          {maestros.obras.map((o) => <option key={o.id} value={o.codigo}>Asignar a {o.codigo}</option>)}
        </select>
        <button onClick={cargar} disabled={!datos.length} className="rounded bg-coez px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Cargar {datos.length || ''} {datos.length === 1 ? 'trabajador' : 'trabajadores'}
        </button>
        {error && <span role="alert" className="text-sm text-coez">{error}</span>}
      </div>
      {!!errores.length && (
        <ul className="mt-3 space-y-1 text-sm text-coez">
          {errores.map((e) => <li key={e.fila}>Fila {e.fila} (DNI {e.dni || 'vacío'}): {e.errores.join('; ')}.{pista(e)}</li>)}
        </ul>
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
  const boton = (id, texto) => (
    <button onClick={() => setPanel(panel === id ? '' : id)} aria-expanded={panel === id}
      className={`rounded border px-4 py-2 text-sm font-medium ${panel === id ? 'border-tinta bg-tinta text-white' : 'border-tinta hover:bg-white'}`}>{texto}</button>
  );

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Trabajadores</h1>
          <p className="text-sm text-tinta/70">{filas.length} trabajadores activos</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {boton('nuevo', 'Nuevo trabajador')}
          {boton('pegar', 'Pegar padrón desde Excel')}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por apellido o DNI" aria-label="Buscar"
            className="w-64 rounded border border-linea bg-white px-3 py-2 text-sm" />
        </div>
      </header>
      {aviso && <p role="status" className="mb-3 text-sm text-emerald-700">{aviso}</p>}
      {maestros && panel === 'nuevo' && <NuevoTrabajador maestros={maestros} alGuardar={listo} />}
      {maestros && panel === 'pegar' && <PegarPadron maestros={maestros} alGuardar={listo} />}
      <div className="overflow-x-auto rounded border border-linea bg-hoja">
        <table className="w-full text-sm">
          <thead className="bg-fondo text-left text-xs text-tinta/70">
            <tr><th className="px-3 py-2">Apellidos y nombres</th><th className="px-3 py-2">DNI</th><th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Especialidad</th><th className="px-3 py-2">Obra</th><th className="px-3 py-2"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {filas.map((t) => (
              <tr key={t.id} className="border-t border-linea">
                <td className="px-3 py-2 dato-personal">{t.apellidos}, {t.nombres}</td>
                <td className="num px-3 py-2 dato-personal">{t.dni}</td>
                <td className="px-3 py-2"><Categoria nombre={t.categoria} /></td>
                <td className="px-3 py-2">{t.especialidad.charAt(0) + t.especialidad.slice(1).toLowerCase()}</td>
                <td className="px-3 py-2">{t.obra || '—'}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => darDeBaja(t)} className="text-xs text-tinta/60 underline hover:text-coez">Dar de baja</button></td>
              </tr>
            ))}
            {!filas.length && <tr><td colSpan="6" className="px-3 py-6 text-center text-tinta/60">No hay trabajadores que coincidan. Regístralos con “Nuevo trabajador” o “Pegar padrón desde Excel”.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
