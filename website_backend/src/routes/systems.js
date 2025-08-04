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

// RMA location IDs (must match DB)
const RMA_LOCATION_IDS = [6, 7, 8];

/**
 * Generate a pallet number in the format:
 * PAL-[FACTORY]-[DPN]-MMDDYYXX
 * Where XX is sequential per factory+dpn per day.
 */
async function generatePalletNumber(factory_id, dpn, client) {
  // Get factory code
  const { rows: fRows } = await client.query(
    `SELECT code FROM factory WHERE id = $1`,
    [factory_id]
  );
  if (!fRows.length) {
    throw new Error(`Factory with id ${factory_id} not found`);
  }
  const factoryCode = fRows[0].code;

  // Build date string (MMDDYY)
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const dateStr = `${mm}${dd}${yy}`;

  // Count pallets for this factory+dpn on this day
  const { rows: countRows } = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM pallet
    WHERE factory_id = $1
      AND dpn = $2
      AND to_char(created_at, 'MMDDYY') = $3
    `,
    [factory_id, dpn, dateStr]
  );

  const suffix = String(countRows[0].count + 1).padStart(2, "0");

  // Format: PAL-A1-12345-07312501
  return `PAL-${factoryCode}-${dpn}-${dateStr}${suffix}`;
}

/**
 * Assign a system to a pallet (or create a new pallet)
 * Pallets are segregated by factory_id AND dpn.
 */
async function assignSystemToPallet(system_id, factory_id, dpn, client) {
  if (!factory_id) {
    throw new Error(
      `Cannot assign system ${system_id} to pallet: factory_id is null`
    );
  }

  if (!dpn) {
    throw new Error(
      `Cannot assign system ${system_id} to pallet: dpn is missing`
    );
  }

  // Try to find an open pallet for this factory_id and dpn
  const { rows } = await client.query(
    `
    SELECT p.id, p.pallet_number
    FROM pallet p
    LEFT JOIN pallet_system ps
      ON p.id = ps.pallet_id AND ps.removed_at IS NULL
    WHERE p.status = 'open'
      AND p.factory_id = $1
      AND p.dpn = $2
    GROUP BY p.id, p.pallet_number
    HAVING COUNT(ps.id) < 9
    LIMIT 1;
    `,
    [factory_id, dpn]
  );

  let palletId;
  let palletNumber;

  if (rows.length > 0) {
    // Use existing pallet
    palletId = rows[0].id;
    palletNumber = rows[0].pallet_number;
  } else {
    // Generate a consistent new pallet number
    const newNumber = await generatePalletNumber(factory_id, dpn, client);

    const insertResult = await client.query(
      `
      INSERT INTO pallet (factory_id, pallet_number, dpn)
      VALUES ($1, $2, $3)
      RETURNING id, pallet_number;
      `,
      [factory_id, newNumber, dpn]
    );

    palletId = insertResult.rows[0].id;
    palletNumber = insertResult.rows[0].pallet_number;
  }

  // Add system to pallet (avoid duplicates with ON CONFLICT DO NOTHING)
  await client.query(
    `
    INSERT INTO pallet_system (pallet_id, system_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING;
    `,
    [palletId, system_id]
  );

  return { pallet_id: palletId, pallet_number: palletNumber };
}

// ---- PPID HELPERS ----

function decodeDateCode(code) {
  if (!code || code.length !== 3) return null;
  const [y, m, d] = code.split("");
  const decodeChar = (c) =>
    /[0-9]/.test(c)
      ? parseInt(c, 10)
      : c.charCodeAt(0) - "A".charCodeAt(0) + 10;

  const year = 2020 + parseInt(y, 10);
  const month = decodeChar(m);
  const day = decodeChar(d);

  // Return a JavaScript Date object
  return new Date(year, month - 1, day);
}

// Example:
console.log(decodeDateCode("54I"));
// { year: 2025, month: 4, day: 18 }

// Map factory codes in PPID to your DB factory codes
const FACTORY_MAP = {
  WSJ00: "MX", // Juarez
  WS900: "A1", // Hsinchu
  WSM00: "N2", // Hukou
};

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
    filters,
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
            dpn: "s.dpn",
            manufactured_date: "s.manufactured_date",
            serial: "s.serial",
            rev: "s.rev",
            factory: "f.code",
          })}`
        : "";
  }

  // Sorting
  const allowedSortColumns = {
    service_tag: "s.service_tag",
    issue: "s.issue",
    location: "l.name",
    dpn: "s.dpn",
    manufactured_date: "s.manufactured_date",
    serial: "s.serial",
    rev: "s.rev",
    factory: "f.code",
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
          s.id,
          s.service_tag,
          s.issue,
          s.dpn,
          s.manufactured_date,
          s.serial,
          s.rev,
          l.name AS location,
          f.code AS factory_code,
          f.name AS factory_name,
          first_history.changed_at AS date_created,
          first_user.username AS added_by,
          last_history.changed_at AS date_modified
        FROM system s
        JOIN location l ON s.location_id = l.id
        LEFT JOIN factory f ON s.factory_id = f.id

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
            LEFT JOIN factory f ON s.factory_id = f.id
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
  const { date, locations, includeNote, noCache } = req.query;

  if (!date) {
    return res
      .status(400)
      .json({ error: "Missing required `date` query param" });
  }

  const includeNoteFlag =
    includeNote === "true" || includeNote === "1" || includeNote === true;

  const noCacheFlag = noCache === "true" || noCache === "1" || noCache === true;

  const cacheKey = `${date}:${locations || ""}:${includeNoteFlag}`;

  if (!noCacheFlag) {
    const cached = snapshotCache.get(cacheKey);
    if (cached) {
      snapshotCache.ttl(cacheKey, 300);
      return res.json(cached);
    }
  }

  const params = [date];
  const locationFilterSQL = [];

  if (locations) {
    const locationList = locations.split(",").map((loc) => loc.trim());
    if (locationList.length > 0) {
      const placeholders = locationList.map((_, idx) => `$${idx + 2}`);
      locationFilterSQL.push(`AND l.name IN (${placeholders.join(", ")})`);
      params.push(...locationList);
    }
  }

  const selectNote = includeNoteFlag ? `, h.note` : ``;
  const subqueryNote = includeNoteFlag ? `, h.note` : ``;

  try {
    const snapshotResult = await db.query(
      `
      SELECT 
        s.service_tag,
        s.issue,
        l.name AS location,
        h.changed_at AS as_of
        ${selectNote}
      FROM system s
      JOIN (
        SELECT DISTINCT ON (h.system_id)
          h.system_id,
          h.to_location_id,
          h.changed_at
          ${subqueryNote}
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

    if (!noCacheFlag) {
      snapshotCache.set(cacheKey, snapshotResult.rows);
    }

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
            changed_at: "h.changed_at",
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
// GET /api/v1/systems/:service_tag - get single system with full details
router.get("/:service_tag", async (req, res) => {
  const { service_tag } = req.params;

  try {
    const result = await db.query(
      `
      SELECT 
        s.id,
        s.service_tag,
        s.issue,
        s.dpn,
        s.manufactured_date,
        s.serial,
        s.rev,
        l.name AS location,
        f.code AS factory_code,
        f.name AS factory_name,
        -- first history entry
        first_history.changed_at AS date_created,
        first_user.username AS added_by,
        -- last history entry
        last_history.changed_at AS date_modified
      FROM system s
      JOIN location l ON s.location_id = l.id
      LEFT JOIN factory f ON s.factory_id = f.id

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

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Get system details
    const { rows } = await client.query(
      `SELECT id, location_id, factory_id FROM system WHERE service_tag = $1`,
      [service_tag]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "System not found" });
    }

    const {
      id: system_id,
      location_id: from_location_id,
      factory_id,
    } = rows[0];

    // RMA validation
    if (RMA_LOCATION_IDS.includes(to_location_id) && !factory_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Cannot move to an RMA location because factory_id is missing. Update PPID first.",
      });
    }

    // Update location on system
    await client.query(`UPDATE system SET location_id = $1 WHERE id = $2`, [
      to_location_id,
      system_id,
    ]);

    // Default to original note
    let finalNote = note;

    // Handle RMA-specific logic
    if (RMA_LOCATION_IDS.includes(to_location_id)) {
      // Get dpn
      const { rows: sysRows } = await client.query(
        `SELECT dpn FROM system WHERE id = $1`,
        [system_id]
      );
      const dpn = sysRows[0]?.dpn;

      // Assign to pallet and get pallet info
      const { pallet_number } = await assignSystemToPallet(
        system_id,
        factory_id,
        dpn,
        client
      );

      // Append pallet info to note
      finalNote = `${note} - added to ${pallet_number}`;
    } else if (RMA_LOCATION_IDS.includes(from_location_id)) {
      // Leaving RMA: remove from open pallet
      await client.query(
        `
        UPDATE pallet_system
        SET removed_at = NOW()
        WHERE system_id = $1
          AND removed_at IS NULL
          AND pallet_id IN (SELECT id FROM pallet WHERE status = 'open')
        `,
        [system_id]
      );
    }

    // Log history (after finalNote is set)
    await client.query(
      `INSERT INTO system_location_history
       (system_id, from_location_id, to_location_id, note, moved_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [system_id, from_location_id, to_location_id, finalNote, req.user.userId]
    );

    await client.query("COMMIT");
    res.json({ message: "Location updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to update location" });
  } finally {
    client.release();
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

// PATCH /api/v1/systems/:service_tag/ppid
router.patch("/:service_tag/ppid", authenticateToken, async (req, res) => {
  const { service_tag } = req.params;
  const { ppid } = req.body;

  if (!ppid || ppid.length < 21) {
    return res.status(400).json({ error: "Invalid PPID format" });
  }

  try {
    // Parse PPID fields
    const dpn = ppid.substring(3, 8);
    const factoryCodeRaw = ppid.substring(8, 13);
    const dateCode = ppid.substring(13, 16);
    const serial = ppid.substring(16, 20);
    const rev = ppid.substring(20);

    const manufacturedDate = decodeDateCode(dateCode);

    // Find factory_id based on FACTORY_MAP
    let factoryId = null;
    const factoryShortCode = FACTORY_MAP[factoryCodeRaw];
    if (factoryShortCode) {
      const { rows } = await db.query(
        "SELECT id FROM factory WHERE code = $1",
        [factoryShortCode]
      );
      if (rows.length) {
        factoryId = rows[0].id;
      }
    }

    // Build update SET clause
    const fields = [
      { column: "dpn", value: dpn },
      { column: "manufactured_date", value: manufacturedDate },
      { column: "serial", value: serial },
      { column: "rev", value: rev },
    ];

    if (factoryId) {
      fields.push({ column: "factory_id", value: factoryId });
    }

    const setClauses = fields
      .map((f, i) => `${f.column} = $${i + 2}`)
      .join(", ");
    const values = fields.map((f) => f.value);

    await db.query(`UPDATE system SET ${setClauses} WHERE service_tag = $1`, [
      service_tag,
      ...values,
    ]);

    res.json({ message: "System PPID fields updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update PPID data" });
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
