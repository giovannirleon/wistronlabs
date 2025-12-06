const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

/**
 * GET /api/v1/parts/list
 * Filters (all optional):
 * - place=inventory|unit
 * - is_functional=true|false
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
  } = req.query;

  const where = [];
  const params = [];

  if (place) {
    params.push(place);
    where.push(`pl.place = $${params.length}`);
  }

  if (typeof is_functional !== "undefined") {
    // Accept "true"/"false"/"1"/"0"
    const val =
      is_functional === "true" ||
      is_functional === "1" ||
      is_functional === true;
    params.push(val);
    where.push(`pl.is_functional = $${params.length}`);
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
    // single placeholder reused in the ORs on purpose
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
        pl.last_unit_id,
        s_last.service_tag AS last_unit_service_tag,
        pl.is_functional,
        pl.created_at,
        pl.updated_at
      FROM part_list pl
      JOIN parts p ON p.id = pl.part_id
      LEFT JOIN part_categories pc ON pc.id = p.part_category_id
      LEFT JOIN system s ON s.id = pl.unit_id
      LEFT JOIN system s_last ON s_last.id = pl.last_unit_id
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
        pl.last_unit_id,
        s_last.service_tag AS last_unit_service_tag,
        pl.is_functional,
        pl.created_at,
        pl.updated_at
      FROM part_list pl
      JOIN parts  p  ON p.id = pl.part_id
      LEFT JOIN system s ON s.id = pl.unit_id
      LEFT JOIN system s_last ON s_last.id = pl.last_unit_id
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
 * Body: { part_id, place?='inventory', unit_id?, unit_service_tag?, is_functional?=true }
 * - last_unit_id is ALWAYS NULL on creation.
 */
router.post("/:ppid", authenticateToken, async (req, res) => {
  const ppid = String(req.params.ppid || "").toUpperCase();
  const {
    part_id,
    place = "inventory",
    unit_id,
    unit_service_tag,
    is_functional = true,
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
      INSERT INTO part_list (ppid, part_id, place, unit_id, last_unit_id, is_functional)
      VALUES ($1,   $2,      $3,    $4,      NULL,         $5)
      RETURNING *
      `,
      [ppid, part_id, place, resolvedUnitId, !!is_functional]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (e.code === "23505")
      return res.status(409).json({ error: "PPID already exists" }); // unique_violation
    if (e.code === "23503")
      return res.status(400).json({ error: "Invalid part_id or unit_id" }); // FK
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
 *   is_functional?,
 *   ppid?                 // rename PPID
 * }
 * - last_unit_id is computed automatically:
 *   * place: 'unit' -> 'inventory' => last_unit_id = old.unit_id
 *   * unit moves from A -> B       => last_unit_id = A
 */
router.patch("/:ppid", authenticateToken, async (req, res) => {
  const current = String(req.params.ppid || "").toUpperCase();
  const { part_id, place, unit_id, unit_service_tag, is_functional, ppid } =
    req.body || {};

  if (
    part_id === undefined &&
    place === undefined &&
    unit_id === undefined &&
    unit_service_tag === undefined &&
    is_functional === undefined &&
    ppid === undefined
  ) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    // 1) Load existing row so we can compare
    const existingResult = await db.query(
      `
      SELECT place, unit_id, last_unit_id
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

    // 3) Compute new last_unit_id
    let newLastUnitId = existing.last_unit_id;

    // Case 1: part moved out of a unit back to inventory
    if (
      existing.place === "unit" &&
      newPlace === "inventory" &&
      existing.unit_id !== null
    ) {
      newLastUnitId = existing.unit_id;
    }
    // Case 2: part moved from one unit to another
    else if (
      existing.unit_id !== null &&
      newUnitId !== null &&
      newUnitId !== existing.unit_id
    ) {
      newLastUnitId = existing.unit_id;
    }

    // 4) Build dynamic UPDATE
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

    // Always set last_unit_id based on our computed logic
    fields.push(`last_unit_id = $${fields.length + 1}`);
    vals.push(newLastUnitId);

    if (is_functional !== undefined) {
      fields.push(`is_functional = $${fields.length + 1}`);
      vals.push(!!is_functional);
    }
    if (ppid !== undefined) {
      fields.push(`ppid = $${fields.length + 1}`);
      vals.push(ppid ? ppid.toUpperCase() : null);
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
      return res.status(400).json({ error: "Invalid part_id or unit_id" });
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
