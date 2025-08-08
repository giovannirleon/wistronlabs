// db helper

const db = require("../db");

async function systemOnLockedPallet(clientOrDb, systemId) {
  const q = `
    SELECT EXISTS (
      SELECT 1
      FROM pallet_system ps
      JOIN pallet p ON p.id = ps.pallet_id
      WHERE ps.system_id = $1
        AND ps.removed_at IS NULL
        AND p.locked = TRUE
    ) AS on_locked
  `;
  const { rows } = await (clientOrDb.query ? clientOrDb : db).query(q, [
    systemId,
  ]);
  return rows[0].on_locked;
}
module.exports = { systemOnLockedPallet };
