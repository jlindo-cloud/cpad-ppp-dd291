'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../src/app');

let pg, pool, app;
const PORT = 54329;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpad-pg-'));
  fs.chmodSync(dir, 0o777); // si se ejecuta como root, initdb corre con otro usuario
  pg = new EmbeddedPostgres({ databaseDir: path.join(dir, 'data'), user: 'cpad', password: 'cpad', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('cpad_test');
  pool = new Pool({ connectionString: `postgres://cpad:cpad@localhost:${PORT}/cpad_test` });
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/seed.sql'), 'utf8'));
  app = createApp(pool);
});

after(async () => {
  await pool?.end();
  await pg?.stop();
});

test('CP01 salud: la API responde y conecta con PostgreSQL', async () => {
  const r = await request(app).get('/api/salud');
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'ok');
});

test('CP02 catálogos: categorías y especialidades iniciales cargadas', async () => {
  const c = await request(app).get('/api/categorias');
  assert.deepEqual(c.body.map((x) => x.nombre).sort(), ['AYUDANTE', 'CAPATAZ', 'OFICIAL', 'OPERARIO']);
  const e = await request(app).get('/api/especialidades');
  assert.deepEqual(e.body.map((x) => x.nombre).sort(), ['ACERO', 'CONCRETO', 'ELECTRICIDAD', 'ENCOFRADO']);
});

test('CP03 catálogos: rechaza especialidad duplicada (409)', async () => {
  const r = await request(app).post('/api/especialidades').send({ nombre: 'acero' });
  assert.equal(r.status, 409);
});

test('CP04 obras: la obra inicial trae el horario único de obra', async () => {
  const r = await request(app).get('/api/obras');
  assert.equal(r.status, 200);
  const o = r.body.find((x) => x.codigo === 'IE0159');
  assert.ok(o);
  assert.equal(o.hora_ingreso, '07:30:00');
  assert.equal(o.hora_salida, '17:00:00');
  assert.equal(o.hora_salida_sabado, '13:00:00');
});

test('CP05 obras: crea, edita y da de baja lógica un centro de costo', async () => {
  const c = await request(app).post('/api/obras').send({ codigo: 'PRUEBA01', nombre: 'Obra de prueba' });
  assert.equal(c.status, 201);
  const u = await request(app).put(`/api/obras/${c.body.id}`).send({ codigo: 'PRUEBA01', nombre: 'Obra de prueba editada', hora_salida: '17:30' });
  assert.equal(u.status, 200);
  assert.equal(u.body.nombre, 'Obra de prueba editada');
  const d = await request(app).delete(`/api/obras/${c.body.id}`);
  assert.equal(d.body.activo, false);
  const act = await request(app).get('/api/obras?activo=true');
  assert.ok(!act.body.some((x) => x.id === c.body.id));
});

test('CP06 obras: rechaza hora con formato inválido (400)', async () => {
  const r = await request(app).post('/api/obras').send({ codigo: 'X1', nombre: 'X', hora_ingreso: '7.30' });
  assert.equal(r.status, 400);
});

async function ids() {
  const cat = (await request(app).get('/api/categorias')).body.find((x) => x.nombre === 'OFICIAL').id;
  const esp = (await request(app).get('/api/especialidades')).body.find((x) => x.nombre === 'ELECTRICIDAD').id;
  const obra = (await request(app).get('/api/obras')).body.find((x) => x.codigo === 'IE0159').id;
  return { cat, esp, obra };
}

