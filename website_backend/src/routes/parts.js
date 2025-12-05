const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");
const { ensureAdmin } = require("../utils/ensureAdmin");

const router = express.Router();

// GET /api/v1/systems/part  (?q= to search by part name, ?category_id=123 to filter)
router.get("/", async (req, res) => {
  const { q, category_id } = req.query;
  const params = [];
  const where = [];

  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }
  if (category_id) {
    params.push(category_id);
    where.push(`p.part_category_id = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const { rows } = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.part_category_id,
          p.dpn,
          pc.name AS category_name
        FROM parts p
        LEFT JOIN part_categories pc ON pc.id = p.part_category_id
        ${whereSql}
        ORDER BY p.name ASC
        `,
      params
    );
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list parts" });
  }
});

// GET /api/v1/systems/part/:id
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `
        SELECT
          p.id,
          p.name,
          p.part_category_id,
          p.dpn,
          pc.name AS category_name
        FROM parts p
        LEFT JOIN part_categories pc ON pc.id = p.part_category_id
        WHERE p.id = $1
        `,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Part not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch part" });
  }
});

// POST /api/v1/systems/part   { name, dpn, part_category_id? }  (admin)
router.post("/", authenticateToken, ensureAdmin, async (req, res) => {
  const { name, part_category_id, dpn } = req.body || {};
  const cleanName = (name || "").trim();
  const cleanDpn = (dpn || "").trim();

  if (!cleanName || !cleanDpn) {
    return res.status(400).json({ error: "name and dpn are required" });
  }

  try {
    const { rows } = await db.query(
      `
        INSERT INTO parts (name, part_category_id, dpn)
        VALUES ($1, $2, $3)
        RETURNING id, name, part_category_id, dpn
        `,
      [cleanName, part_category_id || null, cleanDpn]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      if (e.constraint === "parts_name_key") {
        return res.status(409).json({ error: "Part name already exists" });
      }
      if (e.constraint === "parts_dpn_key") {
        return res.status(409).json({ error: "Part DPN already exists" });
      }
      return res
        .status(409)
        .json({ error: "Unique constraint violation on parts" });
    }
    return res.status(500).json({ error: "Failed to create part" });
  }
});

// PATCH /api/v1/systems/part/:id   { name?, dpn?, part_category_id? }  (admin)
router.patch("/:id", authenticateToken, ensureAdmin, async (req, res) => {
  const { name, part_category_id, dpn } = req.body || {};

  const fields = [];
  const vals = [];

  if (typeof name !== "undefined") {
    fields.push(`name = $${fields.length + 1}`);
    vals.push(String(name || "").trim());
  }
  if (typeof part_category_id !== "undefined") {
    fields.push(`part_category_id = $${fields.length + 1}`);
    vals.push(part_category_id || null);
  }
  if (typeof dpn !== "undefined") {
    const cleanDpn = String(dpn || "").trim();
    if (!cleanDpn) {
      return res.status(400).json({ error: "dpn cannot be empty" });
    }
    fields.push(`dpn = $${fields.length + 1}`);
    vals.push(cleanDpn);
  }

  if (!fields.length) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    const { rows } = await db.query(
      `
        UPDATE parts
           SET ${fields.join(", ")}
         WHERE id = $${fields.length + 1}
     RETURNING id, name, part_category_id, dpn
        `,
      [...vals, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Part not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      if (e.constraint === "parts_name_key") {
        return res.status(409).json({ error: "Part name already exists" });
      }
      if (e.constraint === "parts_dpn_key") {
        return res.status(409).json({ error: "Part DPN already exists" });
      }
      return res
        .status(409)
        .json({ error: "Unique constraint violation on parts" });
    }
    return res.status(500).json({ error: "Failed to update part" });
  }
});

// DELETE /api/v1/systems/part/:id
router.delete("/:id", authenticateToken, ensureAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    // Block delete if referenced in part_list
    const ref = await db.query(
      `
            SELECT EXISTS(
              SELECT 1 FROM part_list WHERE part_id = $1
            ) AS used
          `,
      [id]
    );

    if (ref.rows[0].used) {
      return res.status(409).json({
        error: "Cannot delete part: parts in inventory or in systems",
      });
    }

    const del = await db.query(`DELETE FROM parts WHERE id = $1`, [id]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    return res.json({ message: "Part deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete part" });
  }
});

module.exports = router;
