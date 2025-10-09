const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

/**
 * GET /api/v1/parts/list
 * Optional filters: ?place=inventory|unit&part_id=&unit_id=&q=
 */
router.get("/", async (req, res) => {
  const { place, part_id, unit_id, q } = req.query;
  const where = [];
  const params = [];

  if (place) {
    params.push(place);
    where.push(`pl.place   = $${params.length}`);
  }
  if (part_id) {
    params.push(part_id);
    where.push(`pl.part_id = $${params.length}`);
  }
  if (unit_id) {
    params.push(unit_id);
    where.push(`pl.unit_id = $${params.length}`);
  }
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(
      `(p.name ILIKE $${params.length} OR pl.ppid ILIKE $${params.length})`
    );
  }
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await db.query(
      `
      SELECT
        pl.ppid,
        pl.id, pl.part_id, p.name AS part_name,
        pl.place, pl.unit_id, s.service_tag AS unit_service_tag,
        pl.is_functional, pl.created_at, pl.updated_at
      FROM part_list pl
      JOIN parts  p  ON p.id = pl.part_id
      LEFT JOIN system s ON s.id = pl.unit_id
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
        pl.id, pl.part_id, p.name AS part_name,
        pl.place, pl.unit_id, s.service_tag AS unit_service_tag,
        pl.is_functional, pl.created_at, pl.updated_at
      FROM part_list pl
      JOIN parts  p  ON p.id = pl.part_id
      LEFT JOIN system s ON s.id = pl.unit_id
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
 * Body: { part_id, place?='inventory', unit_id?, is_functional?=true }
 * Creates a new physical item with the given PPID.
 */
router.post("/:ppid", authenticateToken, async (req, res) => {
  const ppid = String(req.params.ppid || "").toUpperCase();
  const {
    part_id,
    place = "inventory",
    unit_id,
    is_functional = true,
  } = req.body || {};

  if (!ppid) return res.status(400).json({ error: "PPID is required in path" });
  if (!part_id) return res.status(400).json({ error: "part_id is required" });
  if (place === "unit" && !unit_id) {
    return res
      .status(400)
      .json({ error: "unit_id required when place='unit'" });
  }

  try {
    const { rows } = await db.query(
      `
      INSERT INTO part_list (ppid, part_id, place, unit_id, is_functional)
      VALUES ($1,   $2,      $3,    $4,      $5)
      RETURNING *
      `,
      [ppid, part_id, place, place === "unit" ? unit_id : null, !!is_functional]
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
 * Body: { part_id?, place?, unit_id?, is_functional?, ppid? }  // ppid lets you rename
 */
router.patch("/:ppid", authenticateToken, async (req, res) => {
  const current = String(req.params.ppid || "").toUpperCase();
  const { part_id, place, unit_id, is_functional, ppid } = req.body || {};

  if (
    part_id === undefined &&
    place === undefined &&
    unit_id === undefined &&
    is_functional === undefined &&
    ppid === undefined
  ) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const fields = [];
  const vals = [];

  if (part_id !== undefined) {
    fields.push(`part_id = $${fields.length + 1}`);
    vals.push(part_id);
  }
  if (place !== undefined) {
    fields.push(`place = $${fields.length + 1}`);
    vals.push(place);
  }
  if (unit_id !== undefined) {
    fields.push(`unit_id = $${fields.length + 1}`);
    vals.push(unit_id);
  }
  if (is_functional !== undefined) {
    fields.push(`is_functional = $${fields.length + 1}`);
    vals.push(!!is_functional);
  }
  if (ppid !== undefined) {
    fields.push(`ppid = $${fields.length + 1}`);
    vals.push(ppid ? ppid.toUpperCase() : null);
  }

  vals.push(current);

  try {
    const { rows } = await db.query(
      `UPDATE part_list SET ${fields.join(", ")} WHERE ppid = $${
        vals.length
      } RETURNING *`,
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
      return res
        .status(409)
        .json({
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
