const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");
const { buildWhereClause } = require("../utils/buildWhereClause");
const { generatePalletNumber } = require("../utils/generatePalletNumber");

const router = express.Router();

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

  if (filters) {
    const parsed = typeof filters === "string" ? JSON.parse(filters) : filters;

    whereSQL =
      parsed && parsed.conditions?.length
        ? `WHERE ${buildWhereClause(parsed, params, {
            pallet_number: "p.pallet_number",
            factory_id: "p.factory_id",
            factory_code: "f.code",
            dpn: "d.name",
            status: "p.status",
            doa_number: "p.doa_number",
            released_at: "p.released_at",
            created_at: "p.created_at",
            locked: "p.locked",
            locked_at: "p.locked_at",
            locked_by: "p.locked_by",
          })}`
        : "";
  }

  const allowedSortColumns = {
    pallet_number: "p.pallet_number",
    factory_id: "p.factory_id",
    factory_code: "f.code",
    dpn: "d.name",
    status: "p.status",
    doa_number: "p.doa_number",
    released_at: "p.released_at",
    created_at: "p.created_at",
    locked: "p.locked",
    locked_at: "p.locked_at",
    locked_by: "p.locked_by",
  };

  const orderColumn = allowedSortColumns[sort_by] || "p.created_at";
  const orderDirection = sort_order === "asc" ? "ASC" : "DESC";

  let limitOffsetSQL = "";
  let pageNum, pageSize, offset;

  if (!all || all === "false") {
    pageNum = Math.max(parseInt(page, 10), 1);
    pageSize = Math.min(parseInt(page_size, 10), 100);
    offset = (pageNum - 1) * pageSize;
    limitOffsetSQL = `LIMIT ${pageSize} OFFSET ${offset}`;
  }

  try {
    const [dataResult, countResult] = await Promise.all([
      db.query(
        `
        SELECT
           p.id, p.pallet_number, p.factory_id, p.dpn_id, p.status,
          p.doa_number, p.released_at, p.created_at,
          p.locked, p.locked_at, p.locked_by,
          d.name AS dpn,
          f.code AS factory_code,

          -- Open-pallet live members
          COALESCE(
            json_agg(
              json_build_object(
                'system_id', ps.system_id,
                'service_tag', s.service_tag,
                'added_at', ps.added_at,
                'removed_at', ps.removed_at
              )
              ORDER BY ps.added_at
            ) FILTER (WHERE p.status = 'open' AND ps.removed_at IS NULL),
            '[]'::json
          ) AS active_systems,

          -- Released-pallet snapshot at release time (INCLUSIVE; robust to NULL removed_at)
          COALESCE(
            json_agg(
              json_build_object(
                'system_id', ps.system_id,
                'service_tag', s.service_tag,
                'added_at', ps.added_at,
                'removed_at', ps.removed_at
              )
              ORDER BY ps.added_at
            ) FILTER (
              WHERE p.status = 'released'
                AND ps.added_at <= p.released_at
                AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
            ),
            '[]'::json
          ) AS released_systems,

          -- Canonical field: open = live, released = snapshot
          COALESCE(
            CASE
              WHEN p.status = 'open' THEN
                json_agg(
                  json_build_object(
                    'system_id', ps.system_id,
                    'service_tag', s.service_tag,
                    'added_at', ps.added_at,
                    'removed_at', ps.removed_at
                  )
                  ORDER BY ps.added_at
                ) FILTER (WHERE ps.removed_at IS NULL)
              ELSE
                json_agg(
                  json_build_object(
                    'system_id', ps.system_id,
                    'service_tag', s.service_tag,
                    'added_at', ps.added_at,
                    'removed_at', ps.removed_at
                  )
                  ORDER BY ps.added_at
                ) FILTER (
                  WHERE ps.added_at <= p.released_at
                    AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
                )
            END,
            '[]'::json
          ) AS systems,

          -- Count matching the above (cast to int so frontend doesn’t get a string)
          CASE
            WHEN p.status = 'open' THEN
              COUNT(*) FILTER (WHERE ps.removed_at IS NULL)::int
            ELSE
              COUNT(*) FILTER (
                WHERE ps.added_at <= p.released_at
                  AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
              )::int
          END AS systems_count

        FROM pallet p
        LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
        LEFT JOIN system s        ON s.id = ps.system_id
        LEFT JOIN dpn d           ON d.id = p.dpn_id
        LEFT JOIN factory f       ON f.id = p.factory_id
        ${whereSQL}
        GROUP BY p.id, p.doa_number, p.released_at, p.created_at, p.locked, p.locked_at, p.locked_by, d.name, f.code
        ORDER BY ${orderColumn} ${orderDirection}
        ${limitOffsetSQL}
        `,
        params
      ),
      !all || all === "false"
        ? db.query(
            `
            SELECT COUNT(*) AS count
            FROM pallet p
            LEFT JOIN dpn d ON d.id = p.dpn_id
            LEFT JOIN factory f ON f.id = p.factory_id
            ${whereSQL}
            `,
            params
          )
        : Promise.resolve({ rows: [] }),
    ]);

    if (all && all !== "false") {
      return res.json(dataResult.rows);
    }

    const total_count = parseInt(countResult.rows[0].count, 10);

    res.json({
      data: dataResult.rows,
      total_count,
      page: pageNum,
      page_size: pageSize,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pallets" });
  }
});

