// Fechas en formato AAAA-MM-DD, calculadas a mediodía UTC para no depender de la zona horaria del equipo
export const hoyLima = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const d = (f) => new Date(f + 'T12:00:00Z');
export const diaSemana = (f) => d(f).getUTCDay(); // 0 = domingo
export const sumar = (f, n) => { const x = d(f); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const lunesDe = (f) => sumar(f, -((diaSemana(f) + 6) % 7));
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
export const diaNum = (f) => Number(f.slice(8, 10));
/** «lunes 12 de octubre de 2026» */
export const larga = (f) => `${DIAS[diaSemana(f)]} ${diaNum(f)} de ${MESES[Number(f.slice(5, 7)) - 1]} de ${f.slice(0, 4)}`;
/** «12 al 18 de octubre de 2026» o «28 de setiembre al 4 de octubre de 2026» */
export function rango(a, b) {
  const ma = MESES[Number(a.slice(5, 7)) - 1], mb = MESES[Number(b.slice(5, 7)) - 1];
  return ma === mb ? `${diaNum(a)} al ${diaNum(b)} de ${mb} de ${b.slice(0, 4)}` : `${diaNum(a)} de ${ma} al ${diaNum(b)} de ${mb} de ${b.slice(0, 4)}`;
}
export const corta = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
export const fechaHora = (ts) => new Date(ts).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
