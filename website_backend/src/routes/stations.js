const express = require("express");
const db = require("../db");

const router = express.Router();

// GET all stations
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM station ORDER BY id ASC");
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
      "SELECT * FROM station WHERE station_name = $1",
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

  try {
    const { rowCount } = await db.query(
      `
      UPDATE station
      SET
        system_id = COALESCE($1, system_id),
        status = COALESCE($2, status),
        message = COALESCE($3, message)
      WHERE station_name = $4
      `,
      [system_id, status, message, station_name]
    );

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
