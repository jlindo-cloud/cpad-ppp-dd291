import { useEffect, useState } from 'react';
import Tareo from './Tareo.jsx';
import Semana from './Semana.jsx';
import Trabajadores from './Trabajadores.jsx';
import Obras from './Obras.jsx';
import Planilla from './Planilla.jsx';
import Historial from './Historial.jsx';
import Importar from './Importar.jsx';
import Costos from './Costos.jsx';
import Usuarios, { ROLES } from './Usuarios.jsx';
import Ingreso from './Ingreso.jsx';
import { Aviso, Icono } from './ui.jsx';
import { api } from './api.js';
import { hoyLima } from './fechas.js';

const GRUPOS = [
  { nombre: 'Asistencia', secciones: [
    { id: 'tareo', nombre: 'Tareo diario', icono: 'tareo', Componente: Tareo },
    { id: 'semana', nombre: 'Resumen semanal', icono: 'semana', Componente: Semana },
  ] },
  { nombre: 'Planilla', secciones: [
    { id: 'planilla', nombre: 'Planilla semanal', icono: 'planilla', Componente: Planilla },
    { id: 'historial', nombre: 'Historial de boletas', icono: 'historial', Componente: Historial },
    { id: 'costos', nombre: 'Costo por obra', icono: 'costo', Componente: Costos },
  ] },
  { nombre: 'Maestros', secciones: [
    { id: 'trabajadores', nombre: 'Trabajadores', icono: 'trabajadores', Componente: Trabajadores },
    { id: 'obras', nombre: 'Obras', icono: 'obras', Componente: Obras },
    { id: 'importar', nombre: 'Importar desde Excel', icono: 'importar', Componente: Importar, roles: ['ADMINISTRADOR'] },
  ] },
  { nombre: 'Seguridad', secciones: [
    { id: 'usuarios', nombre: 'Usuarios y roles', icono: 'usuarios', Componente: Usuarios, roles: ['ADMINISTRADOR'] },
    { id: 'cuenta', nombre: 'Mi cuenta', icono: 'llave', Componente: Usuarios, roles: ['GERENTE', 'CONSULTA'] },
  ] },
];
// Pantallas donde solo el administrador modifica datos: los demás roles las ven en modo consulta
const SOLO_LECTURA = { tareo: 'el tareo', semana: 'el cierre de la semana', planilla: 'los ajustes de la planilla', trabajadores: 'el padrón' };

/** HU14 · La aplicación solo se muestra con una sesión válida. */
export default function App() {
  const [usuario, setUsuario] = useState(undefined); // undefined: verificando; null: sin sesión
  useEffect(() => {
    api.get('/auth/yo').then(setUsuario).catch(() => setUsuario(null));
    const fuera = () => setUsuario(null);
    window.addEventListener('cpad:sin-sesion', fuera);
    return () => window.removeEventListener('cpad:sin-sesion', fuera);
  }, []);
  if (usuario === undefined) return null;
  if (!usuario) return <Ingreso alIngresar={setUsuario} />;
  return <Aplicacion usuario={usuario} salir={async () => { await api.post('/auth/salir').catch(() => {}); setUsuario(null); }} />;
}

function Aplicacion({ usuario, salir }) {
  const q = new URLSearchParams(location.search);
  const grupos = GRUPOS.map((g) => ({ ...g, secciones: g.secciones.filter((s) => !s.roles || s.roles.includes(usuario.rol)) })).filter((g) => g.secciones.length);
  const visibles = grupos.flatMap((g) => g.secciones);
  const inicial = q.get('seccion');
  const [actual, setActual] = useState(visibles.some((s) => s.id === inicial) ? inicial : 'tareo');
  // La obra y la fecha elegidas se comparten entre el tareo y el resumen semanal
  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState('');
  const [fecha, setFecha] = useState(q.get('fecha') || hoyLima());
  useEffect(() => { api.get('/obras?activo=true').then((o) => { setObras(o); if (o[0]) setObraId(String(o[0].id)); }); }, []);

  const { Componente } = visibles.find((s) => s.id === actual) || visibles[0];
  const lectura = usuario.rol !== 'ADMINISTRADOR' && SOLO_LECTURA[actual];
  const obra = obras.find((o) => String(o.id) === obraId);
  const ir = (seccion, f) => { if (f) setFecha(f); setActual(seccion); window.scrollTo(0, 0); };

  return (
    <div className="min-h-screen md:flex">
      <nav aria-label="Secciones" className="shrink-0 bg-tinta text-white md:w-60">
        <div className="md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="grid size-9 place-items-center rounded-md bg-coez">
            <span className="marca text-[13px]">CP</span>
          </div>
          <div className="leading-tight">
            <div className="marca text-[17px]">CPAD</div>
            <div className="text-[12px] text-white/55">Asistencia y planilla</div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:flex-1 md:space-y-5 md:pb-0">
          {grupos.map((g) => (
            <div key={g.nombre} className="contents md:block">
              <div className="hidden px-2 pb-1.5 text-[12px] text-white/45 md:block">{g.nombre}</div>
              <ul className="contents md:block md:space-y-0.5">
                {g.secciones.map((s) => {
                  const activo = actual === s.id;
                  return (
                    <li key={s.id} className="shrink-0">
                      <button onClick={() => ir(s.id)} aria-current={activo ? 'page' : undefined}
                        className={`relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] transition-colors ${activo ? 'bg-white/10 font-medium text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}>
                        {activo && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 hidden w-[3px] rounded-r bg-coez md:block" />}
                        <Icono n={s.icono} className={`size-[18px] ${activo ? 'text-white' : 'text-white/55'}`} />
                        {s.nombre}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="hidden border-t border-white/10 px-5 py-4 text-[12px] text-white/50 md:block">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] font-semibold text-white">{usuario.nombre.split(' ').filter((p) => /^[A-ZÁÉÍÓÚÑ]/.test(p)).map((p) => p[0]).slice(0, 2).join('')}</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] text-white/90">{usuario.nombre}</div>
              <div>{ROLES[usuario.rol].nombre}</div>
            </div>
            <button onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión" className="ml-auto grid size-8 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"><Icono n="salir" className="size-[18px]" /></button>
          </div>
          <div className="mt-3 text-white/80">COEZ PERÚ E.I.R.L.</div>
          <div className="mt-0.5">Versión beta 0.9</div>
        </div>
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-7">
        <div className="mx-auto max-w-[1320px]">
          {lectura && <Aviso icono="candado" className="mb-4">Modo consulta: con el rol {ROLES[usuario.rol].nombre.toLowerCase()} puedes ver {lectura}, pero no modificarlo{usuario.rol === 'GERENTE' && actual === 'planilla' ? '. Sí puedes registrar o anular la planilla de la semana' : ''}.</Aviso>}
          <Componente usuario={usuario} obras={obras} obra={obra} obraId={obraId} setObraId={setObraId} fecha={fecha} setFecha={setFecha} ir={ir} />
        </div>
      </main>
    </div>
  );
}
