# cpad-api

API REST del módulo de asistencia y planilla del ERP CPAD (COEZ PERÚ E.I.R.L.).
**Incremento del Sprint 1:** núcleo y maestros (obras, categorías, especialidades y trabajadores), con carga masiva del padrón.

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

## Pruebas
```bash
npm test
```
Las pruebas levantan un PostgreSQL embebido temporal, aplican el esquema y los datos iniciales, y ejecutan 16 casos de prueba contra la API.

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
| POST | /api/trabajadores/lote | Carga masiva del padrón (hasta 500 filas, todo o nada; acepta `categoria`, `especialidad` y `obra` por nombre) |
| GET, PUT, DELETE | /api/trabajadores/:id | Consultar / editar / dar de baja |

Las bajas son lógicas (`activo = false`) para conservar el histórico de planillas.
