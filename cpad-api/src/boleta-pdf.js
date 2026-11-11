'use strict';
// HU10 · Boleta de pago semanal en PDF (A4 horizontal), con el mismo contenido y orden que la boleta que emite la empresa.
const PDFDocument = require('pdfkit');

const n2 = (v) => Number(v || 0).toFixed(2);
const fecha = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-');
const CARGO = { CAPATAZ: 'Capataz', OPERARIO: 'Operario', OFICIAL: 'Oficial', AYUDANTE: 'Peón' };
const AZUL = '#1f4e8c';
const GRIS = '#e6e6e6';

/** Gratificación que se provisiona: julio para semanas de enero a junio, diciembre para julio a diciembre. */
const gratificacion = (inicio) => (Number(inicio.slice(5, 7)) <= 6 ? 'GRATIFICACION JULIO' : 'GRATIFICACION DICIEMBRE');

function tabla(doc, x, y, w, titulo, filas, totales) {
  const h = 15.5;
  doc.lineWidth(0.6).strokeColor('#555');
  doc.rect(x, y, w, h).fillAndStroke(GRIS, '#555');
  doc.fillColor('#000').font('Helvetica').fontSize(8.5).text(titulo, x, y + 4, { width: w, align: 'center' });
  let yy = y + h;
  const fila = (k, v, negrita) => {
    if (negrita) doc.rect(x, yy, w, h).fillAndStroke(GRIS, '#555'); else doc.rect(x, yy, w, h).stroke();
    doc.fillColor('#000').font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
    doc.text(k, x + 5, yy + 4.5, { width: w - 70, lineBreak: false });
    doc.text(v, x + w - 65, yy + 4.5, { width: 60, align: 'right', lineBreak: false });
    yy += h;
  };
  filas.forEach(([k, v]) => fila(k, v, false));
  totales.forEach(([k, v]) => fila(k, v, true));
  return yy;
}

