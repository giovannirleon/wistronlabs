const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/v1/locations
router.get("/", async (req, res) => {
  const result = await db.query("SELECT id, name FROM location ORDER BY id");
  res.json(result.rows);
});

// GET /api/v1/locations/:location_id
router.get("/:location_id", async (req, res) => {
  const { location_id } = req.params;

  const result = await db.query("SELECT id, name FROM location WHERE id = $1", [
    location_id,
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Location not found" });
  }

  res.json(result.rows[0]);
});

// GET /api/v1/locations/:location_id/history
router.get("/:location_id/history", async (req, res) => {
  const { location_id } = req.params;

  const result = await db.query(
    `
    SELECT h.id, s.service_tag, l_from.name AS from_location,
           l_to.name AS to_location, h.note, h.changed_at
    FROM system_location_history h
    JOIN system s ON h.system_id = s.id
    LEFT JOIN location l_from ON h.from_location_id = l_from.id
    JOIN location l_to ON h.to_location_id = l_to.id
    WHERE h.to_location_id = $1
    ORDER BY h.changed_at DESC
  `,
    [location_id]
  );

  res.json(result.rows);
});

module.exports = router;
