# cpad-web

Interfaz web del módulo de asistencia y planilla del ERP CPAD (COEZ PERÚ E.I.R.L.), construida con React, Vite y Tailwind CSS.

**Incremento del Sprint 2 (semana 6):** pantallas de trabajadores, obras y tareo diario.

## Puesta en marcha
1. Levantar la API (`cpad-api`) en el puerto 3000.
2. En esta carpeta:
```bash
npm install
npm run dev
```
3. Abrir http://localhost:5173. Las llamadas a `/api` se redirigen a la API.

## Tareo diario
El administrador elige la obra y la fecha, marca a cada trabajador como asistió o faltó, usa
"Completar horas con el horario de la obra" para llenar las horas habituales y corrige solo las que difieren.
Al guardar, la hoja se valida completa: si una fila tiene un error no se guarda ninguna.
