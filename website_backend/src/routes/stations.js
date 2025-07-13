const express = require("express");
const db = require("../db");

const router = express.Router();

// GET all stations
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id, s.station_name, s.status, s.message,
             s.system_id,
             sys.service_tag AS system_service_tag
      FROM station s
      LEFT JOIN system sys ON s.system_id = sys.id
      ORDER BY s.id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});

// GET one station by station_name
router.get("/:station_name", async (req, res) => {
  const station_name = req.params.station_name;
  try {
    const { rows } = await db.query(
      `
      SELECT s.id, s.station_name, s.status, s.message,
             s.system_id,
             sys.service_tag AS system_service_tag
      FROM station s
      LEFT JOIN system sys ON s.system_id = sys.id
      WHERE s.station_name = $1
    `,
      [station_name]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Station not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch station" });
  }
});

// PATCH one station by station_name
router.patch("/:station_name", async (req, res) => {
  const station_name = req.params.station_name;
  const { system_id, status, message } = req.body;

  const updates = [];
  const values = [];
  let idx = 1;

  if ("system_id" in req.body) {
    updates.push(`system_id = $${idx++}`);
    values.push(system_id);
  }
  if ("status" in req.body) {
    updates.push(`status = $${idx++}`);
    values.push(status);
  }
  if ("message" in req.body) {
    updates.push(`message = $${idx++}`);
    values.push(message);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No fields provided to update" });
  }

  values.push(station_name);

  const sql = `
    UPDATE station
    SET ${updates.join(", ")}
    WHERE station_name = $${idx}
  `;

  try {
    const { rowCount } = await db.query(sql, values);

    if (rowCount === 0) {
      return res.status(404).json({ error: "Station not found" });
    }

    res.json({ message: "Station updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update station" });
  }
});

// DELETE one station by station_name
router.delete("/:station_name", async (req, res) => {
  const station_name = req.params.station_name;
  try {
    const { rowCount } = await db.query(
      "DELETE FROM station WHERE station_name = $1",
      [station_name]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Station not found" });
    }
    res.json({ message: "Station deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete station" });
  }
});

// POST /api/stations
router.post("/", async (req, res) => {
  const { station_name, system_id, status, message } = req.body;

  if (!station_name) {
    return res.status(400).json({ error: "station_name is required" });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO station (station_name, system_id, status, message)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [station_name, system_id || null, status || 0, message || ""]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