// POST /api/v1/pallets
// Body: { dpn: "DKCFX", factory_code: "MX" }
router.post("/", authenticateToken, async (req, res) => {
  const { dpn, factory_code } = req.body || {};

  if (!dpn || !factory_code) {
    return res.status(400).json({
      error: "dpn and factory_code are required",
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Resolve DPN -> id
    const { rows: dpnRows } = await client.query(
      `SELECT id FROM dpn WHERE name = $1`,
      [dpn]
    );
    if (!dpnRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: `DPN not found: ${dpn}` });
    }
    const dpn_id_final = dpnRows[0].id;

    // Resolve Factory -> id
    const { rows: fRows } = await client.query(
      `SELECT id FROM factory WHERE code = $1`,
      [factory_code]
    );
    if (!fRows.length) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: `Factory code not found: ${factory_code}` });
    }
    const factory_id_final = fRows[0].id;

    // Generate pallet number (helper uses ids)
    const pallet_number = await generatePalletNumber(
      factory_id_final,
      dpn_id_final,
      client
    );

    // Enforce uniqueness
    const { rowCount: exists } = await client.query(
      `SELECT 1 FROM pallet WHERE pallet_number = $1`,
      [pallet_number]
    );
    if (exists) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `pallet_number already exists: ${pallet_number}`,
      });
    }

    // Insert pallet (status=open)
    const { rows: ins } = await client.query(
      `
      INSERT INTO pallet (
        pallet_number, factory_id, dpn_id, status,
        created_at, locked, locked_at, locked_by
      )
      VALUES ($1, $2, $3, 'open', NOW(), FALSE, NULL, NULL)
      RETURNING id, pallet_number, factory_id, dpn_id, status,
                doa_number, released_at, created_at, locked, locked_at, locked_by
      `,
      [pallet_number, factory_id_final, dpn_id_final]
    );

    await client.query("COMMIT");

    // Join DPN name for convenience
    const { rows: out } = await db.query(
      `SELECT p.*, d.name AS dpn
         FROM pallet p
         LEFT JOIN dpn d ON d.id = p.dpn_id
        WHERE p.id = $1`,
      [ins[0].id]
    );

    return res.status(201).json({
      message: "Pallet created",
      pallet_number: pallet_number, // <- explicit return
      pallet: out[0],
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ error: "Failed to create pallet" });
  } finally {
    client.release();
  }
});