test('CP07 trabajadores: registra un trabajador y lo devuelve con sus maestros', async () => {
  const { cat, esp, obra } = await ids();
  const r = await request(app).post('/api/trabajadores').send({
    dni: '12345678', apellidos: 'Pérez Rojas', nombres: 'Juan', categoria_id: cat, especialidad_id: esp, obra_id: obra, fecha_ingreso: '2026-09-29',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.apellidos, 'PÉREZ ROJAS');
  const g = await request(app).get('/api/trabajadores/dni/12345678');
  assert.equal(g.status, 200);
  assert.equal(g.body.categoria, 'OFICIAL');
  assert.equal(g.body.especialidad, 'ELECTRICIDAD');
  assert.equal(g.body.obra, 'IE0159');
});

test('CP08 trabajadores: rechaza DNI que no tiene 8 dígitos (400)', async () => {
  const { cat, esp } = await ids();
  for (const dni of ['1234567', '123456789', 'ABCDEFGH']) {
    const r = await request(app).post('/api/trabajadores').send({ dni, apellidos: 'A', nombres: 'B', categoria_id: cat, especialidad_id: esp });
    assert.equal(r.status, 400, dni);
  }
});

test('CP09 trabajadores: rechaza DNI duplicado (409)', async () => {
  const { cat, esp } = await ids();
  const r = await request(app).post('/api/trabajadores').send({ dni: '12345678', apellidos: 'Otro', nombres: 'Nombre', categoria_id: cat, especialidad_id: esp });
  assert.equal(r.status, 409);
});

test('CP10 trabajadores: rechaza categoría inexistente (409)', async () => {
  const { esp } = await ids();
  const r = await request(app).post('/api/trabajadores').send({ dni: '87654321', apellidos: 'A', nombres: 'B', categoria_id: 9999, especialidad_id: esp });
  assert.equal(r.status, 409);
});

test('CP11 trabajadores: filtra por obra y busca por apellido o DNI', async () => {
  const { obra } = await ids();
  const f = await request(app).get(`/api/trabajadores?obra_id=${obra}`);
  assert.equal(f.body.length, 1);
  const q1 = await request(app).get('/api/trabajadores?q=pérez');
  assert.equal(q1.body.length, 1);
  const q2 = await request(app).get('/api/trabajadores?q=1234');
  assert.equal(q2.body.length, 1);
});

test('CP12 errores: id inválido, recurso inexistente y JSON mal formado', async () => {
  assert.equal((await request(app).get('/api/trabajadores/abc')).status, 400);
  assert.equal((await request(app).get('/api/trabajadores/9999')).status, 404);
  const r = await request(app).post('/api/obras').set('Content-Type', 'application/json').send('{mal');
  assert.equal(r.status, 400);
});

test('CP13 lote: carga varios trabajadores usando nombres de categoría, especialidad y obra', async () => {
  const r = await request(app).post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '20000001', apellidos: 'Uno Prueba', nombres: 'Ana', categoria: 'Operario', especialidad: 'Electricidad', obra: 'IE0159' },
    { dni: '20000002', apellidos: 'Dos Prueba', nombres: 'Luis', categoria: 'CAPATAZ', especialidad: 'ELECTRICIDAD', obra: 'IE0159' },
    { dni: '20000003', apellidos: 'Tres Prueba', nombres: 'Rosa', categoria: 'ayudante', especialidad: 'concreto' },
  ] });
  assert.equal(r.status, 201);
  assert.equal(r.body.insertados, 3);
  const g = await request(app).get('/api/trabajadores/dni/20000002');
  assert.equal(g.body.categoria, 'CAPATAZ');
});

test('CP14 lote: si una fila falla no se registra ninguna y se informa la fila', async () => {
  const antes = (await request(app).get('/api/trabajadores')).body.length;
  const r = await request(app).post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '30000001', apellidos: 'Valido', nombres: 'Uno', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '3000000', apellidos: 'Dni Corto', nombres: 'Dos', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '30000003', apellidos: 'Sin Categoria', nombres: 'Tres', categoria: 'MAESTRO', especialidad: 'ACERO' },
  ] });
  assert.equal(r.status, 400);
  assert.equal(r.body.insertados, 0);
  assert.deepEqual(r.body.errores.map((e) => e.fila), [2, 3]);
  const despues = (await request(app).get('/api/trabajadores')).body.length;
  assert.equal(despues, antes);
});

