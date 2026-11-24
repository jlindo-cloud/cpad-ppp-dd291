import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Aviso, Campo, Encabezado, Icono } from './ui.jsx';
import { fechaHora } from './fechas.js';

export const ROLES = {
  ADMINISTRADOR: { nombre: 'Administrador', detalle: 'Registra el tareo, la planilla y los maestros; gestiona usuarios.' },
  GERENTE: { nombre: 'Gerente', detalle: 'Consulta todo y registra o anula la planilla semanal.' },
  CONSULTA: { nombre: 'Consulta', detalle: 'Solo consulta; no modifica datos.' },
};
const err = (e) => [e.message, ...(e.datos?.detalles || [])].join('. ');

function NuevoUsuario({ alGuardar }) {
  const [f, setF] = useState({ usuario: '', nombre: '', rol: 'CONSULTA', clave: '' });
  const [error, setError] = useState('');
  const c = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function guardar(e) {
    e.preventDefault(); setError('');
    try { await api.post('/usuarios', f); setF({ usuario: '', nombre: '', rol: 'CONSULTA', clave: '' }); alGuardar('Usuario creado.'); } catch (x) { setError(err(x)); }
  }
  return (
    <form onSubmit={guardar} className="mb-5 rounded-lg border border-linea-2 bg-hoja p-5 shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
      <h2 className="titulo mb-4 text-[17px]">Nuevo usuario</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <Campo etiqueta="Usuario"><input required value={f.usuario} onChange={c('usuario')} autoComplete="off" placeholder="p. ej. hgomez" className="campo w-full" /></Campo>
        <Campo etiqueta="Nombre"><input required value={f.nombre} onChange={c('nombre')} className="campo w-full" /></Campo>
        <Campo etiqueta="Rol">
          <select value={f.rol} onChange={c('rol')} className="campo w-full">
            {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Clave inicial"><input required type="password" value={f.clave} onChange={c('clave')} autoComplete="new-password" className="campo w-full" /></Campo>
      </div>
      <p className="mt-2 text-[12.5px] text-tinta-2">{ROLES[f.rol].detalle} La clave debe tener al menos 8 caracteres, con letras y números.</p>
      <button className="btn-primario mt-4">Crear usuario</button>
      {error && <Aviso tono="error" icono="alerta" className="mt-4">{error}</Aviso>}
    </form>
  );
}

function MiClave({ alGuardar }) {
  const [f, setF] = useState({ actual: '', nueva: '', repite: '' });
  const [error, setError] = useState('');
  async function guardar(e) {
    e.preventDefault(); setError('');
    if (f.nueva !== f.repite) return setError('La nueva clave y su confirmación no coinciden');
    try { await api.put('/auth/clave', { actual: f.actual, nueva: f.nueva }); setF({ actual: '', nueva: '', repite: '' }); alGuardar('Tu clave se cambió. Las demás sesiones abiertas se cerraron.'); } catch (x) { setError(err(x)); }
  }
  const c = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={guardar} className="rounded-lg border border-linea-2 bg-hoja p-5 shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
      <h2 className="titulo mb-4 flex items-center gap-2 text-[17px]"><Icono n="llave" className="size-[18px]" />Cambiar mi clave</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <Campo etiqueta="Clave actual"><input required type="password" value={f.actual} onChange={c('actual')} autoComplete="current-password" className="campo w-full" /></Campo>
        <Campo etiqueta="Nueva clave"><input required type="password" value={f.nueva} onChange={c('nueva')} autoComplete="new-password" className="campo w-full" /></Campo>
        <Campo etiqueta="Repetir la nueva clave"><input required type="password" value={f.repite} onChange={c('repite')} autoComplete="new-password" className="campo w-full" /></Campo>
      </div>
      <button className="btn-secundario mt-4">Cambiar clave</button>
      {error && <Aviso tono="error" icono="alerta" className="mt-4">{error}</Aviso>}
    </form>
  );
}

/** HU14 · Usuarios y roles. El administrador ve la lista; todos pueden cambiar su clave. */
export default function Usuarios({ usuario }) {
  const admin = usuario.rol === 'ADMINISTRADOR';
  const [filas, setFilas] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => { if (admin) api.get('/usuarios').then(setFilas).catch((e) => setAviso({ tono: 'error', t: e.message })); }, [admin, version]);
  const listo = (t) => { setAviso({ tono: 'ok', t }); setVersion((v) => v + 1); setNuevo(false); };
  async function cambiar(u, datos, msg) {
    try { await api.put(`/usuarios/${u.id}`, datos); listo(msg); } catch (e) { setAviso({ tono: 'error', t: err(e) }); }
  }

  return (
    <section>
      <Encabezado titulo={admin ? 'Usuarios y roles' : 'Mi cuenta'}
        detalle={admin ? 'Cada persona ingresa con su cuenta; el rol define lo que puede hacer.' : `${usuario.nombre} · ${ROLES[usuario.rol].nombre}`}>
        {admin && <button onClick={() => setNuevo(!nuevo)} aria-expanded={nuevo} className={nuevo ? 'btn border border-tinta bg-tinta text-white' : 'btn-secundario'}><Icono n="mas" />Nuevo usuario</button>}
      </Encabezado>
      {aviso && <Aviso tono={aviso.tono} icono={aviso.tono === 'ok' ? 'ok' : 'alerta'} className="mb-4">{aviso.t}</Aviso>}
      {admin && nuevo && <NuevoUsuario alGuardar={listo} />}
      {admin && (
        <div className="mb-6 overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
          <div className="overflow-x-auto">
            <table className="tabla w-full min-w-[720px]">
              <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Último ingreso</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {filas.map((u) => (
                  <tr key={u.id} className={u.activo ? '' : 'text-tinta-2'}>
                    <td className="num font-medium">{u.usuario}{u.id === usuario.id && <span className="ml-2 rounded bg-fondo px-1.5 py-0.5 text-[11px] text-tinta-2">tú</span>}</td>
                    <td>{u.nombre}</td>
                    <td>
                      <select value={u.rol} disabled={!u.activo} aria-label={`Rol de ${u.usuario}`}
                        onChange={(e) => cambiar(u, { rol: e.target.value }, `Rol de ${u.usuario} actualizado.`)} className="campo-sm">
                        {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.nombre}</option>)}
                      </select>
                    </td>
                    <td className="num text-tinta-2">{u.ultimo_ingreso ? fechaHora(u.ultimo_ingreso) : 'Nunca'}</td>
                    <td>{u.activo ? <span className="text-ok">Activo</span> : 'Dado de baja'}</td>
                    <td className="text-right">
                      {u.id !== usuario.id && (u.activo
                        ? <button className="btn-quieto h-7 text-[13px]" onClick={() => confirm(`¿Dar de baja a ${u.usuario}? Se cerrarán sus sesiones.`) && cambiar(u, { activo: false }, `${u.usuario} dado de baja.`)}>Dar de baja</button>
                        : <button className="btn-quieto h-7 text-[13px]" onClick={() => cambiar(u, { activo: true }, `${u.usuario} reactivado.`)}>Reactivar</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-x-6 gap-y-1 border-t border-linea-2 bg-fondo/60 px-4 py-3 text-[12.5px] text-tinta-2 md:grid-cols-3">
            {Object.values(ROLES).map((r) => <div key={r.nombre}><span className="font-medium text-tinta">{r.nombre}:</span> {r.detalle}</div>)}
          </div>
        </div>
      )}
      <MiClave alGuardar={(t) => setAviso({ tono: 'ok', t })} />
    </section>
  );
}
