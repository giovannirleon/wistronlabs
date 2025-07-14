const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

// Helper: fetch deleted user id
async function getDeletedUserId() {
  const result = await db.query(
    `SELECT id FROM users WHERE username = 'deleted_user@example.com'`
  );
  return result.rows[0]?.id;
}

// GET /api/v1/systems - list all systems, optional ?location_id=
router.get("/", async (req, res) => {
  const { location_id } = req.query;

  const params = [];
  let whereClause = "";
  if (location_id) {
    params.push(location_id);
    whereClause = `WHERE s.location_id = $${params.length}`;
  }

  try {
    const result = await db.query(
      `
      SELECT s.service_tag, s.issue, l.name AS location
      FROM system s
      JOIN location l ON s.location_id = l.id
      ${whereClause}
      ORDER BY s.service_tag
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch systems" });
  }
});

// GET /api/v1/systems/history - full ledger (optionally filtered by ?service_tag)
router.get("/history", async (req, res) => {
  const { service_tag } = req.query;

  const params = [];
  let whereClause = "";
  if (service_tag) {
    params.push(service_tag);
    whereClause = `WHERE s.service_tag = $${params.length}`;
  }

  try {
    const result = await db.query(
      `
      SELECT 
        h.id,
        s.service_tag,
        l_from.name AS from_location,
        l_to.name AS to_location,
        u.username AS moved_by,
        h.note,
        h.changed_at
      FROM system_location_history h
      JOIN system s ON h.system_id = s.id
      LEFT JOIN location l_from ON h.from_location_id = l_from.id
      JOIN location l_to ON h.to_location_id = l_to.id
      JOIN users u ON h.moved_by = u.id
      ${whereClause}
      ORDER BY h.changed_at DESC
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history ledger" });
  }
});

router.get("/history/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `
      SELECT 
        h.id,
        s.service_tag,
        l_from.name AS from_location,
        l_to.name AS to_location,
        u.username AS moved_by,
        h.note,
        h.changed_at
      FROM system_location_history h
      JOIN system s ON h.system_id = s.id
      LEFT JOIN location l_from ON h.from_location_id = l_from.id
      JOIN location l_to ON h.to_location_id = l_to.id
      JOIN users u ON h.moved_by = u.id
      WHERE h.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "History record not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history record" });
  }
});

// DELETE /api/v1/systems/:service_tag/history/last
router.delete("/:service_tag/history/last", async (req, res, next) => {
  const { service_tag } = req.params;

  try {
    const systemResult = await db.query(
      "SELECT id FROM system WHERE service_tag = $1",
      [service_tag]
    );

    if (systemResult.rows.length === 0) {
      return res.status(404).json({ error: "System not found" });
    }

    const system_id = systemResult.rows[0].id;

    const historyResult = await db.query(
      `
      SELECT id, to_location_id, moved_by
      FROM system_location_history
      WHERE system_id = $1
      ORDER BY changed_at DESC
      LIMIT 1
      `,
      [system_id]
    );

    if (historyResult.rows.length === 0) {
      return res.status(404).json({ error: "No history entries found" });
    }

    const {
      id: history_id,
      to_location_id: latestToLocation,
      moved_by,
    } = historyResult.rows[0];

    const deletedUserId = await getDeletedUserId();

    // If last entry not moved by deleted user, require auth
    if (moved_by !== deletedUserId) {
      return authenticateToken(req, res, () => deleteLastHistory());
    }

    // otherwise, continue
    deleteLastHistory();

    async function deleteLastHistory() {
      await db.query("DELETE FROM system_location_history WHERE id = $1", [
        history_id,
      ]);

      res.json({ message: "Last history entry deleted" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete last history entry" });
  }
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
    SELECT h.id, l_from.name AS from_location, l_to.name AS to_location, h.note, u.username AS moved_by, h.changed_at
    FROM system_location_history h
    LEFT JOIN location l_from ON h.from_location_id = l_from.id
    JOIN location l_to ON h.to_location_id = l_to.id
    JOIN users u ON h.moved_by = u.id
    WHERE h.system_id = $1
    ORDER BY h.changed_at DESC
  `,
    [system_id]
  );

  res.json(result.rows);
});

// POST /api/v1/systems
router.post("/", authenticateToken, async (req, res) => {
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
      INSERT INTO system_location_history (system_id, from_location_id, to_location_id, note, moved_by)
      VALUES ($1, NULL, $2, $3, $4)
    `,
      [system_id, location_id, note, req.user.userId]
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
router.patch("/:service_tag/location", authenticateToken, async (req, res) => {
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
      INSERT INTO system_location_history (system_id, from_location_id, to_location_id, note, moved_by)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [system_id, from_location_id, to_location_id, note, req.user.userId]
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
router.patch("/:service_tag/issue", authenticateToken, async (req, res) => {
  const { service_tag } = req.params;
  const { issue } = req.body;

  if (!issue) {
    return res.status(400).json({ error: "issue is required" });
  }

  try {
    const result = await db.query(
      "UPDATE system SET issue = $1 WHERE service_tag = $2 RETURNING service_tag",
      [issue, service_tag]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "System not found" });
    }

    res.json({ message: "Issue updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update issue" });
  }
});

// DELETE /api/v1/systems/:service_tag
router.delete("/:service_tag", authenticateToken, async (req, res) => {
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
