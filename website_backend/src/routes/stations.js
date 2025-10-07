const express = require("express");
const db = require("../db");

const router = express.Router();

// GET all stations
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id, s.station_name, s.status, s.message,
             s.system_id,
             s.last_updated,
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
             s.last_updated,
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
  // Only these fields affect last_updated
  const { system_id, status, message } = req.body;

  try {
    // 1) Load current values
    const curRes = await db.query(
      `SELECT system_id, status, message, last_updated FROM station WHERE station_name = $1`,
      [station_name]
    );
    if (curRes.rowCount === 0) {
      return res.status(404).json({ error: "Station not found" });
    }
    const current = curRes.rows[0];

    // 2) Determine effective changes (ignore same-value updates)
    const updates = [];
    const values = [];
    let i = 1;

    const wantSystem = Object.prototype.hasOwnProperty.call(
      req.body,
      "system_id"
    );
    const wantStatus = Object.prototype.hasOwnProperty.call(req.body, "status");
    const wantMessage = Object.prototype.hasOwnProperty.call(
      req.body,
      "message"
    );

    if (wantSystem && system_id !== current.system_id) {
      updates.push(`system_id = $${i++}`);
      values.push(system_id);
    }
    if (wantStatus && status !== current.status) {
      updates.push(`status = $${i++}`);
      values.push(status);
    }
    if (wantMessage && (message ?? "") !== (current.message ?? "")) {
      updates.push(`message = $${i++}`);
      values.push(message ?? "");
    }

    // Nothing really changed → return current state without bumping last_updated
    if (updates.length === 0) {
      return res.json({
        message: "No effective changes",
        last_updated: current.last_updated,
      });
    }

    // 3) Apply changes + bump last_updated
    updates.push(`last_updated = NOW()`);

    values.push(station_name);
    const sql = `
      UPDATE station
         SET ${updates.join(", ")}
       WHERE station_name = $${i}
       RETURNING station_name, system_id, status, message, last_updated
    `;

    const updRes = await db.query(sql, values);
    return res.json({
      message: "Station updated",
      ...updRes.rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to update station" });
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
      INSERT INTO station (station_name, system_id, status, message, last_updated)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
      `,
      [station_name, system_id ?? null, status ?? 0, message ?? ""]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
