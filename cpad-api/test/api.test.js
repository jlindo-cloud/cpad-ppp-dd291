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
const { asegurarAdmin } = require('../src/auth');
const { calcularBoleta: cb, calcularDeposito } = require('../src/planilla');

let pg, pool, app, agent;
const CLAVE = 'Prueba2026';
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
  await asegurarAdmin(pool, CLAVE);
  agent = request.agent(app);
  const r = await agent.post('/api/auth/ingresar').send({ usuario: 'admin', clave: CLAVE });
  assert.equal(r.status, 200);
});

after(async () => {
  await pool?.end();
  await pg?.stop();
});

test('CP01 salud: la API responde y conecta con PostgreSQL', async () => {
  const r = await agent.get('/api/salud');
  assert.equal(r.status, 200);
  assert.equal(r.body.estado, 'ok');
});

test('CP02 catálogos: categorías y especialidades iniciales cargadas', async () => {
  const c = await agent.get('/api/categorias');
  assert.deepEqual(c.body.map((x) => x.nombre).sort(), ['AYUDANTE', 'CAPATAZ', 'OFICIAL', 'OPERARIO']);
  const e = await agent.get('/api/especialidades');
  assert.deepEqual(e.body.map((x) => x.nombre).sort(), ['ACERO', 'CONCRETO', 'ELECTRICIDAD', 'ENCOFRADO']);
});

test('CP03 catálogos: rechaza especialidad duplicada (409)', async () => {
  const r = await agent.post('/api/especialidades').send({ nombre: 'acero' });
  assert.equal(r.status, 409);
});

test('CP04 obras: la obra inicial trae el horario único de obra', async () => {
  const r = await agent.get('/api/obras');
  assert.equal(r.status, 200);
  const o = r.body.find((x) => x.codigo === 'IE0159');
  assert.ok(o);
  assert.equal(o.hora_ingreso, '07:30:00');
  assert.equal(o.hora_salida, '17:00:00');
  assert.equal(o.hora_salida_sabado, '13:00:00');
});

test('CP05 obras: crea, edita y da de baja lógica un centro de costo', async () => {
  const c = await agent.post('/api/obras').send({ codigo: 'PRUEBA01', nombre: 'Obra de prueba' });
  assert.equal(c.status, 201);
  const u = await agent.put(`/api/obras/${c.body.id}`).send({ codigo: 'PRUEBA01', nombre: 'Obra de prueba editada', hora_salida: '17:30' });
  assert.equal(u.status, 200);
  assert.equal(u.body.nombre, 'Obra de prueba editada');
  const d = await agent.delete(`/api/obras/${c.body.id}`);
  assert.equal(d.body.activo, false);
  const act = await agent.get('/api/obras?activo=true');
  assert.ok(!act.body.some((x) => x.id === c.body.id));
});

test('CP06 obras: rechaza hora con formato inválido (400)', async () => {
  const r = await agent.post('/api/obras').send({ codigo: 'X1', nombre: 'X', hora_ingreso: '7.30' });
  assert.equal(r.status, 400);
});

async function ids() {
  const cat = (await agent.get('/api/categorias')).body.find((x) => x.nombre === 'OFICIAL').id;
  const esp = (await agent.get('/api/especialidades')).body.find((x) => x.nombre === 'ELECTRICIDAD').id;
  const obra = (await agent.get('/api/obras')).body.find((x) => x.codigo === 'IE0159').id;
  return { cat, esp, obra };
}

test('CP07 trabajadores: registra un trabajador y lo devuelve con sus maestros', async () => {
  const { cat, esp, obra } = await ids();
  const r = await agent.post('/api/trabajadores').send({
    dni: '12345678', apellidos: 'Pérez Rojas', nombres: 'Juan', categoria_id: cat, especialidad_id: esp, obra_id: obra, fecha_ingreso: '2026-09-29',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.apellidos, 'PÉREZ ROJAS');
  const g = await agent.get('/api/trabajadores/dni/12345678');
  assert.equal(g.status, 200);
  assert.equal(g.body.categoria, 'OFICIAL');
  assert.equal(g.body.especialidad, 'ELECTRICIDAD');
  assert.equal(g.body.obra, 'IE0159');
});

test('CP08 trabajadores: rechaza DNI que no tiene 8 dígitos (400)', async () => {
  const { cat, esp } = await ids();
  for (const dni of ['1234567', '123456789', 'ABCDEFGH']) {
    const r = await agent.post('/api/trabajadores').send({ dni, apellidos: 'A', nombres: 'B', categoria_id: cat, especialidad_id: esp });
    assert.equal(r.status, 400, dni);
  }
});

test('CP09 trabajadores: rechaza DNI duplicado (409)', async () => {
  const { cat, esp } = await ids();
  const r = await agent.post('/api/trabajadores').send({ dni: '12345678', apellidos: 'Otro', nombres: 'Nombre', categoria_id: cat, especialidad_id: esp });
  assert.equal(r.status, 409);
});

test('CP10 trabajadores: rechaza categoría inexistente (409)', async () => {
  const { esp } = await ids();
  const r = await agent.post('/api/trabajadores').send({ dni: '87654321', apellidos: 'A', nombres: 'B', categoria_id: 9999, especialidad_id: esp });
  assert.equal(r.status, 409);
});

test('CP11 trabajadores: filtra por obra y busca por apellido o DNI', async () => {
  const { obra } = await ids();
  const f = await agent.get(`/api/trabajadores?obra_id=${obra}`);
  assert.equal(f.body.length, 1);
  const q1 = await agent.get('/api/trabajadores?q=pérez');
  assert.equal(q1.body.length, 1);
  const q2 = await agent.get('/api/trabajadores?q=1234');
  assert.equal(q2.body.length, 1);
});

test('CP12 errores: id inválido, recurso inexistente y JSON mal formado', async () => {
  assert.equal((await agent.get('/api/trabajadores/abc')).status, 400);
  assert.equal((await agent.get('/api/trabajadores/9999')).status, 404);
  const r = await agent.post('/api/obras').set('Content-Type', 'application/json').send('{mal');
  assert.equal(r.status, 400);
});

test('CP13 lote: carga varios trabajadores usando nombres de categoría, especialidad y obra', async () => {
  const r = await agent.post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '20000001', apellidos: 'Uno Prueba', nombres: 'Ana', categoria: 'Operario', especialidad: 'Electricidad', obra: 'IE0159' },
    { dni: '20000002', apellidos: 'Dos Prueba', nombres: 'Luis', categoria: 'CAPATAZ', especialidad: 'ELECTRICIDAD', obra: 'IE0159',
      fecha_nacimiento: '1988-02-14', banco: 'bcp', cuenta_bancaria: '191-0000000-0-02' },
    { dni: '20000003', apellidos: 'Tres Prueba', nombres: 'Rosa', categoria: 'ayudante', especialidad: 'concreto' },
  ] });
  assert.equal(r.status, 201);
  assert.equal(r.body.insertados, 3);
  const g = await agent.get('/api/trabajadores/dni/20000002');
  assert.equal(g.body.categoria, 'CAPATAZ');
  assert.deepEqual([g.body.banco, g.body.cuenta_bancaria, g.body.afiliacion], ['BCP', '191-0000000-0-02', 'ONP']);
});

