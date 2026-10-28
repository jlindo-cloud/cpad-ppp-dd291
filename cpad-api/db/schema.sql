-- CPAD · Módulo de asistencia y planilla
-- Sprint 1: núcleo y maestros (obras, categorías, especialidades, trabajadores)
-- Motor: PostgreSQL 15+ (compatible con Supabase)

CREATE TABLE IF NOT EXISTS obra (
  id                  SERIAL PRIMARY KEY,
  codigo              VARCHAR(20)  NOT NULL UNIQUE,
  nombre              VARCHAR(150) NOT NULL,
  direccion           VARCHAR(250),
  distrito            VARCHAR(80),
  -- Horario único de obra (turno habitual)
  hora_ingreso        TIME NOT NULL DEFAULT '07:30',
  hora_salida         TIME NOT NULL DEFAULT '17:00',
  hora_salida_sabado  TIME NOT NULL DEFAULT '13:00',
  almuerzo_inicio     TIME NOT NULL DEFAULT '12:00',
  almuerzo_fin        TIME NOT NULL DEFAULT '13:00',
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_obra_horario CHECK (hora_salida > hora_ingreso AND almuerzo_fin > almuerzo_inicio)
);

CREATE TABLE IF NOT EXISTS categoria (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(40) NOT NULL UNIQUE,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS especialidad (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(40) NOT NULL UNIQUE,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trabajador (
  id               SERIAL PRIMARY KEY,
  dni              CHAR(8)      NOT NULL UNIQUE,
  apellidos        VARCHAR(100) NOT NULL,
  nombres          VARCHAR(100) NOT NULL,
  categoria_id     INTEGER NOT NULL REFERENCES categoria(id),
  especialidad_id  INTEGER NOT NULL REFERENCES especialidad(id),
  obra_id          INTEGER REFERENCES obra(id),
  fecha_ingreso    DATE,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_trabajador_dni CHECK (dni ~ '^[0-9]{8}$')
);

CREATE INDEX IF NOT EXISTS ix_trabajador_obra ON trabajador(obra_id);
CREATE INDEX IF NOT EXISTS ix_trabajador_apellidos ON trabajador(apellidos);

-- Mantiene actualizado_en en cada UPDATE
CREATE OR REPLACE FUNCTION fn_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['obra','categoria','especialidad','trabajador'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tg_%1$s_touch ON %1$s', t);
    EXECUTE format('CREATE TRIGGER tg_%1$s_touch BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION fn_touch()', t);
  END LOOP;
END $$;

-- Sprint 2: registro diario de asistencia (tareo)
CREATE TABLE IF NOT EXISTS asistencia (
  id              SERIAL PRIMARY KEY,
  trabajador_id   INTEGER NOT NULL REFERENCES trabajador(id),
  obra_id         INTEGER NOT NULL REFERENCES obra(id),
  fecha           DATE NOT NULL,
  asistio         BOOLEAN NOT NULL DEFAULT TRUE,
  hora_ingreso    TIME,
  hora_salida     TIME,
  observacion     VARCHAR(200),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_asistencia_dia UNIQUE (trabajador_id, fecha),
  CONSTRAINT ck_asistencia_horas CHECK (
    (asistio AND hora_ingreso IS NOT NULL AND (hora_salida IS NULL OR hora_salida > hora_ingreso))
    OR (NOT asistio AND hora_ingreso IS NULL AND hora_salida IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_asistencia_obra_fecha ON asistencia(obra_id, fecha);
DROP TRIGGER IF EXISTS tg_asistencia_touch ON asistencia;
CREATE TRIGGER tg_asistencia_touch BEFORE UPDATE ON asistencia FOR EACH ROW EXECUTE FUNCTION fn_touch();

-- Sprint 2 (semana 7): cierre de la asistencia semanal por obra (lunes a domingo)
CREATE TABLE IF NOT EXISTS semana_cierre (
  obra_id         INTEGER NOT NULL REFERENCES obra(id),
  semana_inicio   DATE NOT NULL,
  cerrado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  observacion     VARCHAR(200),
  PRIMARY KEY (obra_id, semana_inicio),
  CONSTRAINT ck_semana_lunes CHECK (EXTRACT(ISODOW FROM semana_inicio) = 1)
);

-- Semana 7: «de corrido» = el trabajador no tomó la hora de almuerzo (no se descuenta)
ALTER TABLE asistencia ADD COLUMN IF NOT EXISTS de_corrido BOOLEAN NOT NULL DEFAULT FALSE;

-- Sprint 3: motor de cálculo de la planilla semanal (HU07)
-- Jornal, BUC y valor de la hora extra por categoría, con fecha de vigencia (cambian con la convención anual)
CREATE TABLE IF NOT EXISTS jornal_categoria (
  categoria_id      INTEGER NOT NULL REFERENCES categoria(id),
  vigente_desde     DATE NOT NULL,
  jornal            NUMERIC(8,2) NOT NULL CHECK (jornal > 0),
  pct_buc           NUMERIC(5,2) NOT NULL CHECK (pct_buc >= 0),
  valor_hora_extra  NUMERIC(8,2) NOT NULL CHECK (valor_hora_extra >= 0),
  PRIMARY KEY (categoria_id, vigente_desde)
);
-- Porcentajes y factores del cálculo semanal, con fecha de vigencia
CREATE TABLE IF NOT EXISTS parametro_planilla (
  vigente_desde       DATE PRIMARY KEY,
  movilidad_diaria    NUMERIC(8,2) NOT NULL,
  dias_gratificacion  NUMERIC(6,2) NOT NULL,   -- jornales de gratificación ...
  base_gratificacion  NUMERIC(6,2) NOT NULL,   -- ... por cada tantos días laborados
  pct_bonif_extra     NUMERIC(5,2) NOT NULL,   -- Ley N.° 29714, sobre la gratificación
  pct_vacaciones      NUMERIC(5,2) NOT NULL,
  pct_cts             NUMERIC(5,2) NOT NULL,
  pct_snp             NUMERIC(5,2) NOT NULL,
  pct_essalud         NUMERIC(5,2) NOT NULL,
  pct_sctr            NUMERIC(5,2) NOT NULL,
  pct_sctr_pension    NUMERIC(5,2) NOT NULL
);
-- Caso especial: un trabajador puede figurar en el tareo con una categoría y cobrar con otra
ALTER TABLE trabajador ADD COLUMN IF NOT EXISTS categoria_pago_id INTEGER REFERENCES categoria(id);
