# cpad-api

API REST del módulo de asistencia y planilla del ERP CPAD (COEZ PERÚ E.I.R.L.).
**Incremento del Sprint 1:** núcleo y maestros (obras, categorías, especialidades y trabajadores), con carga masiva del padrón.
**Incremento del Sprint 2 (semana 6):** registro diario de asistencia (tareo) con cálculo de horas, tardanza y sobretiempo.
**Sprint 5 (semana 12):** usuarios y roles (HU14) y costo de mano de obra por obra (HU13).

## Requisitos
- Node.js 20 o superior
- PostgreSQL 15 o superior (local o Supabase)

## Puesta en marcha
```bash
npm install
DATABASE_URL=postgres://usuario:clave@host:5432/cpad npm run db:setup
DATABASE_URL=postgres://usuario:clave@host:5432/cpad npm start
```
Para Supabase, añadir `DATABASE_SSL=true`.

En el primer arranque se crea el usuario `admin`. Su clave se toma de `CPAD_ADMIN_CLAVE` o, si no se indica, se genera y se muestra una sola vez en la consola.

## Base de datos de desarrollo
```bash
npm run dev:db   # PostgreSQL embebido en el puerto 54331
```

## Pruebas
```bash
npm test
```
Las pruebas levantan un PostgreSQL embebido temporal, aplican el esquema y los datos iniciales, y ejecutan 55 casos de prueba contra la API.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | /api/salud | Estado del servicio y de la base de datos (no exige sesión) |
| POST | /api/auth/ingresar | Inicia sesión con `usuario` y `clave`; deja una cookie HttpOnly de 12 horas (HU14) |
| POST | /api/auth/salir | Cierra la sesión en el servidor |
| GET | /api/auth/yo | Usuario de la sesión y su rol |
| PUT | /api/auth/clave | Cambia la propia clave (`actual`, `nueva`) y cierra las demás sesiones |
| GET, POST | /api/usuarios | Listar / crear usuarios (solo administrador) |
| PUT | /api/usuarios/:id | Cambiar nombre, rol, clave o estado (solo administrador; siempre queda un administrador activo) |
| GET | /api/planillas/costos[?desde=&hasta=] | Costo de mano de obra por obra, por semana y por categoría, según las planillas registradas (HU13) |
| GET, POST | /api/categorias | Listar / crear categorías |
| GET, PUT, DELETE | /api/categorias/:id | Consultar / editar / dar de baja |
| GET, POST | /api/especialidades | Listar / crear especialidades |
| GET, PUT, DELETE | /api/especialidades/:id | Consultar / editar / dar de baja |
| GET, POST | /api/obras | Listar / crear obras (centros de costo) |
| GET, PUT, DELETE | /api/obras/:id | Consultar / editar / dar de baja |
| GET, POST | /api/trabajadores | Listar (filtros `obra_id`, `categoria_id`, `especialidad_id`, `activo`, `q`) / crear |
| GET | /api/trabajadores/dni/:dni | Buscar por DNI |
| GET | /api/asistencias?obra_id=&fecha= | Hoja del día de una obra, con horas calculadas |
| PUT | /api/asistencias | Registro o corrección de la hoja del día (todo o nada); 409 si la semana está cerrada |
| GET | /api/asistencias/semana?obra_id=&fecha= | Resumen de lunes a domingo por trabajador: días, faltas, horas, sobretiempo, domingo y pendientes |
| POST | /api/asistencias/semana/cierre | Cierra la semana (sábado transcurrido y sin días pendientes) |
| DELETE | /api/asistencias/semana/cierre?obra_id=&fecha= | Reabre una semana cerrada para corregirla |
| POST | /api/trabajadores/lote | Carga masiva del padrón (hasta 500 filas, todo o nada; acepta `categoria`, `especialidad` y `obra` por nombre) |
| GET, PUT, DELETE | /api/trabajadores/:id | Consultar / editar / dar de baja |
| GET | /api/planillas/parametros?fecha= | Parámetros, jornales de tabla y sueldos semanales vigentes |
| GET | /api/planillas/semana?obra_id=&fecha= | Planilla de una semana cerrada: depósito y boleta por trabajador, y los que no se pudieron calcular |
| PUT | /api/planillas/ajustes | Registra las horas extras pagadas y el adelanto de un trabajador en la semana |
| GET | /api/planillas/boletas.pdf?obra_id=&fecha=[&trabajador_id=] | Boletas en PDF (A4 horizontal), de la semana o de un trabajador; si la planilla está registrada, las boletas guardadas |
| POST | /api/planillas/registro | Registra la planilla de una semana cerrada: guarda las boletas tal como se emiten (HU12) |
| DELETE | /api/planillas/registro?obra_id=&fecha= | Anula el registro para corregir la semana |
| GET | /api/planillas/historial?obra_id= | Semanas registradas de la obra, con trabajadores y total depositado |
| GET | /api/planillas/historial/trabajador?dni= | Boletas registradas de un trabajador |
| POST | /api/importaciones/padron[?confirmar=1&obra_id=&especialidad_id=] | Lee la planilla en Excel (.xlsx, cuerpo binario): vista previa, o registra y actualiza el padrón (HU11) |
| POST | /api/importaciones/planilla?obra_id=[&confirmar=1&especialidad_id=] | Lee la planilla de una semana pagada (un archivo por semana): vista previa, o la registra en el historial y actualiza el padrón (HU11) |
| POST | /api/planillas/calculo | Cálculo con horas extras, adelantos o depósitos indicados en la petición |

Toda la API, salvo `/api/salud` y el ingreso, exige sesión. Roles: **ADMINISTRADOR** (todo, incluidos los usuarios), **GERENTE** (consulta todo y registra o anula la planilla semanal) y **CONSULTA** (solo lectura). La clave se guarda con scrypt y sal; la sesión, como hash SHA-256 del token. Tras cinco intentos fallidos el usuario se bloquea diez minutos.

Las bajas son lógicas (`activo = false`) para conservar el histórico de planillas.

Depósito de la semana = sueldo semanal × días ÷ 6 + horas extras × tarifa, redondeado al sol hacia arriba, menos el adelanto entregado.
La boleta desglosa ese depósito según el régimen de construcción civil; el neto coincide con el depósito.