test('CP15 lote: detecta DNI repetido en el lote y DNI ya registrado', async () => {
  const r = await request(app).post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '40000001', apellidos: 'A', nombres: 'B', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '40000001', apellidos: 'C', nombres: 'D', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '12345678', apellidos: 'E', nombres: 'F', categoria: 'OFICIAL', especialidad: 'ACERO' },
  ] });
  assert.equal(r.status, 400);
  assert.match(r.body.errores[0].errores.join(), /repetido/);
  assert.match(r.body.errores[1].errores.join(), /ya registrado/);
});

test('CP16 lote: rechaza lote vacío o con más de 500 filas', async () => {
  assert.equal((await request(app).post('/api/trabajadores/lote').send({ trabajadores: [] })).status, 400);
  const muchas = Array.from({ length: 501 }, (_, i) => ({ dni: String(50000000 + i), apellidos: 'X', nombres: 'Y', categoria: 'OFICIAL', especialidad: 'ACERO' }));
  assert.equal((await request(app).post('/api/trabajadores/lote').send({ trabajadores: muchas })).status, 400);
});

// ---------------- Sprint 2: asistencia (tareo) ----------------
async function hoja(fecha) {
  const obra = (await request(app).get('/api/obras')).body.find((x) => x.codigo === 'IE0159').id;
  const r = await request(app).get(`/api/asistencias?obra_id=${obra}&fecha=${fecha}`);
  return { obra, r };
}

test('CP17 tareo: la hoja del día lista a los trabajadores de la obra, sin registros todavía', async () => {
  const { r } = await hoja('2026-09-21');
  assert.equal(r.status, 200);
  assert.ok(r.body.filas.length >= 3);
  assert.equal(r.body.resumen.registrados, 0);
  assert.equal(r.body.filas[0].categoria, 'CAPATAZ'); // el capataz encabeza la hoja, como en el formato impreso
});

test('CP18 tareo: registra la hoja de un lunes y calcula horas y sobretiempo', async () => {
  const { obra, r } = await hoja('2026-09-21');
  const [a, b, c] = r.body.filas;
  const p = await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-21', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '19:00' },
    { trabajador_id: b.trabajador_id, hora_ingreso: '07:30', hora_salida: '17:00' },
    { trabajador_id: c.trabajador_id, asistio: false, observacion: 'Falta' },
  ] });
  assert.equal(p.status, 200);
  assert.equal(p.body.guardados, 3);
  const h = (await hoja('2026-09-21')).r.body;
  const f = Object.fromEntries(h.filas.map((x) => [x.trabajador_id, x]));
  assert.equal(f[a.trabajador_id].sobretiempo_h, 2);
  assert.equal(f[a.trabajador_id].horas_trabajadas, 10.5);
  assert.equal(f[b.trabajador_id].horas_trabajadas, 8.5);
  assert.equal(f[b.trabajador_id].sobretiempo_h, 0);
  assert.deepEqual([h.resumen.asistieron, h.resumen.faltaron, h.resumen.sobretiempo_h], [2, 1, 2]);
});

test('CP19 tareo: corregir la hoja actualiza el registro sin duplicarlo', async () => {
  const { obra, r } = await hoja('2026-09-21');
  const a = r.body.filas[0];
  await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-21', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '20:00' }] });
  const h = (await hoja('2026-09-21')).r.body;
  assert.equal(h.resumen.registrados, 3);
  assert.equal(h.filas.find((x) => x.trabajador_id === a.trabajador_id).sobretiempo_h, 3);
});

test('CP20 tareo: el sábado usa la salida de las 13:00 y descuenta almuerzo solo si la jornada se extiende', async () => {
  const { obra, r } = await hoja('2026-09-26');
  const [a, b] = r.body.filas;
  await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-26', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '13:00' },
    { trabajador_id: b.trabajador_id, hora_ingreso: '07:30', hora_salida: '15:00' }] });
  const f = (await hoja('2026-09-26')).r.body.filas;
  assert.equal(f.find((x) => x.trabajador_id === a.trabajador_id).horas_trabajadas, 5.5);
  assert.equal(f.find((x) => x.trabajador_id === a.trabajador_id).sobretiempo_h, 0);
  // Salida 15:00 sin «de corrido»: almorzó de 13:00 a 14:00
  assert.equal(f.find((x) => x.trabajador_id === b.trabajador_id).horas_trabajadas, 6.5);
  assert.equal(f.find((x) => x.trabajador_id === b.trabajador_id).sobretiempo_h, 1);
});