test('CP14 lote: si una fila falla no se registra ninguna y se informa la fila', async () => {
  const antes = (await agent.get('/api/trabajadores')).body.length;
  const r = await agent.post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '30000001', apellidos: 'Valido', nombres: 'Uno', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '3000000', apellidos: 'Dni Corto', nombres: 'Dos', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '30000003', apellidos: 'Sin Categoria', nombres: 'Tres', categoria: 'MAESTRO', especialidad: 'ACERO' },
  ] });
  assert.equal(r.status, 400);
  assert.equal(r.body.insertados, 0);
  assert.deepEqual(r.body.errores.map((e) => e.fila), [2, 3]);
  const despues = (await agent.get('/api/trabajadores')).body.length;
  assert.equal(despues, antes);
});

test('CP15 lote: detecta DNI repetido en el lote y DNI ya registrado', async () => {
  const r = await agent.post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '40000001', apellidos: 'A', nombres: 'B', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '40000001', apellidos: 'C', nombres: 'D', categoria: 'OFICIAL', especialidad: 'ACERO' },
    { dni: '12345678', apellidos: 'E', nombres: 'F', categoria: 'OFICIAL', especialidad: 'ACERO' },
  ] });
  assert.equal(r.status, 400);
  assert.match(r.body.errores[0].errores.join(), /repetido/);
  assert.match(r.body.errores[1].errores.join(), /ya registrado/);
});

test('CP16 lote: rechaza lote vacío o con más de 500 filas', async () => {
  assert.equal((await agent.post('/api/trabajadores/lote').send({ trabajadores: [] })).status, 400);
  const muchas = Array.from({ length: 501 }, (_, i) => ({ dni: String(50000000 + i), apellidos: 'X', nombres: 'Y', categoria: 'OFICIAL', especialidad: 'ACERO' }));
  assert.equal((await agent.post('/api/trabajadores/lote').send({ trabajadores: muchas })).status, 400);
});

// ---------------- Sprint 2: asistencia (tareo) ----------------
async function hoja(fecha) {
  const obra = (await agent.get('/api/obras')).body.find((x) => x.codigo === 'IE0159').id;
  const r = await agent.get(`/api/asistencias?obra_id=${obra}&fecha=${fecha}`);
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
  const p = await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-21', registros: [
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
  await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-21', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '20:00' }] });
  const h = (await hoja('2026-09-21')).r.body;
  assert.equal(h.resumen.registrados, 3);
  assert.equal(h.filas.find((x) => x.trabajador_id === a.trabajador_id).sobretiempo_h, 3);
});

test('CP20 tareo: el sábado usa la salida de las 13:00 y descuenta almuerzo solo si la jornada se extiende', async () => {
  const { obra, r } = await hoja('2026-09-26');
  const [a, b] = r.body.filas;
  await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-26', registros: [
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
  await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-22', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '08:15', hora_salida: '17:00' }] });
  const f = (await hoja('2026-09-22')).r.body.filas.find((x) => x.trabajador_id === a.trabajador_id);
  assert.equal(f.tardanza_min, 45);
  assert.equal(f.horas_trabajadas, 7.75);
});

test('CP22 tareo: si una fila es inválida no se guarda ninguna', async () => {
  const { obra, r } = await hoja('2026-09-23');
  const [a, b, c] = r.body.filas;
  const p = await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-23', registros: [
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
  const p = await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2099-01-05', registros: [
    { trabajador_id: r.body.filas[0].trabajador_id, hora_ingreso: '07:30' }] });
  assert.equal(p.status, 400);
  assert.equal((await agent.get('/api/asistencias?obra_id=1')).status, 400);
  assert.equal((await agent.get('/api/asistencias?obra_id=9999&fecha=2026-09-21')).status, 404);
});

// ---------- Semana 7: resumen semanal y cierre (HU06) ----------
async function obraSemana() {
  const o = await agent.post('/api/obras').send({ codigo: 'SEM01', nombre: 'Obra para pruebas de semana' });
  const lote = await agent.post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '50000001', apellidos: 'Semana Uno', nombres: 'Ana', categoria: 'OPERARIO', especialidad: 'ELECTRICIDAD', obra: 'SEM01' },
    { dni: '50000002', apellidos: 'Semana Dos', nombres: 'Beto', categoria: 'OFICIAL', especialidad: 'ELECTRICIDAD', obra: 'SEM01' }] });
  assert.equal(lote.status, 201);
  const ts = (await agent.get(`/api/trabajadores?obra_id=${o.body.id}`)).body;
  return { obra: o.body.id, a: ts.find((x) => x.dni === '50000001').id, b: ts.find((x) => x.dni === '50000002').id };
}
const dia = (obra, fecha, registros) => agent.put('/api/asistencias').send({ obra_id: obra, fecha, registros });
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
  const r = await agent.get(`/api/asistencias/semana?obra_id=${S.obra}&fecha=2026-10-01`);
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
  const lote = await agent.post('/api/trabajadores/lote').send({ trabajadores: [
    { dni: '50000003', apellidos: 'Semana Tres', nombres: 'Ciro', categoria: 'AYUDANTE', especialidad: 'ELECTRICIDAD', obra: 'SEM01', fecha_ingreso: '2026-10-02' }] });
  assert.equal(lote.status, 201);
  const c = (await agent.get('/api/trabajadores/dni/50000003')).body.id;
  const r = await agent.post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 409);
  // Ingresó el viernes: solo viernes y sábado cuentan como pendientes, no los días previos a su ingreso
  assert.deepEqual(r.body.pendientes.map((p) => [p.trabajador_id, p.sin_marcar]), [[c, 2]]);
  await dia(S.obra, '2026-10-02', [{ trabajador_id: c, hora_ingreso: '07:30' }]);
  await dia(S.obra, '2026-10-03', [{ trabajador_id: c, asistio: false }]);
  const r2 = await agent.post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.pendientes[0].sin_salida, 1);
  await dia(S.obra, '2026-10-02', [{ trabajador_id: c, hora_ingreso: '07:30', hora_salida: '17:00' }]);
});

