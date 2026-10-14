# cpad-api

API REST del módulo de asistencia y planilla del ERP CPAD (COEZ PERÚ E.I.R.L.).
**Incremento del Sprint 1:** núcleo y maestros (obras, categorías, especialidades y trabajadores), con carga masiva del padrón.
**Incremento del Sprint 2 (semana 6):** registro diario de asistencia (tareo) con cálculo de horas, tardanza y sobretiempo.

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

## Base de datos de desarrollo
```bash
npm run dev:db   # PostgreSQL embebido en el puerto 54331
```

## Pruebas
```bash
npm test
```
Las pruebas levantan un PostgreSQL embebido temporal, aplican el esquema y los datos iniciales, y ejecutan 23 casos de prueba contra la API.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| GET | /api/salud | Estado del servicio y de la base de datos |
| GET, POST | /api/categorias | Listar / crear categorías |
| GET, PUT, DELETE | /api/categorias/:id | Consultar / editar / dar de baja |
| GET, POST | /api/especialidades | Listar / crear especialidades |
| GET, PUT, DELETE | /api/especialidades/:id | Consultar / editar / dar de baja |
| GET, POST | /api/obras | Listar / crear obras (centros de costo) |
| GET, PUT, DELETE | /api/obras/:id | Consultar / editar / dar de baja |
| GET, POST | /api/trabajadores | Listar (filtros `obra_id`, `categoria_id`, `especialidad_id`, `activo`, `q`) / crear |
| GET | /api/trabajadores/dni/:dni | Buscar por DNI |
| GET | /api/asistencias?obra_id=&fecha= | Hoja del día de una obra, con horas calculadas |
| PUT | /api/asistencias | Registro o corrección de la hoja del día (todo o nada) |
| POST | /api/trabajadores/lote | Carga masiva del padrón (hasta 500 filas, todo o nada; acepta `categoria`, `especialidad` y `obra` por nombre) |
| GET, PUT, DELETE | /api/trabajadores/:id | Consultar / editar / dar de baja |

Las bajas son lógicas (`activo = false`) para conservar el histórico de planillas.
