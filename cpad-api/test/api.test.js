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