router.get("/:pallet_number", async (req, res) => {
  const { pallet_number } = req.params;
  try {
    const result = await db.query(
      `
        SELECT
        p.id, p.pallet_number, p.factory_id, p.dpn_id, p.status,
        p.doa_number, p.released_at, p.created_at,
        p.locked, p.locked_at, p.locked_by,
        d.name AS dpn,
        f.code AS factory_code,                 

        -- Open-pallet live members
        COALESCE(
          json_agg(
            json_build_object(
              'system_id', ps.system_id,
              'service_tag', s.service_tag,
              'added_at', ps.added_at,
              'removed_at', ps.removed_at
            )
            ORDER BY ps.added_at
          ) FILTER (WHERE p.status = 'open' AND ps.removed_at IS NULL),
          '[]'::json
        ) AS active_systems,

        -- Released-pallet snapshot at release time (INCLUSIVE; robust to NULL removed_at)
        COALESCE(
          json_agg(
            json_build_object(
              'system_id', ps.system_id,
              'service_tag', s.service_tag,
              'added_at', ps.added_at,
              'removed_at', ps.removed_at
            )
            ORDER BY ps.added_at
          ) FILTER (
            WHERE p.status = 'released'
              AND ps.added_at <= p.released_at
              AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
          ),
          '[]'::json
        ) AS released_systems,

        -- Canonical field: open = live, released = snapshot
        COALESCE(
          CASE
            WHEN p.status = 'open' THEN
              json_agg(
                json_build_object(
                  'system_id', ps.system_id,
                  'service_tag', s.service_tag,
                  'added_at', ps.added_at,
                  'removed_at', ps.removed_at
                )
                ORDER BY ps.added_at
              ) FILTER (WHERE ps.removed_at IS NULL)
            ELSE
              json_agg(
                json_build_object(
                  'system_id', ps.system_id,
                  'service_tag', s.service_tag,
                  'added_at', ps.added_at,
                  'removed_at', ps.removed_at
                )
                ORDER BY ps.added_at
              ) FILTER (
                WHERE ps.added_at <= p.released_at
                  AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
              )
          END,
          '[]'::json
        ) AS systems,

        -- Count matching the above (cast to int so frontend doesn’t get a string)
        CASE
          WHEN p.status = 'open' THEN
            COUNT(*) FILTER (WHERE ps.removed_at IS NULL)::int
          ELSE
            COUNT(*) FILTER (
              WHERE ps.added_at <= p.released_at
                AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
            )::int
        END AS systems_count

      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      LEFT JOIN system s        ON s.id = ps.system_id
      LEFT JOIN dpn d           ON d.id = p.dpn_id
      LEFT JOIN factory f       ON f.id = p.factory_id
      WHERE p.pallet_number = $1
      GROUP BY p.id, p.doa_number, p.released_at, p.created_at, p.locked, p.locked_at, p.locked_by, d.name, f.code
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

// PATCH /api/v1/pallets/:pallet_number/lock  { locked: boolean }
router.patch("/:pallet_number/lock", authenticateToken, async (req, res) => {
  const { pallet_number } = req.params;
  const { locked } = req.body;

  if (typeof locked !== "boolean") {
    return res.status(400).json({ error: "locked must be boolean" });
  }

  try {
    const { rows } = await db.query(
      `SELECT id, status, locked FROM pallet WHERE pallet_number = $1`,
      [pallet_number]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Pallet not found" });
    }

    const { id, status, locked: currentLocked } = rows[0];

    // Only open pallets can be (un)locked.
    if (status !== "open") {
      return res
        .status(400)
        .json({ error: "Only open pallets can be locked/unlocked" });
    }

    // Optional: short-circuit if no change requested
    if (currentLocked === locked) {
      return res.json({
        message: locked ? "Pallet already locked" : "Pallet already unlocked",
        pallet: rows[0],
      });
    }

    const rawUserId = req.user?.userId;
    const parsed = Number.parseInt(rawUserId, 10);
    const userId = Number.isFinite(parsed) ? parsed : 1; // ensure integer fallback

    const upd = await db.query(
      `UPDATE pallet
         SET locked = $1,
             locked_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
             locked_by = CASE WHEN $1 THEN $2::integer ELSE NULL::integer END
       WHERE id = $3
       RETURNING id, pallet_number, locked, locked_at, locked_by`,
      [locked, userId, id]
    );

    res.json({
      message: locked ? "Pallet locked" : "Pallet unlocked",
      pallet: upd.rows[0],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update lock state" });
  }
});

router.patch("/move", authenticateToken, async (req, res) => {
  const { service_tag, from_pallet_number, to_pallet_number } = req.body;

  if (!service_tag || !from_pallet_number || !to_pallet_number) {
    return res.status(400).json({
      error:
        "service_tag, from_pallet_number, and to_pallet_number are required",
    });
  }

  if (from_pallet_number === to_pallet_number) {
    return res.status(400).json({
      error: "Source and destination pallet numbers must be different",
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Look up system ID by service tag
    const { rows: systemRows } = await client.query(
      `SELECT id, location_id FROM system WHERE service_tag = $1`,
      [service_tag]
    );

    if (systemRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "System not found" });
    }

    const system_id = systemRows[0].id;

    // 2. Look up pallet IDs by pallet_number
    const { rows: pallets } = await client.query(
      `
      SELECT id, pallet_number, status, factory_id, dpn_id, locked
      FROM pallet
      WHERE pallet_number = ANY($1)
      `,
      [[from_pallet_number, to_pallet_number]]
    );

    if (pallets.length !== 2) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or both pallets not found" });
    }

    const fromPallet = pallets.find(
      (p) => p.pallet_number === from_pallet_number
    );
    const toPallet = pallets.find((p) => p.pallet_number === to_pallet_number);

    if (!fromPallet || !toPallet) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Could not resolve pallet(s)" });
    }

    // 3. Ensure both pallets are open
    if (fromPallet.status !== "open" || toPallet.status !== "open") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Cannot move from/to a released pallet" });
    }

    // 3b. Block moves involving locked pallets
    if (fromPallet.locked || toPallet.locked) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Cannot move systems when either pallet is locked" });
    }

    // 4. Same factory_id and dpn
    if (
      fromPallet.factory_id !== toPallet.factory_id ||
      fromPallet.dpn_id !== toPallet.dpn_id
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Pallets must have the same factory_id and DPN" });
    }

    // 5. Confirm system is in source pallet
    const { rowCount: inPallet } = await client.query(
      `
      SELECT 1 FROM pallet_system
      WHERE pallet_id = $1 AND system_id = $2 AND removed_at IS NULL
      `,
      [fromPallet.id, system_id]
    );

    if (inPallet === 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "System is not in the source pallet" });
    }

    // 6. Confirm system's location is RMA
    const { rows: locationRows } = await client.query(
      `
      SELECT l.name AS location_name
      FROM system s
      JOIN location l ON s.location_id = l.id
      WHERE s.id = $1
      `,
      [system_id]
    );

    if (locationRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "System location not found" });
    }

    const locationName = locationRows[0].location_name;
    if (!locationName.startsWith("RMA")) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "System is not in an RMA location" });
    }

    // 7. Mark system as removed from source pallet
    await client.query(
      `
      UPDATE pallet_system
      SET removed_at = NOW()
      WHERE pallet_id = $1 AND system_id = $2 AND removed_at IS NULL
      `,
      [fromPallet.id, system_id]
    );

    // 8. Add system to destination pallet
    await client.query(
      `INSERT INTO pallet_system (pallet_id, system_id) VALUES ($1, $2)`,
      [toPallet.id, system_id]
    );

    await client.query("COMMIT");
    res.json({ message: "System moved to new pallet" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to move system between pallets" });
  } finally {
    client.release();
  }
});

router.patch("/:pallet_number/release", authenticateToken, async (req, res) => {
  const { pallet_number } = req.params;
  const { doa_number } = req.body;

  if (!doa_number || doa_number.trim().length < 5) {
    return res.status(400).json({ error: "Valid doa_number is required" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Lock the pallet row
    const { rows: pRows } = await client.query(
      `
      SELECT id, status
      FROM pallet
      WHERE pallet_number = $1
      FOR UPDATE
      `,
      [pallet_number]
    );
    if (!pRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pallet not found" });
    }
    const { id: pallet_id, status } = pRows[0];
    if (status !== "open") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Pallet is already released" });
    }

    // Count active and validate PPID
    const { rows: activeCountRows } = await client.query(
      `
      SELECT COUNT(*)::int AS active_count
      FROM pallet_system ps
      WHERE ps.pallet_id = $1 AND ps.removed_at IS NULL
      `,
      [pallet_id]
    );
    if (activeCountRows[0].active_count === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cannot release an empty pallet" });
    }

    const { rows: missingPPID } = await client.query(
      `
      SELECT s.service_tag
      FROM pallet_system ps
      JOIN system s ON s.id = ps.system_id
      WHERE ps.pallet_id = $1
        AND ps.removed_at IS NULL
        AND (s.ppid IS NULL OR TRIM(s.ppid) = '')
      `,
      [pallet_id]
    );
    if (missingPPID.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Cannot release pallet: missing PPID for ${missingPPID
          .map((r) => r.service_tag)
          .join(", ")}`,
      });
    }

    // ONE stable timestamp for this release
    const {
      rows: [tsRow],
    } = await client.query(`SELECT NOW() AS t`);
    const t = tsRow.t;

    // Close memberships with the SAME timestamp
    await client.query(
      `
      UPDATE pallet_system
      SET removed_at = $2
      WHERE pallet_id = $1 AND removed_at IS NULL
      `,
      [pallet_id, t]
    );

    // Update pallet status using the SAME timestamp
    await client.query(
      `
      UPDATE pallet
      SET status = 'released',
          doa_number = $2,
          released_at = $3,
          locked = FALSE,
          locked_at = NULL,
          locked_by = NULL
      WHERE id = $1
      `,
      [pallet_id, doa_number.trim(), t]
    );

    await client.query("COMMIT");
    res.json({ message: "Pallet released successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to release pallet" });
  } finally {
    client.release();
  }
});

// DELETE /api/v1/pallets/:id
router.delete("/:pallet_number", authenticateToken, async (req, res) => {
  const { pallet_number } = req.params;

  try {
    const { rows } = await db.query(
      `
      SELECT p.id, p.status,
             COUNT(ps.id) FILTER (WHERE ps.removed_at IS NULL) AS active_count
      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      WHERE p.pallet_number = $1
      GROUP BY p.id, p.status
      `,
      [pallet_number]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pallet not found" });
    }

    const { id, status, active_count } = rows[0];

    if (status !== "open") {
      return res.status(400).json({ error: "Cannot delete a released pallet" });
    }

    if (parseInt(active_count, 10) > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a pallet with active systems" });
    }

    await db.query("DELETE FROM pallet WHERE id = $1", [id]);

    res.json({ message: "Pallet deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete pallet" });
  }
});

module.exports = router;
