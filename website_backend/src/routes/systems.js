/**
 * Filter Operators
 *
 * When defining a filter condition in `filters`, you can optionally specify an `op` (operator).
 * If omitted, the default is usually `IN` for lists or `=` for single values.
 *
 * Supported operators for leaf conditions:
 *
 *   op             Meaning
 *   =              Exact match
 *   IN             Match any of the given values (default if values is an array)
 *   ILIKE          Case-insensitive partial match (Postgres only; LIKE but case-insensitive)
 *   LIKE           Case-sensitive partial match
 *   >              Greater than
 *   <              Less than
 *   >=             Greater or equal
 *   <=             Less or equal
 *   <>             Not equal
 *   NOT IN         Not in a list
 *   IS NULL        Field is null (in this case, `values` is not required)
 *   IS NOT NULL    Field is not null
 *
 * Supported logical operators for grouping conditions:
 *
 *   op             Meaning
 *   AND            Combine conditions with logical AND
 *   OR             Combine conditions with logical OR
 *
 * Notes:
 * - Leaf conditions have `field`, `values`, and `op`.
 * - Groups have `op` and `conditions` (array of Filter).
 */

const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const NodeCache = require("node-cache");
const snapshotCache = new NodeCache({ stdTTL: 8 * 60 * 60 }); // 8 hours

const router = express.Router();

// Helper: fetch deleted user id
async function getDeletedUserId() {
  const result = await db.query(
    `SELECT id FROM users WHERE username = 'deleted_user@example.com'`
  );
  return result.rows[0]?.id;
}

