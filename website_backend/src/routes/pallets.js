const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/v1/pallets
router.get("/", async (req, res) => {
  try {
    const pallets = await db.query(
      `
      SELECT p.id, p.pallet_number, p.factory_id, p.dpn, p.status,
             json_agg(json_build_object(
               'system_id', ps.system_id,
               'service_tag', s.service_tag
             )) FILTER (WHERE ps.removed_at IS NULL) AS active_systems
      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      LEFT JOIN system s ON s.id = ps.system_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      `
    );

    res.json(pallets.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pallets" });
  }
});

// GET /api/v1/pallets/:pallet_number
router.get("/:pallet_number", async (req, res) => {
  const { pallet_number } = req.params;
  try {
    const result = await db.query(
      `
      SELECT p.id, p.pallet_number, p.factory_id, p.dpn, p.status,
             json_agg(json_build_object(
               'system_id', ps.system_id,
               'service_tag', s.service_tag
             )) FILTER (WHERE ps.removed_at IS NULL) AS active_systems
      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      LEFT JOIN system s ON s.id = ps.system_id
      WHERE p.pallet_number = $1
      GROUP BY p.id
      `,
      [pallet_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pallet not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pallet" });
  }
});

module.exports = router;
