# CPAD · Módulo web de asistencia y planilla del personal obrero

Proyecto del curso **Prácticas Pre-Profesionales (DD291)** de Ingeniería de Sistemas, Universidad Autónoma del Perú, Ciclo IX (2026).
Practicante: Jhonn Viequier Lindo Barrientos · Empresa: COEZ PERÚ E.I.R.L. · Obra de prueba: I.E. N.° 0159, San Juan de Lurigancho.

El módulo reemplaza la transcripción manual del tareo de obra y el cálculo de la planilla semanal en hoja de cálculo
por un sistema web con base de datos, conforme al régimen de construcción civil.

## Metodología y versiones por sprint

Scrum con un Sprint 0 de análisis (semanas 1 a 3) y sprints de dos semanas. Cada semana de desarrollo deja una versión publicada como rama del repositorio:

| Versión | Sprint · semana | Entregable |
|---|---|---|
| [v0.1.0](../../tree/v0.1.0) | Sprint 1 · semana 4 | Base de datos PostgreSQL y API REST de maestros (trabajadores, obras, categorías, especialidades); 12 pruebas |
| [v0.2.0](../../tree/v0.2.0) | Sprint 1 · semana 5 | Carga masiva del padrón e instalación automatizada de la base; 16 pruebas |
| [v0.3.0](../../tree/v0.3.0) | Sprint 2 · semana 6 | Tareo diario con cálculo de horas y sobretiempo e interfaz web (React, Vite, Tailwind CSS); 23 pruebas |
| [v0.4.0](../../tree/v0.4.0) | Sprint 2 · semana 7 | Resumen y cierre de la asistencia semanal, rediseño visual y regla del almuerzo («de corrido»); 29 pruebas |
| [v0.5.0](../../tree/v0.5.0) | Sprint 3 · semana 8 | Motor de cálculo de la planilla semanal, validado contra 11 boletas reales; 33 pruebas |

## Estructura

- `cpad-api/`: API REST en Node.js 22 con Express 5 sobre PostgreSQL (esquema en `db/schema.sql`, pruebas en `test/`).
- `cpad-web/`: interfaz web en React 19 con Vite y Tailwind CSS.

## Ejecutar las pruebas

```bash
cd cpad-api
npm install
npm test        # levanta un PostgreSQL temporal y ejecuta las pruebas automatizadas
```

## Ejecutar en desarrollo

```bash
cd cpad-api && npm run dev:db                 # PostgreSQL local en el puerto 54331
DATABASE_URL=postgres://cpad:cpad@localhost:54331/cpad npm run db:setup
DATABASE_URL=postgres://cpad:cpad@localhost:54331/cpad npm start   # API en el puerto 3000
cd ../cpad-web && npm install && npm run dev  # interfaz en http://localhost:5173
```

Los datos personales de los trabajadores de la obra no se publican en este repositorio.
