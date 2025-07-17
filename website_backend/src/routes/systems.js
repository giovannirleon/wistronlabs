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

// GET /api/v1/systems - list all systems, with optional filters, sorting, pagination, and all=true
router.get("/", async (req, res) => {
  const {
    service_tag,
    issue,
    location_id,
    page,
    page_size,
    all,
    sort_by,
    sort_order,
  } = req.query;

  const params = [];
  const conditions = [];

  // Filters
  if (service_tag) {
    params.push(service_tag);
    conditions.push(`s.service_tag = $${params.length}`);
  }

  if (issue) {
    params.push(issue);
    conditions.push(`s.issue ILIKE $${params.length}`);
  }

  if (location_id) {
    params.push(location_id);
    conditions.push(`s.location_id = $${params.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Sorting
  const allowedSortColumns = {
    service_tag: "s.service_tag",
    issue: "s.issue",
    location: "l.name",
  };

  const orderColumn = allowedSortColumns[sort_by] || "s.service_tag";
  const orderDirection = sort_order === "asc" ? "ASC" : "DESC";

  // Pagination
  let limitOffsetClause = "";
  if (!all || all === "false") {
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const pageSize = Math.min(parseInt(page_size) || 50, 100);
    const offset = (pageNum - 1) * pageSize;

    limitOffsetClause = `LIMIT ${pageSize} OFFSET ${offset}`;
  }

  try {
    const result = await db.query(
      `
      SELECT s.service_tag, s.issue, l.name AS location
      FROM system s
      JOIN location l ON s.location_id = l.id
      ${whereClause}
      ORDER BY ${orderColumn} ${orderDirection}
      ${limitOffsetClause}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch systems" });
  }
});

/**
 * GET /api/v1/systems/history
 *
 * Returns a list of system location history records (ledger).
 *
 * Supports:
 * - Pagination: use `page` (default: 1) and `page_size` (default: 50, max: 100)
 * - Fetch all records: set `all=true` to ignore pagination
 * - Filtering: any combination of:
 *      ?service_tag=<string>
 *      ?from_location_id=<id>
 *      ?to_location_id=<id>
 *      ?moved_by_id=<id>
 * - Sorting: use
 *      ?sort_by=<field> (allowed: changed_at, service_tag, from_location_id, to_location_id, moved_by)
 *      ?sort_order=asc|desc (default: desc)
 *
 * Example requests:
 *   GET /api/v1/systems/history?page=1&page_size=25&sort_by=service_tag&sort_order=asc
 *   GET /api/v1/systems/history?service_tag=ABC123&all=true
 *
 * Response: JSON array of history records, each with:
 *   - id
 *   - service_tag
 *   - from_location
 *   - to_location
 *   - moved_by
 *   - note
 *   - changed_at
 */

router.get("/history", async (req, res) => {
  const {
    all,
    page = 1,
    page_size = 50,
    service_tag,
    from_location_id,
    to_location_id,
    moved_by_id,
    sort_by = "changed_at",
    sort_order = "desc",
  } = req.query;

  const params = [];
  const whereClauses = [];

  // Filtering
  if (service_tag) {
    params.push(service_tag);
    whereClauses.push(`s.service_tag = $${params.length}`);
  }
  if (from_location_id) {
    params.push(from_location_id);
    whereClauses.push(`h.from_location_id = $${params.length}`);
  }
  if (to_location_id) {
    params.push(to_location_id);
    whereClauses.push(`h.to_location_id = $${params.length}`);
  }
  if (moved_by_id) {
    params.push(moved_by_id);
    whereClauses.push(`h.moved_by = $${params.length}`);
  }

  const whereSQL =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // Validate sorting
  const ALLOWED_SORT_FIELDS = [
    "changed_at",
    "service_tag",
    "from_location_id",
    "to_location_id",
    "moved_by",
  ];

  const safeSortBy = ALLOWED_SORT_FIELDS.includes(sort_by)
    ? sort_by
    : "changed_at";
  const safeSortOrder = sort_order.toLowerCase() === "asc" ? "ASC" : "DESC";

  // Pagination
  let limitOffsetSQL = "";
  if (!all) {
    const limit = Math.max(1, Math.min(parseInt(page_size), 100)); // cap page size to 100
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;
    limitOffsetSQL = `LIMIT ${limit} OFFSET ${offset}`;
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
      ${whereSQL}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      ${limitOffsetSQL}
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch history ledger" });
  }
});

// GET /api/v1/systems/history/:id - get single history entry by ID
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
router.delete(
  "/:service_tag/history/last",
  authenticateToken,
  async (req, res) => {
    const { service_tag } = req.params;

    try {
      // 1️ Find system by service_tag
      const systemResult = await db.query(
        "SELECT id FROM system WHERE service_tag = $1",
        [service_tag]
      );

      if (systemResult.rows.length === 0) {
        return res.status(404).json({ error: "System not found" });
      }

      const system_id = systemResult.rows[0].id;

      // 2️ Get all history entries for this system, ordered newest to oldest
      const historyResult = await db.query(
        `
      SELECT id, moved_by
      FROM system_location_history
      WHERE system_id = $1
      ORDER BY changed_at DESC
      `,
        [system_id]
      );

      if (historyResult.rows.length === 0) {
        return res.status(404).json({ error: "No history entries found" });
      }

      if (historyResult.rows.length === 1) {
        return res
          .status(400)
          .json({ error: "Cannot delete the first history entry" });
      }

      const { id: history_id, moved_by } = historyResult.rows[0];

      // 3️ Get deleted_user id
      const deletedUserIdResult = await db.query(
        `SELECT id FROM users WHERE username = 'deleted_user@example.com'`
      );
      const deletedUserId = deletedUserIdResult.rows[0]?.id;

      if (!deletedUserId) {
        return res.status(500).json({ error: "Deleted user not configured" });
      }

      // 4️ Check authorization: must be the mover OR deleted_user OR admin
      if (moved_by !== deletedUserId && moved_by !== req.user.userId) {
        return res.status(403).json({
          error:
            "You are not authorized to delete this history entry. Only the original mover or any authenticated user if done by deleted_user can delete.",
        });
      }

      // 5️ Delete the latest history entry
      await db.query("DELETE FROM system_location_history WHERE id = $1", [
        history_id,
      ]);

      // 6️ Roll back system.location_id to the new latest history entry
      const latestRemaining = await db.query(
        `
      SELECT to_location_id
      FROM system_location_history
      WHERE system_id = $1
      ORDER BY changed_at DESC
      LIMIT 1
      `,
        [system_id]
      );

      const rollbackLocation =
        latestRemaining.rows.length > 0
          ? latestRemaining.rows[0].to_location_id
          : null;

      await db.query("UPDATE system SET location_id = $1 WHERE id = $2", [
        rollbackLocation,
        system_id,
      ]);

      res.json({
        message: "Last history entry deleted, system location rolled back",
        new_location_id: rollbackLocation,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete last history entry" });
    }
  }
);

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

// GET /api/v1/systems/:service_tag - get single system
router.get("/:service_tag", async (req, res) => {
  const { service_tag } = req.params;

  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch system" });
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