test('CP26 semana: el cierre bloquea la corrección de cualquier día de esa semana', async () => {
  const r = await agent.post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-10-02', observacion: 'Revisada' });
  assert.equal(r.status, 201);
  assert.ok(r.body.cierre.cerrado_en);
  assert.equal((await agent.post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' })).status, 409);
  const p = await dia(S.obra, '2026-10-04', [{ trabajador_id: S.b, hora_ingreso: '07:30', hora_salida: '12:00' }]);
  assert.equal(p.status, 409);
  const h = await agent.get(`/api/asistencias?obra_id=${S.obra}&fecha=2026-09-29`);
  assert.equal(h.body.semana_cerrada, true);
});

test('CP27 semana: la reapertura permite volver a corregir', async () => {
  const d = await agent.delete(`/api/asistencias/semana/cierre?obra_id=${S.obra}&fecha=2026-09-30`);
  assert.equal(d.status, 200);
  assert.equal(d.body.cierre, null);
  assert.equal((await dia(S.obra, '2026-09-30', [{ trabajador_id: S.b, hora_ingreso: '07:30', hora_salida: '17:00' }])).status, 200);
  assert.equal((await agent.delete(`/api/asistencias/semana/cierre?obra_id=${S.obra}&fecha=2026-09-30`)).status, 404);
});

test('CP28 semana: no se cierra una semana que aún no termina', async () => {
  const r = await agent.post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2099-01-05' });
  assert.equal(r.status, 400);
  assert.equal((await agent.get(`/api/asistencias/semana?obra_id=${S.obra}`)).status, 400);
});

test('CP29 tareo: «de corrido» no descuenta el almuerzo y suma esa hora al sobretiempo', async () => {
  const { obra, r } = await hoja('2026-09-24');
  const [a, b] = r.body.filas;
  await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-24', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '17:00', de_corrido: true },
    { trabajador_id: b.trabajador_id, hora_ingreso: '07:30', hora_salida: '17:00' }] });
  const f = (await hoja('2026-09-24')).r.body.filas;
  const fa = f.find((x) => x.trabajador_id === a.trabajador_id), fb = f.find((x) => x.trabajador_id === b.trabajador_id);
  assert.deepEqual([fa.de_corrido, fa.horas_trabajadas, fa.sobretiempo_h], [true, 9.5, 1]);
  assert.deepEqual([fb.de_corrido, fb.horas_trabajadas, fb.sobretiempo_h], [false, 8.5, 0]);
  await agent.put('/api/asistencias').send({ obra_id: obra, fecha: '2026-09-26', registros: [
    { trabajador_id: a.trabajador_id, hora_ingreso: '07:30', hora_salida: '16:00', de_corrido: true }] });
  const s = (await hoja('2026-09-26')).r.body.filas.find((x) => x.trabajador_id === a.trabajador_id);
  assert.deepEqual([s.horas_trabajadas, s.sobretiempo_h], [8.5, 3]);
});

// ---------- Sprint 3 · HU07: motor de cálculo de la planilla ----------
const { calcularBoleta } = require('../src/planilla');
const B30 = require('./boletas_semana30.json');

test('CP30 planilla: el motor reproduce al céntimo las 11 boletas reales de la semana 30', async () => {
  const pr = (await agent.get('/api/planillas/parametros?fecha=2026-09-28')).body;
  const J = Object.fromEntries(pr.jornales.map((j) => [j.categoria, j]));
  for (const b of B30.boletas) {
    const j = J[b.categoria_pago];
    const r = calcularBoleta({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: b.dias, horas_extras: b.horas_extras, depositado: b.depositado }, pr.parametros);
    for (const [k, v] of Object.entries(b.esperado)) assert.equal(r[k], v, `boleta ${b.boleta}: ${k}`);
  }
});

test('CP31 planilla: solo se calcula sobre una semana cerrada', async () => {
  const r = await agent.post('/api/planillas/calculo').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 409);
});

test('CP32 planilla: calcula al peón (ayudante) con el jornal de su tabla', async () => {
  assert.equal((await agent.post('/api/asistencias/semana/cierre').send({ obra_id: S.obra, fecha: '2026-09-28' })).status, 201);
  const r = await agent.post('/api/planillas/calculo').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 200);
  const c = (await agent.get('/api/trabajadores/dni/50000003')).body;
  const k = r.body.boletas.find((x) => x.trabajador_id === c.id);
  assert.deepEqual([k.categoria_pago, k.jornal, k.sueldo_semanal, k.tarifa_hora_extra], ['AYUDANTE', 61.3, 600, 14]);
});

test('CP33 planilla: calcula la semana cerrada con horas extras, depósito y categoría de pago especial', async () => {
  const c = (await agent.get('/api/trabajadores/dni/50000003')).body;
  const op = (await agent.get('/api/categorias')).body.find((x) => x.nombre === 'OPERARIO').id;
  const u = await agent.put(`/api/trabajadores/${c.id}`).send({ dni: c.dni, apellidos: c.apellidos, nombres: c.nombres, categoria_id: c.categoria_id,
    especialidad_id: c.especialidad_id, obra_id: c.obra_id, fecha_ingreso: c.fecha_ingreso, categoria_pago_id: op });
  assert.equal(u.status, 200);
  const r = await agent.post('/api/planillas/calculo').send({ obra_id: S.obra, fecha: '2026-09-28',
    horas_extras: { [S.a]: 2 }, depositado: { [S.a]: 1000 } });
  assert.equal(r.status, 200);
  const a = r.body.boletas.find((x) => x.trabajador_id === S.a);
  assert.deepEqual([a.dias, a.horas_normales, a.horas_extras, a.neto, a.cuadre], [6, 48, 42.36, 1000, 'dominical']);
  assert.equal(Math.round((a.total_remuneracion - a.snp) * 100), 100000);
  const k = r.body.boletas.find((x) => x.trabajador_id === c.id);
  assert.deepEqual([k.categoria_tareo, k.categoria_pago, k.jornal, k.sueldo_semanal], ['AYUDANTE', 'OPERARIO', 86.8, 950]);
  assert.equal(r.body.totales.trabajadores, 3);
});


