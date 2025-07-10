const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/v1/systems - list all systems, optional ?location_id=
router.get("/", async (req, res) => {
  const { location_id } = req.query;

  const result = await db.query(
    `
    SELECT s.service_tag, s.issue, l.name AS location
    FROM system s
    JOIN location l ON s.location_id = l.id
    WHERE ($1::int IS NULL OR s.location_id = $1)
    ORDER BY s.service_tag
  `,
    [location_id || null]
  );

  res.json(result.rows);
});

// GET /api/v1/systems/history - full ledger
router.get("/history", async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT 
        s.service_tag,
        l_from.name AS from_location,
        l_to.name AS to_location,
        h.note,
        h.changed_at
      FROM system_location_history h
      JOIN system s ON h.system_id = s.id
      LEFT JOIN location l_from ON h.from_location_id = l_from.id
      JOIN location l_to ON h.to_location_id = l_to.id
      ORDER BY h.changed_at DESC
      `
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history ledger" });
  }
});

// GET /api/v1/systems/:service_tag
router.get("/:service_tag", async (req, res) => {
  const { service_tag } = req.params;

  const result = await db.query(
    `
    SELECT s.id, s.service_tag, s.issue, l.name AS location
    FROM system s
    JOIN location l ON s.location_id = l.id
    WHERE s.service_tag = $1
  `,
    [service_tag]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "System not found" });
  }

  res.json(result.rows[0]);
});

// GET /api/v1/systems/:service_tag/history
router.get("/:service_tag/history", async (req, res) => {
  const { service_tag } = req.params;

  const systemResult = await db.query(
    "SELECT id FROM system WHERE service_tag = $1",
    [service_tag]
  );

  if (systemResult.rows.length === 0) {
    return res.status(404).json({ error: "System not found" });
  }

  const system_id = systemResult.rows[0].id;

  const result = await db.query(
    `
    SELECT h.id, l_from.name AS from_location, l_to.name AS to_location, h.note, h.changed_at
    FROM system_location_history h
    LEFT JOIN location l_from ON h.from_location_id = l_from.id
    JOIN location l_to ON h.to_location_id = l_to.id
    WHERE h.system_id = $1
    ORDER BY h.changed_at DESC
  `,
    [system_id]
  );

  res.json(result.rows);
});

// POST /api/v1/systems
router.post("/", async (req, res) => {
  const { service_tag, issue, location_id, note } = req.body;

  if (!service_tag || !location_id || !note) {
    return res
      .status(400)
      .json({ error: "service_tag, location_id, and note are required" });
  }

  try {
    await db.query("BEGIN");

    const insertSystem = await db.query(
      `
      INSERT INTO system (service_tag, issue, location_id)
      VALUES ($1, $2, $3) RETURNING id
    `,
      [service_tag, issue, location_id]
    );

    const system_id = insertSystem.rows[0].id;

    await db.query(
      `
      INSERT INTO system_location_history (system_id, from_location_id, to_location_id, note)
      VALUES ($1, NULL, $2, $3)
    `,
      [system_id, location_id, note]
    );

    await db.query("COMMIT");

    res.status(201).json({ service_tag });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to create system" });
  }
});

// PATCH /api/v1/systems/:service_tag/location
router.patch("/:service_tag/location", async (req, res) => {
  const { service_tag } = req.params;
  const { to_location_id, note } = req.body;

  if (!to_location_id || !note) {
    return res
      .status(400)
      .json({ error: "to_location_id and note are required" });
  }

  try {
    await db.query("BEGIN");

    const systemResult = await db.query(
      "SELECT id, location_id FROM system WHERE service_tag = $1",
      [service_tag]
    );

    if (systemResult.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ error: "System not found" });
    }

    const { id: system_id, location_id: from_location_id } =
      systemResult.rows[0];

    await db.query("UPDATE system SET location_id = $1 WHERE id = $2", [
      to_location_id,
      system_id,
    ]);

    await db.query(
      `
      INSERT INTO system_location_history (system_id, from_location_id, to_location_id, note)
      VALUES ($1, $2, $3, $4)
    `,
      [system_id, from_location_id, to_location_id, note]
    );

    await db.query("COMMIT");

    res.json({ message: "Location updated" });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to update location" });
  }
});

// PATCH /api/v1/systems/:service_tag/issue
router.patch("/:service_tag/issue", async (req, res) => {
  const { service_tag } = req.params;
  const { issue } = req.body;

  if (!issue) {
    return res.status(400).json({ error: "issue is required" });
  }

  const result = await db.query(
    "UPDATE system SET issue = $1 WHERE service_tag = $2 RETURNING service_tag",
    [issue, service_tag]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "System not found" });
  }

  res.json({ message: "Issue updated" });
});

// DELETE /api/v1/systems/:service_tag
router.delete("/:service_tag", async (req, res) => {
  const { service_tag } = req.params;

  const result = await db.query(
    "DELETE FROM system WHERE service_tag = $1 RETURNING service_tag",
    [service_tag]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "System not found" });
  }

  res.json({ message: "System deleted" });
});

module.exports = router;
