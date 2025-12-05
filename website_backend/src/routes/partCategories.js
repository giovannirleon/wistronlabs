const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");
const { ensureAdmin } = require("../utils/ensureAdmin");

const router = express.Router();

// GET /api/v1/systems/part-category (?q= to search by name)
router.get("/", async (req, res) => {
  const { q } = req.query;
  try {
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      const { rows } = await db.query(
        `SELECT id, name
           FROM part_categories
          WHERE name ILIKE $1
          ORDER BY name ASC`,
        [like]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(
      `SELECT id, name FROM part_categories ORDER BY name ASC`
    );
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list part categories" });
  }
});

// GET /api/v1/systems/part-category/:id
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM part_categories WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Part category not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch part category" });
  }
});

// POST /api/v1/systems/part-category (admin)
router.post("/", authenticateToken, ensureAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO part_categories (name)
         VALUES ($1)
         RETURNING id, name`,
      [name.trim()]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res
        .status(409)
        .json({ error: "Part category name already exists" });
    }
    return res.status(500).json({ error: "Failed to create part category" });
  }
});

// PATCH /api/v1/systems/part-category/:id (admin)
router.patch("/:id", authenticateToken, ensureAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (typeof name === "undefined") {
    return res.status(400).json({ error: "Nothing to update" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE part_categories
            SET name = $1
          WHERE id = $2
      RETURNING id, name`,
      [String(name ?? "").trim(), req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Part category not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res
        .status(409)
        .json({ error: "Part category name already exists" });
    }
    return res.status(500).json({ error: "Failed to update part category" });
  }
});

// DELETE /api/v1/systems/part-category/:id (admin)
// If referenced by parts, block with 409.
router.delete("/:id", authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { rows: ref } = await db.query(
      `SELECT EXISTS(SELECT 1 FROM parts WHERE part_category_id = $1) AS used`,
      [req.params.id]
    );
    if (ref[0].used) {
      return res.status(409).json({
        error: "Cannot delete category: referenced by parts",
      });
    }

    const del = await db.query(`DELETE FROM part_categories WHERE id = $1`, [
      req.params.id,
    ]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: "Part category not found" });
    }
    return res.json({ message: "Part category deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete part category" });
  }
});

module.exports = router;