/** Dibuja una boleta en la página actual. */
function dibujar(doc, b, ctx) {
  const { empresa: e, semana, numero, obra } = ctx;
  const M = 36; const W = doc.page.width - 2 * M;
  let y = 40;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(11).text(e.razon_social, M, y);
  doc.text(e.razon_social, M, y, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(6.8).text(e.direccion || '', M, y + 14).text(`RUC: ${e.ruc}`, M, y + 22);

  y = 82;
  doc.font('Helvetica-Bold').fontSize(13).text('BOLETA DE PAGO SEMANAL', M, y, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).text('DS. 001-98-TR', M, y + 17, { width: W, align: 'center' });
  const linea = `SEMANA DEL: ${fecha(semana.inicio)}  AL  ${fecha(semana.sabado)}`;
  const etiqueta = numero ? `SEMANA ${numero}` : '';
  doc.fontSize(8.5);
  const wl = doc.widthOfString(linea); doc.font('Helvetica-Bold'); const we = etiqueta ? doc.widthOfString(etiqueta) + 18 : 0;
  const x0 = M + (W - wl - we) / 2;
  if (etiqueta) doc.fillColor(AZUL).text(etiqueta, x0, y + 29, { lineBreak: false });
  doc.fillColor('#000').font('Helvetica').text(linea, x0 + we, y + 29, { lineBreak: false });
  doc.moveTo(M, y + 43).lineTo(M + W, y + 43).lineWidth(0.5).dash(1.5, { space: 1.5 }).stroke().undash();

  y = 134;
  const campo = (x, yy, k, v) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000').text(`${k}: `, x, yy, { continued: true, lineBreak: false });
    doc.font('Helvetica').text(v || '-', { lineBreak: false });
  };
  const nombre = `${b.apellidos} ${b.nombres}`;
  campo(M, y, 'Empleado', nombre); campo(M, y + 12, 'DNI', b.dni); campo(M, y + 24, 'Cargo', CARGO[b.categoria_pago] || b.categoria_pago);
  campo(M, y + 36, 'Fecha de Nac.', fecha(b.fecha_nacimiento)); campo(M, y + 48, 'Fecha de Ingreso', fecha(b.fecha_ingreso));
  const xm = M + W * 0.36;
  campo(xm, y + 2, 'Banco', b.banco); campo(xm, y + 14, 'Cuenta Bancaria', b.cuenta_bancaria);
  campo(xm, y + 26, 'Centro Costo', obra.centro_costo || obra.nombre); campo(xm, y + 38, 'Especialidad', b.especialidad);
  const xr = M + W * 0.72;
  campo(xr, y + 6, 'Afiliación', b.afiliacion || 'ONP'); campo(xr, y + 18, 'CUSPP', b.cuspp);

  y = 206;
  doc.lineWidth(0.8).strokeColor('#333').rect(M, y, W, 20).stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000');
  doc.text('JORNAL DIARIO - CONST. CIVIL', M + 8, y + 6, { lineBreak: false });
  doc.text(n2(b.jornal), M + 220, y + 6, { lineBreak: false });
  doc.text('DIAS ASIST.', M + W * 0.42, y + 6, { lineBreak: false });
  doc.text(String(b.dias), M + W * 0.58, y + 6, { lineBreak: false });
  doc.text('HRS NORMALES', M + W * 0.71, y + 6, { lineBreak: false });
  doc.text(String(b.dias * 8), M + W * 0.9, y + 6, { lineBreak: false });

  y = 234;
  const gap = 10; const cw = (W - 2 * gap) / 3;
  tabla(doc, M, y, cw, 'Ingresos', [
    ['JORNAL SEMANAL', n2(b.jornal_semanal)], ['DOMINICAL', n2(b.dominical)], ['HORAS EXTRAS 60%', n2(b.horas_extras)],
    ['B.U.C', n2(b.buc)], ['MOVILIDAD ACUMULADA', n2(b.movilidad)], [gratificacion(semana.inicio), n2(b.gratificacion)],
    ['BONIF. EXTRAORD. LEY 29714', n2(b.bonif_extraordinaria)], ['VACACIONES', n2(b.vacaciones)], ['CTS', n2(b.cts)],
  ], [['TOTAL REMUNERACION', n2(b.total_remuneracion)], ['TOTAL NETO', n2(b.neto)]]);
  tabla(doc, M + cw + gap, y, cw, 'Descuentos', [
    ['AFP APORTE PENSION', n2(0)], ['AFP PRIMA SEGUROS', n2(0)], ['ADELANTOS', n2(b.adelantos)], ['SNP', n2(b.snp)],
  ], [['TOTAL DESCUENTO', n2(b.total_descuento)]]);
  tabla(doc, M + 2 * (cw + gap), y, cw, 'Aportes del Empleador', [
    ['ESSALUD', n2(b.essalud)], ['SCTR', n2(b.sctr)], ['SCTR PENSIONES', n2(b.sctr_pension)],
  ], [['TOTAL APORTACIONES', n2(b.total_aportes)]]);

  // Firmas
  y = 500;
  const fw = 230;
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  doc.text(`${e.razon_social}`, M + 40, y - 40, { width: fw, align: 'center' });
  doc.font('Helvetica-Bold').text(e.representante || '', M + 40, y - 26, { width: fw, align: 'center' });
  doc.font('Helvetica').text(e.cargo_representante || '', M + 40, y - 15, { width: fw, align: 'center' });
  doc.moveTo(M + 30, y).lineTo(M + 30 + fw + 20, y).lineWidth(0.6).stroke();
  doc.fontSize(6.8).text(`Empleador / ${e.razon_social}`, M + 30, y + 4, { width: fw + 20, align: 'center' });
  doc.moveTo(M + W - fw - 50, y).lineTo(M + W - 30, y).stroke();
  doc.text(`Firma del Trabajador / ${nombre}`, M + W - fw - 50, y + 4, { width: fw + 20, align: 'center' });
  doc.text(`DNI: ${b.dni}`, M, y + 22, { width: W, align: 'center' });
}

/** Genera un PDF con una boleta por página y lo escribe en el stream indicado. */
function generarBoletas(stream, boletas, ctx) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false,
    info: { Title: `Boletas de pago · ${ctx.semana.inicio}`, Author: ctx.empresa.razon_social, Creator: 'CPAD' } });
  doc.pipe(stream);
  for (const b of boletas) { doc.addPage(); dibujar(doc, b, ctx); }
  doc.end();
  return doc;
}

module.exports = { generarBoletas, gratificacion };
