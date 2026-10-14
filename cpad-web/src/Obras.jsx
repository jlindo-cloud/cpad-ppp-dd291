import { useEffect, useState } from 'react';
import { api } from './api.js';

const h = (t) => (t ? t.slice(0, 5) : '—');
export default function Obras() {
  const [obras, setObras] = useState([]);
  useEffect(() => { api.get('/obras?activo=true').then(setObras); }, []);
  return (
    <section>
      <h1 className="mb-5 text-2xl font-bold">Obras</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {obras.map((o) => (
          <article key={o.id} className="rounded border border-linea bg-hoja p-5">
            <div className="text-sm font-semibold text-coez">{o.codigo}</div>
            <h2 className="mt-1 text-lg font-semibold leading-snug">{o.nombre}</h2>
            <p className="mt-1 text-sm text-tinta/70">{o.direccion}{o.distrito ? `, ${o.distrito}` : ''}</p>
            <dl className="num mt-4 grid grid-cols-3 gap-2 border-t border-linea pt-3 text-sm">
              <div><dt className="text-xs text-tinta/60">Lunes a viernes</dt><dd>{h(o.hora_ingreso)} a {h(o.hora_salida)}</dd></div>
              <div><dt className="text-xs text-tinta/60">Almuerzo</dt><dd>{h(o.almuerzo_inicio)} a {h(o.almuerzo_fin)}</dd></div>
              <div><dt className="text-xs text-tinta/60">Sábado</dt><dd>{h(o.hora_ingreso)} a {h(o.hora_salida_sabado)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
