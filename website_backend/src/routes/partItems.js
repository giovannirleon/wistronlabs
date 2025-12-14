const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

/**
 * GET /api/v1/parts/list
 * Filters (all optional):
 * - place=inventory|unit
 * - is_functional=true|false
 * - replacement_defective=true|false
 * - part_id=#
 * - part_name=<text>                (ILIKE)
 * - part_category_id=#
 * - part_category_name=<text>       (ILIKE)
 * - unit_id=#
 * - unit_service_tag=<text>         (ILIKE)
 * - q=<text>                        (ILIKE across ppid, part name, part dpn, unit tag, category)
 */
router.get("/", async (req, res) => {
  const {
    place,
    is_functional,
    part_id,
    part_name,
    part_category_id,
    part_category_name,
    unit_id,
    unit_service_tag,
    q,
    replacement_defective,
  } = req.query;

  const where = [];
  const params = [];

  const parseBool = (v) => v === "true" || v === "1" || v === true || v === 1;

  if (place) {
    params.push(place);
    where.push(`pl.place = $${params.length}`);
  }

  if (typeof is_functional !== "undefined") {
    params.push(parseBool(is_functional));
    where.push(`pl.is_functional = $${params.length}`);
  }

  if (typeof replacement_defective !== "undefined") {
    params.push(parseBool(replacement_defective));
    where.push(`pl.replacement_defective = $${params.length}`);
  }

  if (part_id) {
    params.push(part_id);
    where.push(`pl.part_id = $${params.length}`);
  }

  if (part_name && part_name.trim()) {
    params.push(`%${part_name.trim()}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }

  if (part_category_id) {
    params.push(part_category_id);
    where.push(`pc.id = $${params.length}`);
  }

  if (part_category_name && part_category_name.trim()) {
    params.push(`%${part_category_name.trim()}%`);
    where.push(`pc.name ILIKE $${params.length}`);
  }

  if (unit_id) {
    params.push(unit_id);
    where.push(`pl.unit_id = $${params.length}`);
  }

  if (unit_service_tag && unit_service_tag.trim()) {
    params.push(`%${unit_service_tag.trim()}%`);
    where.push(`s.service_tag ILIKE $${params.length}`);
  }

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    const idx = params.length;
    where.push(
      `(pl.ppid ILIKE $${idx}
        OR p.name ILIKE $${idx}
        OR p.dpn ILIKE $${idx}
        OR s.service_tag ILIKE $${idx}
        OR pc.name ILIKE $${idx})`
    );
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await db.query(
      `
      SELECT
        pl.ppid,
        pl.id,
        pl.part_id,
        p.name AS part_name,
        p.dpn AS part_dpn,
        pc.name AS part_category_name,
        pl.place,
        pl.unit_id,
        s.service_tag AS unit_service_tag,

        -- system location
        s.location_id AS system_location_id,
        loc.name AS system_location,

        pl.last_unit_id,
        s_last.service_tag AS last_unit_service_tag,

        s_last.location_id AS last_unit_location_id,
        loc_last.name AS last_unit_location,

        -- ✅ NEW: pallet context for unit_id (only when still assigned; removed_at IS NULL)
        pal.pallet_number AS unit_pallet_number,

        -- prefer pallet.status if you have it; otherwise fall back to released_at-derived state
        COALESCE(
          pal.status,
          CASE
            WHEN pal.pallet_number IS NULL THEN NULL
            WHEN pal.released_at IS NULL THEN 'open'
            ELSE 'released'
          END
        ) AS unit_pallet_status,

        -- open pallet + still assigned
        CASE
          WHEN ps_active.pallet_number IS NULL THEN false
          WHEN pal.pallet_number IS NULL THEN false
          WHEN pal.released_at IS NOT NULL THEN false
          ELSE true
        END AS unit_on_active_pallet,

        -- ✅ NEW: activity state
        CASE
          WHEN pl.unit_id IS NULL THEN NULL
          WHEN loc.name ILIKE 'RMA%' THEN
            CASE
              WHEN pal.id IS NOT NULL AND pal.status = 'open' THEN 'inactive_on_active_pallet'
              ELSE 'inactive'
            END
          WHEN loc.name = 'Sent to L11' THEN 'inactive'
          ELSE 'active'
        END AS unit_activity_state,

        pl.is_functional,
        pl.replacement_defective,
        pl.created_at,
        pl.updated_at
      FROM part_list pl
      JOIN parts p ON p.id = pl.part_id
      LEFT JOIN part_categories pc ON pc.id = p.part_category_id

      LEFT JOIN system s ON s.id = pl.unit_id
      LEFT JOIN location loc ON loc.id = s.location_id

      LEFT JOIN LATERAL (
        SELECT ps.pallet_id
        FROM pallet_system ps
        WHERE ps.system_id = s.id
          AND ps.removed_at IS NULL
        ORDER BY ps.added_at DESC NULLS LAST, ps.id DESC
        LIMIT 1
      ) ps_active ON TRUE

      LEFT JOIN pallet pal ON pal.id = ps_active.pallet_id


      LEFT JOIN system s_last ON s_last.id = pl.last_unit_id
      LEFT JOIN location loc_last ON loc_last.id = s_last.location_id

      ${whereSQL}
      ORDER BY pl.created_at DESC
      `,
      params
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list part items" });
  }
});

/**
 * GET /api/v1/parts/list/:ppid
 * Fetch a single part item by PPID (PPID is unique).
 */
router.get("/:ppid", async (req, res) => {
  const ppid = String(req.params.ppid || "").toUpperCase();

  try {
    const { rows } = await db.query(
      `
      SELECT
        pl.ppid,
        pl.id,
        pl.part_id,
        p.name AS part_name,
        p.dpn AS part_dpn,
        pl.place,
        pl.unit_id,
        s.service_tag AS unit_service_tag,

        s.location_id AS system_location_id,
        loc.name AS system_location,

        pl.last_unit_id,
        s_last.service_tag AS last_unit_service_tag,

        s_last.location_id AS last_unit_location_id,
        loc_last.name AS last_unit_location,

        -- ✅ NEW: pallet context for unit_id
        pal.pallet_number AS unit_pallet_number,
        COALESCE(
          pal.status,
          CASE
            WHEN pal.pallet_number IS NULL THEN NULL
            WHEN pal.released_at IS NULL THEN 'open'
            ELSE 'released'
          END
        ) AS unit_pallet_status,

        CASE
          WHEN ps_active.pallet_number IS NULL THEN false
          WHEN pal.pallet_number IS NULL THEN false
          WHEN pal.released_at IS NOT NULL THEN false
          ELSE true
        END AS unit_on_active_pallet,

        -- ✅ NEW: activity state
        CASE
          WHEN pl.unit_id IS NULL THEN NULL
          WHEN loc.name ILIKE 'RMA%' THEN
            CASE
              WHEN pal.id IS NOT NULL AND pal.status = 'open' THEN 'inactive_on_active_pallet'
              ELSE 'inactive'
            END
          WHEN loc.name = 'Sent to L11' THEN 'inactive'
          ELSE 'active'
        END AS unit_activity_state,


        pl.is_functional,
        pl.replacement_defective,
        pl.created_at,
        pl.updated_at
      FROM part_list pl
      JOIN parts p ON p.id = pl.part_id

      LEFT JOIN system s ON s.id = pl.unit_id
      LEFT JOIN location loc ON loc.id = s.location_id

     LEFT JOIN LATERAL (
        SELECT ps.pallet_id
        FROM pallet_system ps
        WHERE ps.system_id = s.id
          AND ps.removed_at IS NULL
        ORDER BY ps.added_at DESC NULLS LAST, ps.id DESC
        LIMIT 1
      ) ps_active ON TRUE

      LEFT JOIN pallet pal ON pal.id = ps_active.pallet_id


      LEFT JOIN system s_last ON s_last.id = pl.last_unit_id
      LEFT JOIN location loc_last ON loc_last.id = s_last.location_id

      WHERE pl.ppid = $1
      `,
      [ppid]
    );

    if (!rows.length)
      return res.status(404).json({ error: "Part item not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch part item" });
  }
});

/**
 * POST /api/v1/parts/list/:ppid
 * Body: { part_id, place?='inventory', unit_id?, unit_service_tag?, last_unit_id?, is_functional?=true }
 * - last_unit_id is taken from the body (can be NULL or a valid system.id).
 */
router.post("/:ppid", authenticateToken, async (req, res) => {
  const ppid = String(req.params.ppid || "").toUpperCase();
  const {
    part_id,
    place = "inventory",
    unit_id,
    unit_service_tag,
    last_unit_id,
    is_functional = true,
    replacement_defective = false,
  } = req.body || {};

  if (!ppid) return res.status(400).json({ error: "PPID is required in path" });
  if (!part_id) return res.status(400).json({ error: "part_id is required" });

  try {
    let resolvedUnitId = null;

    if (place === "unit") {
      if (unit_id != null) {
        // still support raw unit_id if provided
        resolvedUnitId = unit_id;
      } else if (unit_service_tag) {
        const normalizedTag = String(unit_service_tag).trim().toUpperCase();
        const sys = await db.query(
          `SELECT id FROM system WHERE service_tag = $1`,
          [normalizedTag]
        );
        if (!sys.rows.length) {
          return res
            .status(400)
            .json({ error: "Unit with given service_tag not found" });
        }
        resolvedUnitId = sys.rows[0].id;
      } else {
        return res.status(400).json({
          error: "unit_id or unit_service_tag required when place='unit'",
        });
      }
    }

    const { rows } = await db.query(
      `
      INSERT INTO part_list (ppid, part_id, place, unit_id, last_unit_id, is_functional, replacement_defective)
      VALUES ($1,   $2,      $3,    $4,      $5,           $6,            $7)
      RETURNING *
      `,
      [
        ppid,
        part_id,
        place,
        resolvedUnitId,
        last_unit_id ?? null,
        !!is_functional,
        !!replacement_defective,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (e.code === "23505")
      return res.status(409).json({ error: "PPID already exists" }); // unique_violation
    if (e.code === "23503")
      return res.status(400).json({
        error: "Invalid part_id, unit_id or last_unit_id",
      }); // FK
    if (e.code === "23514")
      return res.status(400).json({ error: "Invalid place/unit pairing" }); // CHECK
    res.status(500).json({ error: "Failed to create part item" });
  }
});

/**
 * PATCH /api/v1/parts/list/:ppid
 * Body: {
 *   part_id?,
 *   place?,
 *   unit_service_tag?,    // preferred
 *   unit_id?,             // optional legacy support
 *   last_unit_id?,        // explicit control, no auto logic
 *   is_functional?,
 *   ppid?                 // rename PPID
 * }
 */
router.patch("/:ppid", authenticateToken, async (req, res) => {
  const current = String(req.params.ppid || "").toUpperCase();
  const {
    part_id,
    place,
    unit_id,
    unit_service_tag,
    last_unit_id,
    is_functional,
    replacement_defective,
    ppid,
  } = req.body || {};

  if (
    part_id === undefined &&
    place === undefined &&
    unit_id === undefined &&
    unit_service_tag === undefined &&
    last_unit_id === undefined &&
    is_functional === undefined &&
    ppid === undefined &&
    replacement_defective === undefined
  ) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    // 1) Load existing row so we can compare (for place/unit_id constraint logic)
    const existingResult = await db.query(
      `
      SELECT place, unit_id
      FROM part_list
      WHERE ppid = $1
      `,
      [current]
    );

    if (!existingResult.rows.length) {
      return res.status(404).json({ error: "Part item not found" });
    }

    const existing = existingResult.rows[0];

    // 2) Compute new place & unit_id
    const newPlace = place !== undefined ? place : existing.place;

    let newUnitId = existing.unit_id;
    let unitExplicitlyChanged = false;

    if (unit_service_tag !== undefined) {
      unitExplicitlyChanged = true;

      if (unit_service_tag === null || unit_service_tag === "") {
        newUnitId = null;
      } else {
        const normalizedTag = String(unit_service_tag).trim().toUpperCase();
        const sys = await db.query(
          `SELECT id FROM system WHERE service_tag = $1`,
          [normalizedTag]
        );
        if (!sys.rows.length) {
          return res
            .status(400)
            .json({ error: "Unit with given service_tag not found" });
        }
        newUnitId = sys.rows[0].id;
      }
    } else if (unit_id !== undefined) {
      // legacy: still accept raw unit_id if given
      unitExplicitlyChanged = true;
      newUnitId = unit_id;
    }

    // If place changed to inventory and unit wasn't explicitly changed,
    // we must drop unit_id to satisfy the CHECK constraint and semantics.
    if (
      place !== undefined &&
      newPlace === "inventory" &&
      !unitExplicitlyChanged
    ) {
      newUnitId = null;
      unitExplicitlyChanged = true;
    }

    // 3) Build dynamic UPDATE
    const fields = [];
    const vals = [];

    if (part_id !== undefined) {
      fields.push(`part_id = $${fields.length + 1}`);
      vals.push(part_id);
    }
    if (place !== undefined) {
      fields.push(`place = $${fields.length + 1}`);
      vals.push(newPlace);
    }
    if (unitExplicitlyChanged) {
      fields.push(`unit_id = $${fields.length + 1}`);
      vals.push(newUnitId);
    }
    if (last_unit_id !== undefined) {
      fields.push(`last_unit_id = $${fields.length + 1}`);
      vals.push(last_unit_id);
    }
    if (is_functional !== undefined) {
      fields.push(`is_functional = $${fields.length + 1}`);
      vals.push(!!is_functional);
    }
    if (ppid !== undefined) {
      fields.push(`ppid = $${fields.length + 1}`);
      vals.push(ppid ? ppid.toUpperCase() : null);
    }

    // 🔹 MOVE THIS UP BEFORE the !fields.length check
    if (replacement_defective !== undefined) {
      fields.push(`replacement_defective = $${fields.length + 1}`);
      vals.push(!!replacement_defective);
    }

    // Now this correctly considers replacement_defective too
    if (!fields.length) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    vals.push(current);

    const { rows } = await db.query(
      `UPDATE part_list
   SET ${fields.join(", ")}
   WHERE ppid = $${vals.length}
   RETURNING *`,
      vals
    );

    if (!rows.length)
      return res.status(404).json({ error: "Part item not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    if (e.code === "23505")
      return res.status(409).json({ error: "PPID already exists" });
    if (e.code === "23503")
      return res
        .status(400)
        .json({ error: "Invalid part_id, unit_id or last_unit_id" });
    if (e.code === "23514")
      return res.status(400).json({ error: "Invalid place/unit pairing" });
    res.status(500).json({ error: "Failed to update part item" });
  }
});

/**
 * DELETE /api/v1/parts/list/:ppid
 * Only delete when the item is currently in inventory.
 */
router.delete("/:ppid", authenticateToken, async (req, res) => {
  const ppid = String(req.params.ppid || "").toUpperCase();
  try {
    const { rows } = await db.query(
      `DELETE FROM part_list WHERE ppid = $1 AND place = 'inventory' RETURNING ppid`,
      [ppid]
    );
    if (!rows.length) {
      return res.status(409).json({
        error:
          "Can only delete items that are in inventory (or PPID not found)",
      });
    }
    res.json({ message: "Part item deleted" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete part item" });
  }
});

module.exports = router;
