'use strict';
// Plantilla oficial para importar la planilla semanal a CPAD (HU11): mismo formato que la planilla de la empresa.
// Uso: node scripts/plantilla-excel.js <salida.xlsx> [filas de ejemplo ficticias: 0|1]
const ExcelJS = require('exceljs');
const salida = process.argv[2] || 'plantilla_planilla_semanal.xlsx';
const ejemplo = process.argv[3] === '1';
const N = 40; // filas de trabajadores disponibles

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SEM 30', { views: [{ state: 'frozen', ySplit: 9 }] });
  const azul = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  const amarillo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  const borde = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

  // Tabla de sueldos por categoría (D1:G5)
  ws.getRow(1).values = [null, null, null, 'CATEGORIA', 'SUELDO', 'X DIA', 'HORA'];
  [['Capataz', 1200, 20], ['Operario', 950, 18], ['Oficial', 800, 16], ['Peón', 600, 14]].forEach(([c, s, h], i) => {
    const r = 2 + i;
    ws.getCell(`D${r}`).value = c; ws.getCell(`E${r}`).value = s; ws.getCell(`G${r}`).value = h;
    ws.getCell(`F${r}`).value = { formula: `ROUND(E${r}/6,2)` };
  });
  for (let r = 1; r <= 5; r++) for (const c of 'DEFG') ws.getCell(`${c}${r}`).border = borde;
  ws.getRow(1).font = { bold: true };

  ws.getCell('B3').value = 'COEZ'; ws.getCell('B3').font = { bold: true, size: 14 };
  ws.getCell('B4').value = '(SEMANA 30) 28/09 AL 03/10'; ws.getCell('B4').font = { bold: true, size: 14 };
  ws.getCell('B4').fill = amarillo;
  ws.getCell('B5').value = '← Cambie el número de semana y las fechas (lunes AL sábado). Un archivo por semana.';
  ws.getCell('B5').font = { italic: true, size: 9, color: { argb: 'FF7F7F7F' } };
  ws.getCell('B8').value = 'PERSONAL EN OBRA'; ws.getCell('B8').font = { bold: true };
  ws.getCell('M8').value = 'HORAS SEM SIGUIENTE'; ws.getCell('M8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.getCell('M8').alignment = { wrapText: true }; ws.getCell('M8').font = { size: 9 };

  const H = ['#', 'Apellidos y Nombres', 'Categoria', 'DNI', 'Fecha Nacimiento', 'Fecha Ingreso', 'Banco', 'Nº Cuenta', 'CCI',
    'DIAS ASIST', 'DSCTO', 'SUELDO', 'HORAS', 'TOT HOR', 'TOTAL PAGO'];
  const hdr = ws.getRow(9); hdr.values = H; hdr.height = 30;
  hdr.eachCell((c) => { c.fill = azul; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = borde; });

  const ej = ejemplo ? [
    ['QUISPE MAMANI JUAN CARLOS', 'Operario', '70000101', '15/01/1980', '01/09/2026', 'BCP', '191-70000101-0-00', '00219100700001010000', 5, 0, 2],
    ['HUAMAN FLORES LUIS ALBERTO', 'Peón', '70000102', '15/02/1981', '01/09/2026', 'BBVA', '0011-0000-0000000102', '', 6, 50, 3],
  ] : [];
  const fin = 9 + N;
  for (let i = 0; i < N; i++) {
    const r = 10 + i; const row = ws.getRow(r);
    row.getCell(1).value = { formula: `IF(B${r}="","",ROW()-9)` };
    const e = ej[i];
    if (e) {
      [2, 3, 4, 5, 6, 7, 8, 9].forEach((c, k) => { row.getCell(c).value = e[k] || null; });
      row.getCell(10).value = e[8]; row.getCell(11).value = e[9] || null; row.getCell(13).value = e[10];
    }
    // SUELDO = sueldo semanal × días ÷ 6, al sol hacia arriba; TOT HOR = horas × tarifa; TOTAL PAGO = SUELDO + TOT HOR − DSCTO
    row.getCell(12).value = { formula: `IF(OR(C${r}="",J${r}=""),"",ROUNDUP(VLOOKUP(C${r},$D$2:$G$5,2,FALSE)*J${r}/6,0))` };
    row.getCell(14).value = { formula: `IF(C${r}="","",N(M${r})*VLOOKUP(C${r},$D$2:$G$5,4,FALSE))` };
    row.getCell(15).value = { formula: `IF(L${r}="","",L${r}+N${r}-N(K${r}))` };
    for (let c = 1; c <= 15; c++) row.getCell(c).border = borde;
    for (const c of [4, 5, 6, 8, 9]) row.getCell(c).numFmt = '@'; // texto: no pierde ceros iniciales
    row.getCell(3).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Capataz,Operario,Oficial,Peón"'],
      showErrorMessage: true, errorTitle: 'Categoría', error: 'Elija Capataz, Operario, Oficial o Peón' };
    row.getCell(10).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 6], showErrorMessage: true, error: 'De 0 a 6 días' };
    for (const c of [11, 13]) row.getCell(c).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Debe ser 0 o más' };
    for (const c of [12, 14, 15]) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  }
  ws.getCell(`N${fin + 1}`).value = 'TOTAL'; ws.getCell(`N${fin + 1}`).font = { bold: true };
  ws.getCell(`O${fin + 1}`).value = { formula: `SUM(O10:O${fin})` }; ws.getCell(`O${fin + 1}`).font = { bold: true };
  ws.getCell(`N${fin + 1}`).fill = ws.getCell(`O${fin + 1}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.columns.forEach((c, i) => { c.width = [4, 34, 11, 11, 12, 12, 9, 22, 24, 7, 8, 9, 8, 9, 11][i]; });

  const ins = wb.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 110;
  [
    'PLANTILLA PARA IMPORTAR LA PLANILLA SEMANAL A CPAD',
    '',
    '1. Use un archivo por semana. En la celda B4 escriba el título: (SEMANA N) dd/mm AL dd/mm, del lunes al sábado.',
    '2. Llene una fila por trabajador, desde la fila 10. Deje vacía la primera fila después del último trabajador.',
    '3. Categoría: elija Capataz, Operario, Oficial o Peón.',
    '4. DNI, Nº de cuenta y CCI van como texto para no perder los ceros iniciales. El CCI tiene 20 dígitos.',
    '5. Fechas en formato dd/mm/aaaa.',
    '6. DIAS ASIST: días trabajados en la semana del título (0 a 6).',
    '7. HORAS: horas extras de la semana siguiente, que se pagan con esta semana («semana adentro»).',
    '8. DSCTO: adelantos y descuentos varios (por ejemplo, pérdida de herramientas). Se restan del depósito y no se imprimen en la boleta.',
    '9. SUELDO, TOT HOR y TOTAL PAGO se calculan solos (celdas grises). TOTAL PAGO = SUELDO + TOT HOR − DSCTO, y es lo que se deposita.',
    '10. Si cambian los sueldos o las tarifas, actualice la tabla de categorías (D1:G5).',
    '11. En CPAD: Importar desde Excel → Semana pagada → elija la obra y el archivo. Revise la vista previa antes de registrar.',
  ].forEach((t, i) => { const c = ins.getCell(`A${i + 1}`); c.value = t; c.alignment = { wrapText: true }; if (!i) c.font = { bold: true, size: 13 }; });

  await wb.xlsx.writeFile(salida);
  console.log('Generada', salida);
})();
