// Used by the updater inside the newly started panel container.
// A healthy static page is not proof that the panel can query its database.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const timeout = setTimeout(() => {
  console.error('Panel database check timed out');
  process.exit(1);
}, 5000);

(async () => {
  const rows = await db.$queryRaw`SELECT id FROM limiter_settings WHERE id = 1`;
  if (rows.length !== 1) throw new Error('Limiter settings row is missing');
})().catch((error) => {
  console.error('Panel cannot read Limiter settings from PostgreSQL:', error.code || error.message);
  process.exitCode = 1;
}).finally(async () => {
  clearTimeout(timeout);
  await db.$disconnect();
});