test('CP34 planilla: la regla de pago reproduce los 11 depósitos de la semana 30 y sus boletas', async () => {
  const pr = (await agent.get('/api/planillas/parametros?fecha=2026-09-28')).body;
  const G = Object.fromEntries(pr.pagos.map((g) => [g.categoria, g]));
  const J = Object.fromEntries(pr.jornales.map((j) => [j.categoria, j]));
  for (const b of B30.boletas) {
    // la B02 es de un peón: se paga como peón, aunque su boleta real se desglosó con el jornal del oficial
    const g = G[b.categoria_sueldo || b.categoria_pago]; const j = J[b.categoria_pago];
    const d = calcularDeposito({ sueldo_semanal: g.sueldo_semanal, dias: b.dias, horas_extras: b.horas_extras, tarifa_hora_extra: g.tarifa_hora_extra });
    assert.equal(d.deposito, b.depositado, `boleta ${b.boleta}: depósito`);
    const r = cb({ jornal: j.jornal, pct_buc: j.pct_buc, valor_hora_extra: j.valor_hora_extra, dias: b.dias, horas_extras: b.horas_extras, depositado: d.deposito }, pr.parametros);
    assert.equal(r.neto, b.esperado.neto, `boleta ${b.boleta}: neto`);
    assert.equal(r.total_remuneracion, b.esperado.total_remuneracion, `boleta ${b.boleta}: total`);
  }
});

test('CP35 planilla: registra horas extras y descuento (DSCTO); el descuento baja el depósito pero no figura en la boleta', async () => {
  const r = await agent.put('/api/planillas/ajustes').send({ obra_id: S.obra, fecha: '2026-09-28', trabajador_id: S.a, horas_extras: 2, descuento: 100, nota: 'Adelanto del miércoles' });
  assert.equal(r.status, 200);
  const g = await agent.get(`/api/planillas/semana?obra_id=${S.obra}&fecha=2026-09-30`);
  assert.equal(g.status, 200);
  const a = g.body.boletas.find((x) => x.trabajador_id === S.a);
  // operario, 6 días: 950 + 2 × 18 = 986; el depósito descuenta 100 y la boleta se cuadra con el pago (986)
  assert.deepEqual([a.pago_semana, a.descuento, a.deposito, a.neto, a.nota], [986, 100, 886, 986, 'Adelanto del miércoles']);
  assert.ok(g.body.semana_horas_extras.inicio === '2026-10-05' && 'cerrada' in g.body.semana_horas_extras);
  assert.equal(g.body.totales.deposito, g.body.boletas.reduce((s, x) => s + x.deposito, 0));
});

test('CP36 planilla: valida los ajustes y avisa cuando el descuento supera el pago', async () => {
  const base = { obra_id: S.obra, fecha: '2026-09-28', trabajador_id: S.a };
  assert.equal((await agent.put('/api/planillas/ajustes').send({ ...base, horas_extras: 70 })).status, 400);
  assert.equal((await agent.put('/api/planillas/ajustes').send({ ...base, descuento: -5 })).status, 400);
  assert.equal((await agent.put('/api/planillas/ajustes').send({ ...base, trabajador_id: 999999 })).status, 404);
  const r = await agent.put('/api/planillas/ajustes').send({ ...base, horas_extras: 0, descuento: 2000 });
  assert.equal(r.status, 200);
  const e = r.body.errores.find((x) => x.trabajador_id === S.a);
  assert.match(e.errores.join(' '), /descuento iguala o supera/);
  assert.equal((await agent.put('/api/planillas/ajustes').send({ ...base, horas_extras: 0, adelanto: 0 })).status, 200); // «adelanto» se acepta por compatibilidad
});

test('CP37 planilla: el capataz se desglosa con el jornal del operario y una categoría sin tabla no se calcula', async () => {
  const c = (await agent.get('/api/trabajadores/dni/50000003')).body;
  const cats = (await agent.get('/api/categorias')).body;
  const put = (cat) => agent.put(`/api/trabajadores/${c.id}`).send({ dni: c.dni, apellidos: c.apellidos, nombres: c.nombres, categoria_id: c.categoria_id,
    especialidad_id: c.especialidad_id, obra_id: c.obra_id, fecha_ingreso: c.fecha_ingreso, categoria_pago_id: cat });
  await put(cats.find((x) => x.nombre === 'CAPATAZ').id);
  const r = await agent.put('/api/planillas/ajustes').send({ obra_id: S.obra, fecha: '2026-09-28', trabajador_id: c.id, horas_extras: 1 });
  assert.equal(r.status, 200);
  const k = r.body.boletas.find((x) => x.trabajador_id === c.id);
  const esperado = calcularDeposito({ sueldo_semanal: 1200, dias: k.dias, horas_extras: 1, tarifa_hora_extra: 20 }).deposito;
  assert.deepEqual([k.categoria_pago, k.jornal, k.deposito, k.neto], ['CAPATAZ', 86.8, esperado, esperado]);
  const nueva = (await agent.post('/api/categorias').send({ nombre: 'Maestro de obra' })).body;
  await put(nueva.id);
  const g = await agent.get(`/api/planillas/semana?obra_id=${S.obra}&fecha=2026-09-28`);
  const e = g.body.errores.find((x) => x.trabajador_id === c.id).errores.join(' ');
  assert.match(e, /jornal de tabla vigente/);
  assert.match(e, /sueldo semanal vigente/);
  assert.ok(g.body.boletas.some((x) => x.trabajador_id === S.a)); // los demás sí se calculan
});

test('CP38 planilla: el pago de la semana se redondea al sol hacia arriba', () => {
  assert.equal(calcularDeposito({ sueldo_semanal: 800, dias: 4 }).deposito, 534);        // 533,33 → 534
  assert.equal(calcularDeposito({ sueldo_semanal: 600, dias: 5, horas_extras: 2, tarifa_hora_extra: 14 }).deposito, 528); // 500 + 28
  assert.equal(calcularDeposito({ sueldo_semanal: 1200, dias: 6, horas_extras: 1.5, tarifa_hora_extra: 20, descuento: 100 }).deposito, 1130);
});

