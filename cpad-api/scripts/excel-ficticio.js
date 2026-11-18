'use strict';
// Genera una planilla en Excel con el formato de la empresa y datos ficticios, para probar la importación (HU11).
// Uso: node scripts/excel-ficticio.js <salida.xlsx> [titulo] [dscto del primer trabajador]
// Ejemplo: node scripts/excel-ficticio.js semana29.xlsx "(SEMANA 29) 21/09 AL 26/09" 50
const ExcelJS = require('exceljs');
const B = require('../test/boletas_semana30.json').boletas;

const AP = ['QUISPE MAMANI', 'HUAMAN FLORES', 'ROJAS TORRES', 'MENDOZA CASTILLO', 'VARGAS RAMOS', 'CHAVEZ RIVERA', 'GUTIERREZ SALAZAR', 'RAMIREZ PAREDES', 'CRUZ MEDINA', 'DIAZ ESPINOZA', 'TORRES VEGA'];
const NO = ['JUAN CARLOS', 'LUIS ALBERTO', 'PEDRO', 'MIGUEL ANGEL', 'JOSE LUIS', 'CARLOS', 'VICTOR HUGO', 'RAUL', 'JORGE', 'FERNANDO', 'OSCAR'];
const CAT = { CAPATAZ: 'Capataz', OPERARIO: 'Operario', OFICIAL: 'Oficial', AYUDANTE: 'Peón' };
const SUELDO = { Capataz: [1200, 20], Operario: [950, 18], Oficial: [800, 16], 'Peón': [600, 14] };

(async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('SEM 30');
  ws.getRow(1).values = [null, null, null, 'CATEGORIA', 'SUELDO', 'X DIA', 'HORA'];
  Object.entries(SUELDO).forEach(([k, [s, h]], i) => { ws.getRow(2 + i).values = [null, null, null, k, s, Math.round((s / 6) * 100) / 100, h]; });
  ws.getCell('B3').value = 'COEZ'; ws.getCell('B4').value = process.argv[3] || '(SEMANA 30) 28/09 AL 03/10';
  ws.name = (process.argv[3] || '(SEMANA 30)').match(/SEMANA \d+/)[0].replace('SEMANA', 'SEM');
  ws.getCell('B8').value = 'PERSONAL EN OBRA';
  ws.getRow(9).values = ['#', 'Apellidos y Nombres', 'Categoria', 'DNI', 'Fecha Nacimiento', 'Fecha Ingreso', 'Banco', 'Nº Cuenta', 'CCI',
    'DIAS ASIST', 'DSCTO', 'SUELDO', 'HORAS', 'TOT HOR', 'TOTAL PAGO'];
  const filas = B.map((b, i) => {
    const cat = CAT[b.categoria_sueldo || b.categoria_pago]; const [s, h] = SUELDO[cat];
    const sueldo = Math.ceil((s * b.dias) / 6); const he = b.horas_extras * h;
    const dscto = i === 0 ? Number(process.argv[4] || 0) : 0;
    return [`${AP[i]} ${NO[i]}`, cat, String(70000101 + i), `15/0${1 + (i % 9)}/19${80 + i}`, '01/09/2026', 'BCP', `191-${70000101 + i}-0-00`,
      `0021910${String(70000101 + i)}00000`.slice(0, 20), b.dias, dscto || null, sueldo, b.horas_extras, he, sueldo + he - dscto];
  });
  filas.push(['DE LA CRUZ SOTO MARIO', 'Oficial', 7000112, '20/06/1993', '28/09/2026', 'BBVA', '0011-0000-0000000112', null, 6, null, 800, 0, 0, 800]);
  filas.forEach((f, i) => { ws.getRow(10 + i).values = [i + 1, ...f]; });
  const tot = 10 + filas.length;
  ws.getCell(`N${tot}`).value = 'TOTAL'; ws.getCell(`O${tot}`).value = filas.reduce((a, f) => a + f[13], 0);
  ws.columns.forEach((c, i) => { c.width = [4, 34, 11, 11, 12, 12, 8, 22, 24][i] || 10; });
  const hdr = ws.getRow(9); hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } }; });
  await wb.xlsx.writeFile(process.argv[2] || 'planilla_ficticia.xlsx');
  console.log('Generado', process.argv[2] || 'planilla_ficticia.xlsx');
})();
