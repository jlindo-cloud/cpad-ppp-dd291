import { useState } from 'react';
import Tareo from './Tareo.jsx';
import Trabajadores from './Trabajadores.jsx';
import Obras from './Obras.jsx';

const SECCIONES = [
  { id: 'tareo', nombre: 'Tareo diario', Componente: Tareo },
  { id: 'trabajadores', nombre: 'Trabajadores', Componente: Trabajadores },
  { id: 'obras', nombre: 'Obras', Componente: Obras },
];

export default function App() {
  const inicial = new URLSearchParams(location.search).get('seccion') || 'tareo';
  const [actual, setActual] = useState(SECCIONES.some((s) => s.id === inicial) ? inicial : 'tareo');
  const { Componente } = SECCIONES.find((s) => s.id === actual);
  return (
    <div className="flex min-h-screen">
      <nav className="w-52 shrink-0 bg-tinta px-4 py-6 text-white">
        <div className="mb-8">
          <div className="text-2xl font-bold tracking-tight">CPAD</div>
          <div className="text-sm text-white/60">Asistencia y planilla</div>
          <span className="mt-2 inline-block rounded-sm bg-capataz px-1.5 py-0.5 text-xs font-semibold text-tinta">Beta 0.3</span>
        </div>
        <ul className="space-y-1">
          {SECCIONES.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setActual(s.id)}
                aria-current={actual === s.id ? 'page' : undefined}
                className={`w-full rounded px-3 py-2 text-left text-sm ${actual === s.id ? 'bg-white text-tinta font-semibold' : 'text-white/80 hover:bg-white/10'}`}
              >{s.nombre}</button>
            </li>
          ))}
        </ul>
        <div className="mt-10 border-t border-white/15 pt-4 text-xs text-white/50">COEZ PERÚ E.I.R.L.</div>
      </nav>
      <main className="min-w-0 flex-1 px-8 py-6"><Componente /></main>
    </div>
  );
}