test('CP21 tareo: registra la tardanza respecto del horario de la obra', async () => {
  const { obra, r } = await hoja('2026-09-22');
  const a = r.body.filas[0];
  await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-22', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '08:15', hora_salida: '17:00' }] });
  const f = (await hoja('2026-09-22')).r.body.filas.find((x) => x.trabajador_id === a.trabajador_id);
  assert.equal(f.tardanza_min, 45);
  assert.equal(f.horas_trabajadas, 7.75);
});

test('CP22 tareo: si una fila es inválida no se guarda ninguna', async () => {
  const { obra, r } = await hoja('2026-09-23');
  const [a, b, c] = r.body.filas;
  const p = await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-23', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '17:00' },
    { trabajador_id: b.trabajador_id, hora_ingreso: '17:00', hora_salida: '07:30' },
    { trabajador_id: c.trabajador_id, asistio: false, hora_ingreso: '07:30' },
    { trabajador_id: 999999, hora_ingreso: '07:30' }] });
  assert.equal(p.status, 400);
  assert.deepEqual(p.body.errores.map((e) => e.fila), [2, 3, 4]);
  assert.equal((await hoja('2026-09-23')).r.body.resumen.registrados, 0);
});

test('CP23 tareo: rechaza fechas futuras y parámetros incompletos', async () => {
  const { obra, r } = await hoja('2026-09-21');
  const p = await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2099-01-05', registros: [
    { trabajador_id: r.body.filas[0].trabajador_id, hora_ingreso: '07:30' }] });
  assert.equal(p.status, 400);
  assert.equal((await request(app).get('/api/asistencias?obra_id=1')).status, 400);
  assert.equal((await request(app).get('/api/asistencias?obra_id=9999&fecha=2026-09-21')).status, 404);
});

// ---------- Semana 7: resumen semanal y cierre (HU06) ----------
async function obraSemana() {
  const o = await request(app).post('/api/obras').send({ codigo: 'SEM01', nombre: 'Obra para pruebas de semana' });
  const lote = await request(app).post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '50000001', apellidos: 'Semana Uno', nombres: 'Ana', categoria: 'OPERARIO', especialidad: 'ELECTRICIDAD', obra: 'SEM01' },
    { dni: '50000002', apellidos: 'Semana Dos', nombres: 'Beto', categoria: 'OFICIAL', especialidad: 'ELECTRICIDAD', obra: 'SEM01' }] });
  assert.equal(lote.status, 201);
  const ts = (await request(app).get(`/api/trabajadores?obra_id=${o.body.id}`)).body;
  return { obra: o.body.id, a: ts.find((x) => x.dni === '50000001').id, b: ts.find((x) => x.dni === '50000002').id };
}
const dia = (obra, fecha, registros) => request(app).put('/api/asistencias').send({ obra_id: obra, fecha, registros });
let S;