const pdf = (r) => r.buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
const paginas = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

test('CP39 boletas: emite el PDF de la semana con una boleta por página', async () => {
  const g = (await agent.get(`/api/planillas/semana?obra_id=${S.obra}&fecha=2026-09-28`)).body;
  const r = await pdf(agent.get(`/api/planillas/boletas.pdf?obra_id=${S.obra}&fecha=2026-09-28`));
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/pdf/);
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal(paginas(r.body), g.boletas.length);
});

test('CP40 boletas: emite la boleta de un trabajador y rechaza los casos sin boleta', async () => {
  const r = await pdf(agent.get(`/api/planillas/boletas.pdf?obra_id=${S.obra}&fecha=2026-09-28&trabajador_id=${S.a}`));
  assert.equal(r.status, 200);
  assert.equal(paginas(r.body), 1);
  assert.match(r.headers['content-disposition'], /boleta_2026-09-28_\d{8}\.pdf/);
  assert.equal((await agent.get(`/api/planillas/boletas.pdf?obra_id=${S.obra}&fecha=2026-09-28&trabajador_id=999999`)).status, 404);
  assert.equal((await agent.get(`/api/planillas/boletas.pdf?obra_id=${S.obra}&fecha=2026-10-05`)).status, 409); // semana abierta
});

test('CP41 boletas: datos del trabajador y de la obra que imprime la boleta', async () => {
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  const base = { dni: a.dni, apellidos: a.apellidos, nombres: a.nombres, categoria_id: a.categoria_id, especialidad_id: a.especialidad_id, obra_id: a.obra_id, fecha_ingreso: a.fecha_ingreso?.slice(0, 10) };
  let r = await agent.put(`/api/trabajadores/${S.a}`).send({ ...base, fecha_nacimiento: '1990-05-20', banco: 'bcp', cuenta_bancaria: '191-0000000-0-00' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.banco, r.body.cuenta_bancaria, r.body.afiliacion], ['BCP', '191-0000000-0-00', 'ONP']);
  r = await agent.put(`/api/trabajadores/${S.a}`).send(base); // sin esos campos: se conservan
  assert.equal(r.body.banco, 'BCP');
  assert.equal((await agent.put(`/api/trabajadores/${S.a}`).send({ ...base, fecha_nacimiento: '20/05/1990' })).status, 400);
  const o = (await agent.get(`/api/obras/${S.obra}`)).body;
  const ob = { codigo: o.codigo, nombre: o.nombre };
  assert.equal((await agent.put(`/api/obras/${S.obra}`).send({ ...ob, semana_base: '2026-03-10' })).status, 400); // no es lunes
  r = await agent.put(`/api/obras/${S.obra}`).send({ ...ob, semana_base: '2026-03-09', centro_costo: 'Obra de prueba' });
  assert.equal(r.status, 200);
  const p = await pdf(agent.get(`/api/planillas/boletas.pdf?obra_id=${S.obra}&fecha=2026-09-28&trabajador_id=${S.a}`));
  assert.equal(p.status, 200);  const { numeroSemana } = require('../src/planilla');
  assert.equal(numeroSemana('2026-09-28', '2026-03-09'), 30); // semana 30 de las boletas de la empresa
  assert.equal(numeroSemana('2026-03-02', '2026-03-09'), null);
  assert.equal(numeroSemana('2026-09-28', null), null);
});

test('CP42 registro: solo se registra una planilla sin observaciones y luego queda bloqueada', async () => {
  const sem = `obra_id=${S.obra}&fecha=2026-09-28`;
  let r = await agent.post('/api/planillas/registro').send({ obra_id: S.obra, fecha: '2026-09-28' });
  assert.equal(r.status, 409); // el trabajador de CP37 quedó con una categoría sin sueldo
  assert.ok(r.body.errores.length);
  const c = (await agent.get('/api/trabajadores/dni/50000003')).body;
  await agent.put(`/api/trabajadores/${c.id}`).send({ dni: c.dni, apellidos: c.apellidos, nombres: c.nombres, categoria_id: c.categoria_id,
    especialidad_id: c.especialidad_id, obra_id: c.obra_id, fecha_ingreso: c.fecha_ingreso, categoria_pago_id: null });
  const antes = (await agent.get(`/api/planillas/semana?${sem}`)).body;
  assert.equal(antes.registro, null);
  r = await agent.post('/api/planillas/registro').send({ obra_id: S.obra, fecha: '2026-09-30' }); // cualquier día de la semana
  assert.equal(r.status, 201);
  assert.ok(r.body.registro.registrado_en);
  assert.equal(r.body.registro.numero_semana, 30);
  assert.equal(r.body.totales.deposito, antes.totales.deposito);
  assert.equal((await agent.post('/api/planillas/registro').send({ obra_id: S.obra, fecha: '2026-09-28' })).status, 409);
  assert.equal((await agent.put('/api/planillas/ajustes').send({ obra_id: S.obra, fecha: '2026-09-28', trabajador_id: S.a, horas_extras: 2 })).status, 409);
  assert.equal((await agent.delete(`/api/asistencias/semana/cierre?${sem}`)).status, 409);
  assert.equal((await agent.post('/api/planillas/registro').send({ obra_id: S.obra, fecha: '2026-10-05' })).status, 409); // semana abierta
});

test('CP43 registro: las boletas registradas no cambian aunque cambien los datos del trabajador', async () => {
  const sem = `obra_id=${S.obra}&fecha=2026-09-28`;
  const antes = (await agent.get(`/api/planillas/semana?${sem}`)).body.boletas.find((x) => x.trabajador_id === S.a);
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  const cats = (await agent.get('/api/categorias')).body;
  await agent.put(`/api/trabajadores/${S.a}`).send({ dni: a.dni, apellidos: a.apellidos, nombres: a.nombres, categoria_id: a.categoria_id,
    especialidad_id: a.especialidad_id, obra_id: a.obra_id, fecha_ingreso: a.fecha_ingreso?.slice(0, 10), banco: 'BBVA',
    categoria_pago_id: cats.find((x) => x.nombre === 'CAPATAZ').id });
  const despues = (await agent.get(`/api/planillas/semana?${sem}`)).body.boletas.find((x) => x.trabajador_id === S.a);
  assert.deepEqual([despues.categoria_pago, despues.deposito, despues.banco], [antes.categoria_pago, antes.deposito, antes.banco]);
  const p = await pdf(agent.get(`/api/planillas/boletas.pdf?${sem}`));
  assert.equal(p.status, 200);
  assert.equal(paginas(p.body), (await agent.get(`/api/planillas/semana?${sem}`)).body.boletas.length);
  await agent.put(`/api/trabajadores/${S.a}`).send({ dni: a.dni, apellidos: a.apellidos, nombres: a.nombres, categoria_id: a.categoria_id,
    especialidad_id: a.especialidad_id, obra_id: a.obra_id, fecha_ingreso: a.fecha_ingreso?.slice(0, 10), banco: a.banco, categoria_pago_id: a.categoria_pago_id });
});

