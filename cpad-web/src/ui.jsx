// Piezas de interfaz compartidas por las pantallas del módulo
const P = {
  tareo: 'M9 4h6M8 3h8v3H8zM6 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M8 12l2.5 2.5L16 9',
  semana: 'M4 6h16M4 6v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6M4 6V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1M8 2v4M16 2v4M4 11h16M9 11v9M14 11v9',
  trabajadores: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM21 19v-1a4 4 0 0 0-3-3.87M15 4.13a3 3 0 0 1 0 5.74',
  obras: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6',
  candado: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  abierto: 'M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5z',
  izq: 'M15 18l-6-6 6-6',
  der: 'M9 18l6-6-6-6',
  alerta: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ok: 'M20 6 9 17l-5-5',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  mas: 'M12 5v14M5 12h14',
  pegar: 'M9 4h6M8 3h8v3H8zM6 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1M8 12h8M8 16h5',
  reloj: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
};
export function Icono({ n, className = 'size-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={P[n]} />
    </svg>
  );
}

/** Encabezado de página: título a la izquierda, controles a la derecha. */
export function Encabezado({ titulo, detalle, children }) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="mr-auto min-w-0">
        <h1 className="titulo text-[26px] leading-tight">{titulo}</h1>
        {detalle && <p className="mt-1 text-tinta-2">{detalle}</p>}
      </div>
      {children}
    </header>
  );
}

export function Campo({ etiqueta, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-tinta-2">{etiqueta}</span>
      {children}
    </label>
  );
}

/**
 * Rótulo de la hoja: la cabecera en celdas del formato impreso y de los planos de obra.
 * celdas: [{ etiqueta, valor, ancho }] — ancho en columnas de una rejilla de 12.
 */
export function Rotulo({ celdas }) {
  return (
    <div className="grid grid-cols-2 border-b border-linea-2 md:grid-cols-12">
      {celdas.map((c, i) => (
        <div key={i} className={`border-linea px-4 py-2.5 md:border-l md:first:border-l-0 ${c.ancho || 'md:col-span-2'} ${c.className || ''}`}>
          <div className="text-[11.5px] text-tinta-2">{c.etiqueta}</div>
          <div className="num mt-0.5 truncate font-medium">{c.valor}</div>
        </div>
      ))}
    </div>
  );
}

const TONO = {
  ok: 'border-ok/30 bg-[#eef6f1] text-[#1f5c39]',
  error: 'border-coez/30 bg-[#fcf0ed] text-coez-osc',
  pend: 'border-pend/30 bg-[#fbf4e6] text-[#7a4c0b]',
  info: 'border-linea-2 bg-white text-tinta',
};
export function Aviso({ tono = 'info', icono, children, className = '' }) {
  return (
    <div role={tono === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 ${TONO[tono]} ${className}`}>
      {icono && <Icono n={icono} className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const horas = (n) => (n == null ? '' : Number(n).toFixed(2).replace(/\.?0+$/, '').replace('.', ','));