test('CP24 semana: resume por trabajador días, faltas, horas, sobretiempo y domingo', async () => {
  S = await obraSemana();
  const L = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
  for (const f of L) {
    const p = await dia(S.obra, f, [
      { trabajador_id: S.a, hora_ingreso: '07:30', hora_salida: '19:00' },
      f === '2026-09-30' ? { trabajador_id: S.b, asistio: false } : { trabajador_id: S.b, hora_ingreso: '07:30', hora_salida: '17:00' }]);
    assert.equal(p.status, 200);
  }
  await dia(S.obra, '2026-10-03', [
    { trabajador_id: S.a, hora_ingreso: '07:30', hora_salida: '16:00', de_corrido: true, observacion: 'De corrido' },
    { trabajador_id: S.b, hora_ingreso: '07:30', hora_salida: '13:00' }]);
  await dia(S.obra, '2026-10-04', [{ trabajador_id: S.a, hora_ingreso: '07:30', hora_salida: '12:30' }]);
  const r = await request(app).get(`/api/asistencias/semana?obra_id=${S.obra}&fecha=2026-10-01`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.semana.inicio, r.body.semana.fin], ['2026-09-28', '2026-10-04']);
  const a = r.body.filas.find((x) => x.trabajador_id === S.a);
  const b = r.body.filas.find((x) => x.trabajador_id === S.b);
  assert.deepEqual([a.dias_asistidos, a.faltas, a.horas_trabajadas, a.sobretiempo_h, a.horas_domingo], [6, 0, 61, 13, 5]);
  assert.deepEqual([b.dias_asistidos, b.faltas, b.horas_trabajadas, b.sobretiempo_h, b.sin_marcar], [5, 1, 39.5, 0, 0]);
  assert.equal(a.dias[6].estado, 'A');
  assert.equal(r.body.cierre, null);
});

test('CP25 semana: no se cierra si hay días sin marcar o sin hora de salida', async () => {
  const lote = await request(app).post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '50000003', apellidos: 'Semana Tres', nombres: 'Ciro', categoria: 'AYUDANTE', especialidad: 'ELECTRICIDAD', obra: 'SEM01', fecha_ingreso: '2026-10-02' }] });
  assert.equal(lote.status, 201);
  const c = (await request(app).get('/api/trabajadores/dni/50000003')).body.id;
  const r = await request(app).post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 409);
  // Ingresó el viernes: solo viernes y sábado cuentan como pendientes, no los días previos a su ingreso
  assert.deepEqual(r.body.pendientes.map((p) => [p.trabajador_id, p.sin_marcar]), [[c, 2]]);
  await dia(S.obra, '2026-10-02', [{ trabajador_id: c, hora_ingreso: '07:30' }]);
  await dia(S.obra, '2026-10-03', [{ trabajador_id: c, asistio: false }]);
  const r2 = await request(app).post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.pendientes[0].sin_salida, 1);
  await dia(S.obra, '2026-10-02', [{ trabajador_id: c, hora_ingreso: '07:30', hora_salida: '17:00' }]);
});

test('CP26 semana: el cierre bloquea la corrección de cualquier día de esa semana', async () => {
  const r = await request(app).post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-10-02', observacion: 'Revisada' });
  assert.equal(r.status, 201);
  assert.ok(r.body.cierre.cerrado_en);
  assert.equal((await request(app).post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' })).status, 409);
  const p = await dia(S.obra, '2026-10-04', [{ trabajador_id: S.b, hora_ingreso: '07:30', hora_salida: '12:00' }]);
  assert.equal(p.status, 409);
  const h = await request(app).get(`/api/asistencias?obra_id=${S.obra}&fecha=2026-09-29`);
  assert.equal(h.body.semana_cerrada, true);
});

test('CP27 semana: la reapertura permite volver a corregir', async () => {
  const d = await request(app).delete(`/api/asistencias/semana/cierre?obra_id=${S.obra}&fecha=2026-09-30`);
  assert.equal(d.status, 200);
  assert.equal(d.body.cierre, null);
  assert.equal((await dia(S.obra, '2026-09-30', [{ trabajador_id: S.b, hora_ingreso: '07:30', hora_salida: '17:00' }])).status, 200);
  assert.equal((await request(app).delete(`/api/asistencias/semana/cierre?obra_id=${S.obra}&fecha=2026-09-30`)).status, 404);
});

test('CP28 semana: no se cierra una semana que aún no termina', async () => {
  const r = await request(app).post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2099-01-05' });
  assert.equal(r.status, 400);
  assert.equal((await request(app).get(`/api/asistencias/semana?obra_id=${S.obra}`)).status, 400);
});

test('CP29 tareo: «de corrido» no descuenta el almuerzo y suma esa hora al sobretiempo', async () => {
  const { obra, r } = await hoja('2026-09-24');
  const [a, b] = r.body.filas;
  await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-24', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '17:00', de_corrido: true },
    { trabajador_id: b.trabajador_id, hora_ingreso: '07:30', hora_salida: '17:00' }] });
  const f = (await hoja('2026-09-24')).r.body.filas;
  const fa = f.find((x) => x.trabajador_id === a.trabajador_id), fb = f.find((x) => x.trabajador_id === b.trabajador_id);
  assert.deepEqual([fa.de_corrido, fa.horas_trabajadas, fa.sobretiempo_h], [true, 9.5, 1]);
  assert.deepEqual([fb.de_corrido, fb.horas_trabajadas, fb.sobretiempo_h], [false, 8.5, 0]);
  await request(app).put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-26', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '16:00', de_corrido: true }] });
  const s = (await hoja('2026-09-26')).r.body.filas.find((x) => x.trabajador_id === a.trabajador_id);
  assert.deepEqual([s.horas_trabajadas, s.sobretiempo_h], [8.5, 3]);
});

