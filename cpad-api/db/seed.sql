-- Datos maestros iniciales (sin datos personales)
INSERT INTO categoria (nombre) VALUES ('CAPATAZ'), ('OPERARIO'), ('OFICIAL'), ('AYUDANTE')
  ON CONFLICT (nombre) DO NOTHING;

INSERT INTO especialidad (nombre) VALUES ('ELECTRICIDAD'), ('ACERO'), ('ENCOFRADO'), ('CONCRETO')
  ON CONFLICT (nombre) DO NOTHING;

INSERT INTO obra (codigo, nombre, direccion, distrito)
VALUES ('IE0159', 'Paquete 02 - I.E. N.° 0159 Glorioso 10 de Octubre',
        'Jr. Peñón Mza. B12 Lote 01, A.H. 10 de Octubre', 'San Juan de Lurigancho')
  ON CONFLICT (codigo) DO NOTHING;

-- Jornales y parámetros de cálculo, tomados de las boletas pagadas por COEZ (semana 30 de 2026).
-- Corresponden a la tabla de la convención colectiva 2024-2025 (operario 86,80 · oficial 68,10 · peón 61,30;
-- BUC 32 % operario y 30 % oficial y peón), que la empresa decidió mantener.
INSERT INTO jornal_categoria (categoria_id, vigente_desde, jornal, pct_buc, valor_hora_extra)
SELECT c.id, DATE '2026-01-01', v.jornal, v.buc, v.he
  FROM (VALUES ('OPERARIO', 86.80, 32, 21.18), ('OFICIAL', 68.10, 30, 16.60)) AS v(cat, jornal, buc, he)
  JOIN categoria c ON c.nombre = v.cat
ON CONFLICT DO NOTHING;
INSERT INTO parametro_planilla VALUES (DATE '2026-01-01', 8.60, 40, 210, 9, 10, 15, 13, 9, 1.55, 1.55)
ON CONFLICT DO NOTHING;

-- Sueldo semanal y tarifa de hora extra que paga COEZ (confirmados por la empresa; las horas extras de la
-- semana 30 se pagaron a S/ 18,00 el operario y S/ 16,00 el oficial; capataz S/ 20,00 y peón S/ 14,00).
INSERT INTO pago_categoria (categoria_id, vigente_desde, sueldo_semanal, tarifa_hora_extra)
SELECT c.id, DATE '2026-01-01', v.sueldo, v.tarifa
  FROM (VALUES ('CAPATAZ', 1200.00, 20.00::numeric), ('OPERARIO', 950.00, 18.00), ('OFICIAL', 800.00, 16.00), ('AYUDANTE', 600.00, 14.00::numeric)) AS v(cat, sueldo, tarifa)
  JOIN categoria c ON c.nombre = v.cat
ON CONFLICT DO NOTHING;
-- Semana 9: tarifas de hora extra de capataz y peón (para bases ya creadas)
UPDATE pago_categoria g SET tarifa_hora_extra = v.tarifa
  FROM (VALUES ('CAPATAZ', 20.00), ('AYUDANTE', 14.00)) AS v(cat, tarifa), categoria c
 WHERE c.nombre = v.cat AND g.categoria_id = c.id AND g.vigente_desde = DATE '2026-01-01' AND g.tarifa_hora_extra IS NULL;

-- Semana 9: peón (categoría AYUDANTE) con el jornal de la misma tabla y su hora extra de S/ 14,00
INSERT INTO jornal_categoria (categoria_id, vigente_desde, jornal, pct_buc, valor_hora_extra)
SELECT c.id, DATE '2026-01-01', 61.30, 30, 14.00 FROM categoria c WHERE c.nombre = 'AYUDANTE'
ON CONFLICT DO NOTHING;
