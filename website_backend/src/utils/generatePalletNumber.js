/**
 * Generate a pallet number in the format:
 * PAL-[FACTORY]-[DPN]-MMDDYYXX
 * Where XX is sequential per (factory_id + dpn_id) per day.
 *
 * @param {number} factory_id
 * @param {number} dpn_id
 * @param {object} client - a pg client inside an open transaction
 * @returns {Promise<string>}
 */
async function generatePalletNumber(factory_id, dpn_id, client) {
  // Factory code
  const { rows: fRows } = await client.query(
    `SELECT code FROM factory WHERE id = $1`,
    [factory_id]
  );
  if (!fRows.length) throw new Error(`Factory with id ${factory_id} not found`);
  const factoryCode = fRows[0].code;

  if (!dpn_id) throw new Error("Cannot create pallet without a DPN");

  // DPN name
  const { rows: dRows } = await client.query(
    `SELECT name FROM dpn WHERE id = $1`,
    [dpn_id]
  );
  if (!dRows.length) throw new Error(`DPN with id ${dpn_id} not found`);
  const dpnName = dRows[0].name;

  // MMDDYY string
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const dateStr = `${mm}${dd}${yy}`;

  // Count existing pallets today for (factory_id, dpn_id)
  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS count
         FROM pallet
        WHERE factory_id = $1
          AND dpn_id     = $2
          AND to_char(created_at, 'MMDDYY') = $3`,
    [factory_id, dpn_id, dateStr]
  );

  const suffix = String(countRows[0].count + 1).padStart(2, "0");
  return `PAL-${factoryCode}-${dpnName}-${dateStr}${suffix}`;
}

module.exports = { generatePalletNumber };
