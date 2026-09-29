-- Datos maestros iniciales (sin datos personales)
INSERT INTO categoria (nombre) VALUES ('CAPATAZ'), ('OPERARIO'), ('OFICIAL'), ('AYUDANTE')
  ON CONFLICT (nombre) DO NOTHING;

INSERT INTO especialidad (nombre) VALUES ('ELECTRICIDAD'), ('ACERO'), ('ENCOFRADO'), ('CONCRETO')
  ON CONFLICT (nombre) DO NOTHING;

INSERT INTO obra (codigo, nombre, direccion, distrito)
VALUES ('IE0159', 'Paquete 02 - I.E. N.° 0159 Glorioso 10 de Octubre',
        'Jr. Peñón Mza. B12 Lote 01, A.H. 10 de Octubre', 'San Juan de Lurigancho')
  ON CONFLICT (codigo) DO NOTHING;
