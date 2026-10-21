// La categoría conserva el color del formato impreso, como una muestra junto al nombre
const COLOR = { CAPATAZ: 'bg-capataz', OFICIAL: 'bg-oficial', OPERARIO: 'bg-operario', AYUDANTE: 'bg-ayudante' };
export default function Categoria({ nombre, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] ${className}`}>
      <span aria-hidden="true" className={`size-2.5 rounded-[2px] ring-1 ring-tinta/15 ${COLOR[nombre] || 'bg-linea'}`} />
      {nombre.charAt(0) + nombre.slice(1).toLowerCase()}
    </span>
  );
}
