// scripts/backfillOpenPalletShapes.js
const db = require("../db"); // your pooled client

const SHAPE_PRIORITY = [
  "star",
  "triangle_up",
  "triangle_right",
  "triangle_left",
  "triangle_down",
  "circle",
  "square",
  "diamond",
  "pentagon",
  "hexagon",
];

async function allocateShapeForOpenPallet(client) {
  const { rows } = await client.query(
    `SELECT shape FROM pallet WHERE status = 'open' AND shape IS NOT NULL`
  );
  const inUse = new Set(rows.map((r) => r.shape));

  for (const s of SHAPE_PRIORITY) if (!inUse.has(s)) return s;

  const nextSuffix = new Map(SHAPE_PRIORITY.map((s) => [s, 2]));
  for (const used of inUse) {
    const m = used.match(/^(.+)-(\d+)$/);
    if (!m) continue;
    const base = m[1],
      n = parseInt(m[2], 10);
    if (SHAPE_PRIORITY.includes(base) && Number.isFinite(n)) {
      nextSuffix.set(base, Math.max(nextSuffix.get(base) || 2, n + 1));
    }
  }
  for (const base of SHAPE_PRIORITY) {
    const cand = `${base}-${nextSuffix.get(base) || 2}`;
    if (!inUse.has(cand)) return cand;
  }
  return "star-2";
}

async function main() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Lock only the rows we’ll edit, in a stable order
    const { rows: pallets } = await client.query(
      `
      SELECT id
      FROM pallet
      WHERE status = 'open' AND (shape IS NULL OR TRIM(shape) = '')
      ORDER BY created_at ASC
      FOR UPDATE
      `
    );

    for (const { id } of pallets) {
      const shape = await allocateShapeForOpenPallet(client);
      await client.query(`UPDATE pallet SET shape = $2 WHERE id = $1`, [
        id,
        shape,
      ]);
    }

    await client.query("COMMIT");
    console.log(`Backfilled ${pallets.length} open pallets with shapes.`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