function buildWhereClause(filterGroup, params, tableAliases = {}) {
  const { op = "AND", conditions = [] } = filterGroup;

  const sqlConditions = conditions.map((cond) => {
    if (cond.conditions) {
      // nested group
      return `(${buildWhereClause(cond, params, tableAliases)})`;
    }

    const { field, op: fieldOp = "=", values = [], table = null } = cond;

    const column = tableAliases[field] || (table || "") + field;

    if (["IN", "NOT IN"].includes(fieldOp.toUpperCase())) {
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${column} ${fieldOp} (${placeholders.join(", ")})`;
    }

    const orClauses = values.map((v) => {
      params.push(fieldOp.toUpperCase() === "ILIKE" ? `%${v}%` : v);
      return `${column} ${fieldOp} $${params.length}`;
    });

    return `(${orClauses.join(" OR ")})`;
  });

  return sqlConditions.join(` ${op} `);
}

/**
 * GET /api/v1/systems
 *
 * Lists systems, supporting:
 *
 * Query Parameters:
 * - filters: JSON string or object defining advanced nested filters
 *   Example:
 *     filters={
 *       "op": "AND",
 *       "conditions": [
 *         {
 *           "op": "OR",
 *           "conditions": [
 *             { "field": "service_tag", "values": ["TEST", "DEMO"], "op": "ILIKE" },
 *             { "field": "issue", "values": ["Fan"], "op": "ILIKE" }
 *           ]
 *         },
 *         {
 *           "field": "location_id",
 *           "values": [1, 2],
 *           "op": "IN"
 *         }
 *       ]
 *     }
 *
 * - Sorting:
 *     ?sort_by=service_tag|issue|location
 *     ?sort_order=asc|desc
 *
 * - Pagination:
 *     ?page=1&page_size=50
 *
 * - Fetch all:
 *     ?all=true (disables pagination and returns all rows)
 *
 * Notes:
 * - `filters` is required for advanced AND/OR and operator selection.
 * - Default sort is by `service_tag` descending.
 * - Pagination page_size is capped at 100.
 * - If `all=true`, pagination is ignored and all matching records are returned.
 */
router.get("/", async (req, res) => {
  const {
    filters, // JSON string or object with conditions
    page = 1,
    page_size = 50,
    all,
    sort_by,
    sort_order,
  } = req.query;

  const params = [];
  let whereSQL = "";

  // parse and build where clause
  if (filters) {
    const parsed = typeof filters === "string" ? JSON.parse(filters) : filters;

    whereSQL =
      parsed && parsed.conditions?.length
        ? `WHERE ${buildWhereClause(parsed, params, {
            service_tag: "s.service_tag",
            issue: "s.issue",
            location_id: "s.location_id",
            location: "l.name",
          })}`
        : "";
  }

  // Sorting
  const allowedSortColumns = {
    service_tag: "s.service_tag",
    issue: "s.issue",
    location: "l.name",
    date_created: "first_history.changed_at",
    date_modified: "last_history.changed_at",
    added_by: "first_user.username",
  };

  const orderColumn = allowedSortColumns[sort_by] || "s.service_tag";
  const orderDirection = sort_order === "asc" ? "ASC" : "DESC";

  let limitOffsetSQL = "";
  let pageNum, pageSize, offset;

  if (!all || all === "false") {
    pageNum = Math.max(parseInt(page), 1);
    pageSize = Math.min(parseInt(page_size), 100);
    offset = (pageNum - 1) * pageSize;
    limitOffsetSQL = `LIMIT ${pageSize} OFFSET ${offset}`;
  }

  try {
    const [dataResult, countResult] = await Promise.all([
      db.query(
        `
        SELECT 
          s.service_tag,
          s.issue,
          l.name AS location,
          first_history.changed_at AS date_created,
          first_user.username AS added_by,
          last_history.changed_at AS date_modified
        FROM system s
        JOIN location l ON s.location_id = l.id

        -- first history entry per system
        LEFT JOIN LATERAL (
          SELECT h.changed_at, h.moved_by
          FROM system_location_history h
          WHERE h.system_id = s.id
          ORDER BY h.changed_at ASC
          LIMIT 1
        ) AS first_history ON TRUE

        LEFT JOIN users first_user ON first_user.id = first_history.moved_by

        -- last history entry per system
        LEFT JOIN LATERAL (
          SELECT h.changed_at
          FROM system_location_history h
          WHERE h.system_id = s.id
          ORDER BY h.changed_at DESC
          LIMIT 1
        ) AS last_history ON TRUE

        ${whereSQL}
        ORDER BY ${orderColumn} ${orderDirection}
        ${limitOffsetSQL}
        `,
        params
      ),
      !all || all === "false"
        ? db.query(
            `
            SELECT COUNT(*) AS count
            FROM system s
            JOIN location l ON s.location_id = l.id
            ${whereSQL}
            `,
            params
          )
        : Promise.resolve({ rows: [] }),
    ]);

    if (all && all !== "false") {
      return res.json(dataResult.rows);
    }

    const total_count = parseInt(countResult.rows[0].count);

    res.json({
      data: dataResult.rows,
      total_count,
      page: pageNum,
      page_size: pageSize,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch systems" });
  }
});

router.get("/snapshot", async (req, res) => {
  const { date, locations } = req.query;

  if (!date) {
    return res
      .status(400)
      .json({ error: "Missing required `date` query param" });
  }

  const cacheKey = `${date}:${locations || ""}`;

  const cached = snapshotCache.get(cacheKey);
  if (cached) {
    // reset TTL to keep it alive another 5 mins
    snapshotCache.ttl(cacheKey, 300);
    return res.json(cached);
  }

  const params = [new Date(`${date}T23:59:59`).toISOString()];
  const locationFilterSQL = [];

  if (locations) {
    const locationList = locations.split(",").map((loc) => loc.trim());
    if (locationList.length > 0) {
      const placeholders = locationList.map((_, idx) => `$${idx + 2}`);
      locationFilterSQL.push(`AND l.name IN (${placeholders.join(", ")})`);
      params.push(...locationList);
    }
  }

  try {
    const snapshotResult = await db.query(
      `
      SELECT 
        s.service_tag,
        s.issue,
        l.name AS location,
        h.changed_at AS as_of
      FROM system s
      JOIN (
          SELECT DISTINCT ON (h.system_id)
            h.system_id,
            h.to_location_id,
            h.changed_at
          FROM system_location_history h
          WHERE h.changed_at <= $1
          ORDER BY h.system_id, h.changed_at DESC
      ) h ON h.system_id = s.id
      JOIN location l ON h.to_location_id = l.id
      WHERE 1=1
      ${locationFilterSQL.join(" ")}
      ORDER BY s.service_tag
      `,
      params
    );

    snapshotCache.set(cacheKey, snapshotResult.rows);
    res.json(snapshotResult.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch snapshot" });
  }
});

/**
 * GET /api/v1/systems/history
 *
 * Lists system location history records, supporting:
 *
 * Query Parameters:
 * - filters: JSON string or object defining advanced nested filters
 *   Example:
 *     filters={
 *       "op": "AND",
 *       "conditions": [
 *         {
 *           "field": "service_tag",
 *           "values": ["TEST123", "STAGE"],
 *           "op": "ILIKE"
 *         },
 *         {
 *           "op": "OR",
 *           "conditions": [
 *             { "field": "from_location_id", "values": [1], "op": "IN" },
 *             { "field": "to_location_id", "values": [2], "op": "IN" }
 *           ]
 *         }
 *       ]
 *     }
 *
 * - Sorting:
 *     ?sort_by=changed_at|service_tag|from_location_id|to_location_id|moved_by
 *     ?sort_order=asc|desc
 *
 * - Pagination:
 *     ?page=1&page_size=50
 *
 * - Fetch all:
 *     ?all=true (disables pagination and returns all rows)
 *
 * Notes:
 * - `filters` is required for advanced AND/OR and operator selection.
 * - Default sort is by `changed_at` descending.
 * - Pagination page_size is capped at 100.
 * - If `all=true`, pagination is ignored and all matching records are returned.
 */
router.get("/history", async (req, res) => {
  const {
    all,
    page = 1,
    page_size = 50,
    sort_by = "changed_at",
    sort_order = "desc",
    filters, // new
  } = req.query;

  const params = [];
  let whereSQL = "";

  if (filters) {
    const parsed = typeof filters === "string" ? JSON.parse(filters) : filters;

    whereSQL =
      parsed && parsed.conditions?.length
        ? `WHERE ${buildWhereClause(parsed, params, {
            service_tag: "s.service_tag",
            from_location_id: "h.from_location_id",
            to_location_id: "h.to_location_id",
            moved_by_id: "h.moved_by",
          })}`
        : "";
  }

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

  let limitOffsetSQL = "";
  let pageNum, pageSize, offset;

  if (!all || all === "false") {
    pageNum = Math.max(1, parseInt(page));
    pageSize = Math.min(100, parseInt(page_size));
    offset = (pageNum - 1) * pageSize;
    limitOffsetSQL = `LIMIT ${pageSize} OFFSET ${offset}`;
  }

  try {
    const [dataResult, countResult] = await Promise.all([
      db.query(
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
      ),
      !all || all === "false"
        ? db.query(
            `
            SELECT COUNT(*) AS count
            FROM system_location_history h
            JOIN system s ON h.system_id = s.id
            LEFT JOIN location l_from ON h.from_location_id = l_from.id
            JOIN location l_to ON h.to_location_id = l_to.id
            JOIN users u ON h.moved_by = u.id
            ${whereSQL}
            `,
            params
          )
        : Promise.resolve({ rows: [] }),
    ]);

    if (all && all !== "false") {
      return res.json(dataResult.rows);
    }

    const total_count = parseInt(countResult.rows[0].count);

    res.json({
      data: dataResult.rows,
      total_count,
      page: pageNum,
      page_size: pageSize,
    });
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
