const COLOR = { CAPATAZ: 'bg-capataz', OFICIAL: 'bg-oficial', OPERARIO: 'bg-operario', AYUDANTE: 'bg-ayudante' };
export default function Categoria({ nombre }) {
  return (
    <span className={`inline-block min-w-20 rounded-sm px-2 py-0.5 text-center text-xs font-semibold ${COLOR[nombre] || 'bg-linea'}`}>
      {nombre.charAt(0) + nombre.slice(1).toLowerCase()}
    </span>
  );
}