test('CP44 historial: semanas registradas de la obra y boletas de un trabajador; el registro se puede anular', async () => {
  let r = await agent.get(`/api/planillas/historial?obra_id=${S.obra}`);
  assert.equal(r.status, 200);
  const s30 = r.body.find((x) => x.semana_inicio === '2026-09-28');
  assert.deepEqual([s30.numero_semana, s30.semana_fin, s30.origen], [30, '2026-10-03', 'CPAD']);
  assert.ok(s30.trabajadores > 0 && s30.total_deposito > 0);
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  r = await agent.get(`/api/planillas/historial/trabajador?dni=${a.dni}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.trabajador.id, S.a);
  assert.equal(r.body.boletas[0].semana_inicio, '2026-09-28');
  assert.ok(r.body.boletas[0].deposito > 0);
  assert.equal((await agent.get('/api/planillas/historial/trabajador?dni=123')).status, 400);
  assert.equal((await agent.get('/api/planillas/historial/trabajador?dni=99999999')).status, 404);
  assert.equal((await agent.get('/api/planillas/historial')).status, 400);
  assert.equal((await agent.delete(`/api/planillas/registro?obra_id=${S.obra}&fecha=2026-09-28`)).status, 200);
  assert.equal((await agent.delete(`/api/planillas/registro?obra_id=${S.obra}&fecha=2026-09-28`)).status, 404);
  assert.equal((await agent.get(`/api/planillas/historial?obra_id=${S.obra}`)).body.length, 0);
  assert.equal((await agent.put('/api/planillas/ajustes').send({ obra_id: S.obra, fecha: '2026-09-28', trabajador_id: S.a, horas_extras: 0 })).status, 200);
});

// HU11 · Planilla en Excel con el mismo formato que la de la empresa y datos ficticios
async function excelPlanilla(filas, titulo = '(SEMANA 30) 28/09 AL 03/10') {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('SEM 30');
  ws.getCell('B4').value = 'COEZ'; ws.getCell('B5').value = titulo;
  ws.getRow(1).values = [null, null, null, 'CATEGORIA', 'SUELDO', 'X DIA', 'HORA'];
  ws.getRow(3).values = [null, null, null, 'Operario', 950, 158.33, 18];
  ws.getCell('B8').value = 'PERSONAL EN OBRA'; ws.getCell('M8').value = 'HORAS SEM 31';
  ws.getRow(9).values = ['#', 'Apellidos y Nombres', 'Categoria', 'DNI', 'Fecha\nNacimiento', 'Fecha Ingreso', 'Banco', 'Nª Cuenta', 'CCI',
    'DIAS ASIST', 'DSCTO', 'SUELDO', 'HORAS', 'TOT HOR', 'TOTAL PAGO'];
  filas.forEach((f, i) => { ws.getRow(10 + i).values = [i + 1, ...f]; });
  ws.getRow(10 + filas.length).values = [null, null, null, null, null, null, null, null, null, null, null, null, null, 'TOTAL', 9999];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const subir = (buf, q = '') => agent.post(`/api/importaciones/padron${q}`).set('Content-Type', 'application/octet-stream').send(buf);

test('CP45 importación: vista previa del padrón desde el Excel de la empresa', async () => {
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  const buf = await excelPlanilla([
    [`${a.apellidos} ${a.nombres}`, 'Operario', a.dni, new Date(Date.UTC(1990, 4, 20)), '07/07/2025', 'BBVA', '0011000000000000001', '00110000000000000011', 6, null, 950, 2, 36, 986],
    ['DE LA CRUZ QUISPE JUAN CARLOS', 'Peón', 1234567, new Date(Date.UTC(1985, 0, 4)), '07/07/2025', 'bcp', '19100000000001', null, 6, null, 600, 0, 0, 600],
    ['TORRES VEGA ANA', 'Oficial', '61000002', null, null, 'BCP', '19100000000002', null, 5, null, 667, 0, 0, 667],
    ['RAMOS SOTO LUIS', 'Maestro', '1234', '31/02/1990', null, null, null, null, 6, null, 950, 0, 0, 950],
  ]);
  const r = await subir(buf);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.semana, { numero: 30, desde: '28/09', hasta: '03/10' });
  assert.deepEqual(r.body.resumen, { filas: 4, nuevos: 2, actualiza: 1, sin_cambios: 0, errores: 1 });
  const [f1, f2, f3, f4] = r.body.filas;
  assert.equal(f1.estado, 'actualiza');
  assert.ok(f1.cambios.includes('cci') && f1.cambios.includes('banco'));
  assert.deepEqual([f2.dni, f2.apellidos, f2.nombres, f2.categoria, f2.fecha_nacimiento, f2.fecha_ingreso, f2.banco],
    ['01234567', 'DE LA CRUZ QUISPE', 'JUAN CARLOS', 'AYUDANTE', '1985-01-04', '2025-07-07', 'BCP']);
  assert.match(f2.avisos.join(' '), /cero inicial/);
  assert.equal(f3.estado, 'nuevo');
  assert.equal(f4.estado, 'error');
  assert.match(f4.errores.join(' '), /DNI inválido/);
  assert.match(f4.errores.join(' '), /categoría «Maestro» no registrada/);
  assert.match(f4.errores.join(' '), /fecha de nacimiento inválida/);
  const c = await subir(buf, `?confirmar=1&obra_id=${S.obra}&especialidad_id=1`);
  assert.equal(c.status, 400); // con errores no se registra nada
  assert.equal((await agent.get('/api/trabajadores/dni/61000002')).status, 404);
  assert.equal((await subir(Buffer.from('no es un excel'))).status, 400);
});

test('CP46 importación: registra los nuevos, actualiza los existentes y no repite cambios', async () => {
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  const buf = await excelPlanilla([
    [`${a.apellidos} ${a.nombres}`, 'Operario', a.dni, null, null, 'BBVA', '0011000000000000001', '00110000000000000011', 6, null, 950, 2, 36, 986],
    ['DE LA CRUZ QUISPE JUAN CARLOS', 'Peón', 1234567, new Date(Date.UTC(1985, 0, 4)), '07/07/2025', 'bcp', '19100000000001', null, 6, null, 600, 0, 0, 600],
    ['TORRES VEGA ANA', 'Oficial', '61000002', null, null, 'BCP', '19100000000002', null, 5, null, 667, 0, 0, 667],
  ]);
  assert.equal((await subir(buf, '?confirmar=1')).status, 400); // los nuevos necesitan obra y especialidad
  const r = await subir(buf, `?confirmar=1&obra_id=${S.obra}&especialidad_id=1`);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.registrados, r.body.actualizados], [2, 1]);
  const n = (await agent.get('/api/trabajadores/dni/01234567')).body;
  assert.deepEqual([n.apellidos, n.nombres, n.fecha_nacimiento?.slice(0, 10), n.banco, n.cuenta_bancaria, n.obra_id],
    ['DE LA CRUZ QUISPE', 'JUAN CARLOS', '1985-01-04', 'BCP', '19100000000001', S.obra]);
  const x = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  assert.deepEqual([x.banco, x.cci], ['BBVA', '00110000000000000011']);
  const otra = await subir(buf);
  assert.deepEqual([otra.body.resumen.nuevos, otra.body.resumen.actualiza, otra.body.resumen.sin_cambios], [0, 0, 3]);
});

const subirPlanilla = (buf, q = '') => agent.post(`/api/importaciones/planilla${q}`).set('Content-Type', 'application/octet-stream').send(buf);

test('CP47 importación de semana pagada: ubica la semana por su número y valida lo pagado', async () => {
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  const filas = [
    // días de la semana 29 y horas extras de la semana 30; DSCTO ya restado en TOTAL PAGO
    [`${a.apellidos} ${a.nombres}`, 'Operario', a.dni, null, null, null, null, null, 6, 50, 950, 2, 36, 936],
    ['PAREDES LUNA ROSA', 'Oficial', '61000009', null, '21/09/2026', 'BCP', '19100000000009', null, 5, null, 667, 0, 0, 667],
    ['SOTO RIOS ANA', 'Oficial', '61000010', null, null, null, null, null, 6, null, 800, 1, 16, 820],
  ];
  let r = await subirPlanilla(await excelPlanilla(filas, '(SEMANA 29) 21/09 AL 26/09'), `?obra_id=${S.obra}`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.planilla.numero, r.body.planilla.inicio, r.body.planilla.fin, r.body.planilla.pago], [29, '2026-09-21', '2026-09-26', '2026-10-03']);
  assert.deepEqual(r.body.planilla.errores, []);
  assert.equal(r.body.resumen.errores, 1);
  assert.match(r.body.filas[2].errores.join(' '), /no coincide con TOTAL PAGO/);
  assert.equal((await subirPlanilla(await excelPlanilla(filas, '(SEMANA 29) 21/09 AL 26/09'), `?obra_id=${S.obra}&confirmar=1&especialidad_id=1`)).status, 400);
  r = await subirPlanilla(await excelPlanilla(filas.slice(0, 2), '(SEMANA 29) 22/09 AL 27/09'), `?obra_id=${S.obra}`);
  assert.match(r.body.planilla.errores.join(' '), /la semana 29 empieza el 21\/09/);
  assert.equal((await subirPlanilla(await excelPlanilla(filas.slice(0, 2), '(SEMANA 29) 21/09 AL 26/09'))).status, 400); // sin obra
});

test('CP48 importación de semana pagada: registra la semana en el historial con sus boletas', async () => {
  const a = (await agent.get(`/api/trabajadores/${S.a}`)).body;
  const buf = await excelPlanilla([
    [`${a.apellidos} ${a.nombres}`, 'Operario', a.dni, null, null, null, null, null, 6, 50, 950, 2, 36, 936],
    ['PAREDES LUNA ROSA', 'Oficial', '61000009', null, '21/09/2026', 'BCP', '19100000000009', null, 5, null, 667, 0, 0, 667],
  ], '(SEMANA 29) 21/09 AL 26/09');
  const r = await subirPlanilla(buf, `?obra_id=${S.obra}&confirmar=1&especialidad_id=1`);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.semana, r.body.boletas, r.body.total_pago, r.body.registrados], [29, 2, 1603, 1]);
  const h = (await agent.get(`/api/planillas/historial?obra_id=${S.obra}`)).body.find((x) => x.semana_inicio === '2026-09-21');
  assert.deepEqual([h.numero_semana, h.origen, h.trabajadores, h.total_deposito], [29, 'EXCEL', 2, 1603]);
  const t = (await agent.get(`/api/planillas/historial/trabajador?dni=${a.dni}`)).body.boletas.find((x) => x.semana_inicio === '2026-09-21');
  assert.deepEqual([t.deposito, t.dias, t.horas_extras], [936, 6, 2]);
  const p = await pdf(agent.get(`/api/planillas/boletas.pdf?obra_id=${S.obra}&fecha=2026-09-21`)); // semana sin asistencia en CPAD
  assert.equal(p.status, 200);
  assert.equal(paginas(p.body), 2);
  const v = (await agent.get(`/api/planillas/semana?obra_id=${S.obra}&fecha=2026-09-23`)).body; // se muestra lo registrado
  assert.deepEqual([v.registro.origen, v.cierre, v.totales.deposito, v.totales.descuento], ['EXCEL', null, 1603, 50]);
  const ba = v.boletas.find((x) => x.trabajador_id === S.a);
  assert.deepEqual([ba.pago_semana, ba.neto, ba.deposito], [986, 986, 936]); // el DSCTO no figura en la boleta
  assert.equal((await subirPlanilla(buf, `?obra_id=${S.obra}&confirmar=1&especialidad_id=1`)).status, 409); // ya registrada
});

// ---------- HU14 · usuarios y roles ----------
async function sesion(usuario, clave) {
  const a = request.agent(app);
  const r = await a.post('/api/auth/ingresar').send({ usuario, clave });
  return { a, r };
}

test('CP49 seguridad: sin sesión la API responde 401, salvo el chequeo de salud', async () => {
  assert.equal((await request(app).get('/api/trabajadores')).status, 401);
  assert.equal((await request(app).get('/api/planillas/historial?obra_id=1')).status, 401);
  assert.equal((await request(app).get('/api/salud')).status, 200);
});

test('CP50 seguridad: ingreso con clave incorrecta y con clave correcta; la cookie es HttpOnly', async () => {
  const mal = await sesion('admin', 'otraClave1');
  assert.equal(mal.r.status, 401);
  const { a, r } = await sesion('admin', CLAVE);
  assert.equal(r.status, 200);
  assert.equal(r.body.rol, 'ADMINISTRADOR');
  assert.equal(r.body.clave_hash, undefined, 'nunca se devuelve el hash');
  assert.match(r.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  assert.equal((await a.get('/api/auth/yo')).body.usuario, 'admin');
  await a.post('/api/auth/salir');
  assert.equal((await a.get('/api/auth/yo')).status, 401, 'la sesión se cierra en el servidor');
});

test('CP51 usuarios: el administrador crea usuarios; la clave débil se rechaza y el usuario repetido da 409', async () => {
  assert.equal((await agent.post('/api/usuarios').send({ usuario: 'debil', nombre: 'X', rol: 'CONSULTA', clave: '12345678' })).status, 400);
  const g = await agent.post('/api/usuarios').send({ usuario: 'gerente', nombre: 'Gerente de prueba', rol: 'GERENTE', clave: 'Gerente2026' });
  assert.equal(g.status, 201);
  assert.equal(g.body.clave_hash, undefined);
  assert.equal((await agent.post('/api/usuarios').send({ usuario: 'consulta', nombre: 'Consulta de prueba', rol: 'CONSULTA', clave: 'Consulta2026' })).status, 201);
  assert.equal((await agent.post('/api/usuarios').send({ usuario: 'gerente', nombre: 'Otro', rol: 'GERENTE', clave: 'Gerente2026' })).status, 409);
  const { rows } = await pool.query(`SELECT clave_hash FROM usuario WHERE usuario = 'gerente'`);
  assert.match(rows[0].clave_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/, 'la clave se guarda con scrypt y sal');
});

test('CP52 roles: consulta solo lee; gerente lee y registra la planilla, pero no edita maestros ni usuarios', async () => {
  const c = (await sesion('consulta', 'Consulta2026')).a;
  assert.equal((await c.get('/api/trabajadores')).status, 200);
  const r1 = await c.post('/api/obras').send({ codigo: 'NO01', nombre: 'No' });
  assert.equal(r1.status, 403);
  assert.match(r1.body.error, /consulta/);
  assert.equal((await c.get('/api/usuarios')).status, 403);
  const g = (await sesion('gerente', 'Gerente2026')).a;
  assert.equal((await g.get('/api/planillas/historial?obra_id=1')).status, 200);
  assert.equal((await g.post('/api/obras').send({ codigo: 'NO02', nombre: 'No' })).status, 403);
  assert.equal((await g.put('/api/usuarios/1').send({ rol: 'CONSULTA' })).status, 403);
  // Para el gerente, el registro de planilla pasa el control de rol (la respuesta depende de la semana, no del permiso)
  assert.notEqual((await g.post('/api/planillas/registro').send({ obra_id: 1, fecha: '2026-01-05' })).status, 403);
});

test('CP53 usuarios: debe quedar un administrador activo; la baja cierra las sesiones del usuario', async () => {
  const yo = (await agent.get('/api/auth/yo')).body;
  assert.equal((await agent.put(`/api/usuarios/${yo.id}`).send({ rol: 'CONSULTA' })).status, 409);
  const { a } = await sesion('consulta', 'Consulta2026');
  const id = (await agent.get('/api/usuarios')).body.find((u) => u.usuario === 'consulta').id;
  assert.equal((await agent.put(`/api/usuarios/${id}`).send({ activo: false })).status, 200);
  assert.equal((await a.get('/api/trabajadores')).status, 401);
  assert.equal((await sesion('consulta', 'Consulta2026')).r.status, 401);
});

test('CP54 seguridad: cambio de la propia clave y bloqueo tras cinco intentos fallidos', async () => {
  const { a } = await sesion('gerente', 'Gerente2026');
  assert.equal((await a.put('/api/auth/clave').send({ actual: 'mala', nueva: 'Nueva2026x' })).status, 400);
  assert.equal((await a.put('/api/auth/clave').send({ actual: 'Gerente2026', nueva: 'Nueva2026x' })).status, 200);
  assert.equal((await sesion('gerente', 'Nueva2026x')).r.status, 200);
  for (let i = 0; i < 5; i++) await sesion('gerente', 'Incorrecta1');
  assert.equal((await sesion('gerente', 'Nueva2026x')).r.status, 429, 'bloqueado aunque ahora la clave sea correcta');
});

test('CP55 HU13: costo de mano de obra por obra a partir de las planillas registradas', async () => {
  const r = await agent.get('/api/planillas/costos');
  assert.equal(r.status, 200);
  const { rows: [esperado] } = await pool.query('SELECT count(DISTINCT obra_id)::int AS n FROM planilla_registro');
  assert.ok(esperado.n > 0);
  assert.equal(r.body.length, esperado.n, 'aparece cada obra con planillas registradas');
  const o = r.body[0];
  assert.ok(o.semanas.length > 0 && o.costo_jornal > 0);
  const suma = Math.round(o.semanas.reduce((a, s) => a + s.pago, 0) * 100) / 100;
  assert.equal(suma, o.total_pago, 'el total de la obra es la suma de sus semanas');
  const porCat = Math.round(o.categorias.reduce((a, c) => a + c.pago, 0) * 100) / 100;
  assert.equal(porCat, o.total_pago, 'y también la suma de sus categorías');
  assert.ok(o.total_deposito <= o.total_pago, 'el depósito ya tiene restado el DSCTO');
  const reg = await pool.query(`SELECT DISTINCT registrado_por FROM planilla_registro`);
  assert.deepEqual(reg.rows.map((x) => x.registrado_por), ['admin'], 'el registro guarda quién lo hizo');
  assert.equal((await agent.get('/api/planillas/costos?desde=2026-13-01')).status, 400);
});
