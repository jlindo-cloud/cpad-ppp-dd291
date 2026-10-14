'use strict';
// Base de datos PostgreSQL local para desarrollo (embebida). Uso: npm run dev:db
const EmbeddedPostgres = require('embedded-postgres').default;
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(process.env.CPAD_DEV_DIR || path.join(__dirname, '../.dev-db'));
const port = Number(process.env.CPAD_DEV_PORT) || 54331;
(async () => {
  fs.mkdirSync(base, { recursive: true }); fs.chmodSync(base, 0o777);
  const dataDir = path.join(base, 'data');
  const nueva = !fs.existsSync(dataDir);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'cpad', password: 'cpad', port, persistent: true, onLog: () => {} });
  if (nueva) await pg.initialise();
  await pg.start();
  if (nueva) await pg.createDatabase('cpad');
  console.log(`PostgreSQL de desarrollo en postgres://cpad:cpad@localhost:${port}/cpad`);
  const salir = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', salir); process.on('SIGTERM', salir);
})().catch((e) => { console.error(e); process.exit(1); });