// ---------- Sprint 3 · HU07: motor de cálculo de la planilla ----------
const { calcularBoleta } = require('../src/planilla');
const B30 = require('./boletas_semana30.json');

test('CP30 planilla: el motor reproduce al céntimo las 11 boletas reales de la semana 30', async () => {
  const pr = (await request(app).get('/api/planillas/parametros?fecha=2026-09-28')).body;
  const J = Object.fromEntries(pr.jornales.map((j) => [j.categoria, j]));
  for (const b of B30.boletas) {
    const j = J[b.categoria_pago];
    const r = calcularBoleta({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: b.dias, horas_extras: b.horas_extras, depositado: b.depositado }, pr.parametros);
    for (const [k, v] of Object.entries(b.esperado)) assert.equal(r[k], v, `boleta ${b.boleta}: ${k}`);
  }
});

test('CP31 planilla: solo se calcula sobre una semana cerrada', async () => {
  const r = await request(app).post('/api/planillas/calculo').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 409);
});

test('CP32 planilla: exige jornal vigente para la categoría con la que se paga', async () => {
  assert.equal((await request(app).post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' })).status, 201);
  const r = await request(app).post('/api/planillas/calculo').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 400);
  assert.equal(r.body.errores.length, 1); // el ayudante aún no tiene jornal registrado
  assert.match(r.body.errores[0].errores[0], /jornal vigente/);
});

test('CP33 planilla: calcula la semana cerrada con horas extras, depósito y categoría de pago especial', async () => {
  const c = (await request(app).get('/api/trabajadores/dni/50000003')).body;
  const op = (await request(app).get('/api/categorias')).body.find((x) => x.nombre === 'OPERARIO').id;
  const u = await request(app).put(`/api/trabajadores/${c.id}`).send({ dni: c.dni, apellidos: c.apellidos, nombres: c.nombres, categoria_id: c.categoria_id,
    especialidad_id: c.especialidad_id, obra_id: c.obra_id, fecha_ingreso: c.fecha_ingreso, categoria_pago_id: op });
  assert.equal(u.status, 200);
  const r = await request(app).post('/api/planillas/calculo').send({ obra_id: S.obra, fecha: '2026-09-28',
    horas_extras: { [S.a]: 2 }, depositado: { [S.a]: 1000 } });
  assert.equal(r.status, 200);
  const a = r.body.boletas.find((x) => x.trabajador_id === S.a);
  assert.deepEqual([a.dias, a.horas_normales, a.horas_extras, a.neto, a.cuadre], [6, 48, 42.36, 1000, 'dominical']);
  assert.equal(Math.round((a.total_remuneracion - a.snp) * 100), 100000);
  const k = r.body.boletas.find((x) => x.trabajador_id === c.id);
  assert.deepEqual([k.categoria_tareo, k.categoria_pago, k.jornal, k.cuadre], ['AYUDANTE', 'OPERARIO', 86.8, 'sin_deposito']);
  assert.equal(r.body.totales.trabajadores, 3);
});
