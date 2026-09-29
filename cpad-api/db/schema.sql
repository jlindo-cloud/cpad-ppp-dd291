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
