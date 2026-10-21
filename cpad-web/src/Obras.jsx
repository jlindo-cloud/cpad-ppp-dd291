import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Encabezado, Rotulo } from './ui.jsx';

const h = (t) => (t ? t.slice(0, 5) : '—');
export default function Obras() {
  const [obras, setObras] = useState([]);
  useEffect(() => { api.get('/obras?activo=true').then(setObras); }, []);
  return (
    <section>
      <Encabezado titulo="Obras" detalle="Cada obra es un centro de costo con su propio horario de trabajo." />
      <div className="space-y-4">
        {obras.map((o) => (
          <article key={o.id} className="overflow-hidden rounded-lg border border-linea-2 bg-hoja shadow-[0_1px_2px_rgba(29,42,54,0.06)]">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-linea-2 px-4 py-3">
              <span className="num rounded bg-tinta px-2 py-0.5 text-[12px] font-medium text-white">{o.codigo}</span>
              <h2 className="titulo text-[17px]">{o.nombre}</h2>
            </div>
            <Rotulo celdas={[
              { etiqueta: 'Dirección', valor: `${o.direccion || '—'}${o.distrito ? `, ${o.distrito}` : ''}`, ancho: 'col-span-2 md:col-span-6' },
              { etiqueta: 'Lunes a viernes', valor: `${h(o.hora_ingreso)} a ${h(o.hora_salida)}`, ancho: 'md:col-span-2' },
              { etiqueta: 'Almuerzo', valor: `${h(o.almuerzo_inicio)} a ${h(o.almuerzo_fin)}`, ancho: 'md:col-span-2' },
              { etiqueta: 'Sábado', valor: `${h(o.hora_ingreso)} a ${h(o.hora_salida_sabado)}`, ancho: 'md:col-span-2' },
            ]} />
          </article>
        ))}
      </div>
    </section>
  );
}
