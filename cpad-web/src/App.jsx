import { useEffect, useState } from 'react';
import Tareo from './Tareo.jsx';
import Semana from './Semana.jsx';
import Trabajadores from './Trabajadores.jsx';
import Obras from './Obras.jsx';
import { Icono } from './ui.jsx';
import { api } from './api.js';
import { hoyLima } from './fechas.js';

const GRUPOS = [
  { nombre: 'Asistencia', secciones: [
    { id: 'tareo', nombre: 'Tareo diario', icono: 'tareo', Componente: Tareo },
    { id: 'semana', nombre: 'Resumen semanal', icono: 'semana', Componente: Semana },
  ] },
  { nombre: 'Maestros', secciones: [
    { id: 'trabajadores', nombre: 'Trabajadores', icono: 'trabajadores', Componente: Trabajadores },
    { id: 'obras', nombre: 'Obras', icono: 'obras', Componente: Obras },
  ] },
];
const SECCIONES = GRUPOS.flatMap((g) => g.secciones);

export default function App() {
  const q = new URLSearchParams(location.search);
  const inicial = q.get('seccion');
  const [actual, setActual] = useState(SECCIONES.some((s) => s.id === inicial) ? inicial : 'tareo');
  // La obra y la fecha elegidas se comparten entre el tareo y el resumen semanal
  const [obras, setObras] = useState([]);
  const [obraId, setObraId] = useState('');
  const [fecha, setFecha] = useState(q.get('fecha') || hoyLima());
  useEffect(() => { api.get('/obras?activo=true').then((o) => { setObras(o); if (o[0]) setObraId(String(o[0].id)); }); }, []);

  const { Componente } = SECCIONES.find((s) => s.id === actual);
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
          {GRUPOS.map((g) => (
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
          <div className="text-white/80">COEZ PERÚ E.I.R.L.</div>
          <div className="mt-0.5">Versión beta 0.4</div>
        </div>
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-7">
        <div className="mx-auto max-w-[1320px]">
          <Componente obras={obras} obra={obra} obraId={obraId} setObraId={setObraId} fecha={fecha} setFecha={setFecha} ir={ir} />
        </div>
      </main>
    </div>
  );
}
