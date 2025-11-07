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
const { buildWhereClause } = require("../utils/buildWhereClause");
const { systemOnLockedPallet } = require("../utils/systemOnLockedPallet");
const { generatePalletNumber } = require("../utils/generatePalletNumber");

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

function parseAndValidatePPID(ppidRaw) {
  const ppid = (ppidRaw || "").trim().toUpperCase();

  if (ppid.length !== 23 || !/^[A-Z0-9]+$/.test(ppid)) {
    throw new Error("PPID must be exactly 23 uppercase alphanumeric chars");
  }

  const prefix = ppid.slice(0, 3);
  const dpn = ppid.slice(3, 8);
  const factoryCodeRaw = ppid.slice(8, 13);
  const dateCode = ppid.slice(13, 16);
  const serial = ppid.slice(16, 20);
  const rev = ppid.slice(20, 23);

  if (!/^[A-Z0-9]{3}$/.test(prefix)) throw new Error("Invalid prefix format");
  if (!/^[A-Z0-9]{5}$/.test(dpn)) throw new Error("Invalid DPN format");
  if (!/^[A-Z0-9]{5}$/.test(factoryCodeRaw)) {
    throw new Error(`Invalid factory code format: ${factoryCodeRaw}`);
  }
  if (!/^[A-Z0-9]{3}$/.test(dateCode))
    throw new Error("Invalid date code format");
  const manufacturedDate = decodeDateCode(dateCode);
  if (!manufacturedDate || isNaN(manufacturedDate.getTime())) {
    throw new Error("Invalid date code (cannot decode)");
  }
  if (!/^[A-Z0-9]{4}$/.test(serial)) throw new Error("Invalid serial format");
  if (!/^[A-Z0-9]{3}$/.test(rev)) throw new Error("Invalid revision format");

  return { ppid, dpn, factoryCodeRaw, manufacturedDate, serial, rev };
}

/**
 * Assign a system to a pallet (or create a new pallet)
 * Pallets are segregated by factory_id AND dpn.
 */
async function assignSystemToPallet(system_id, factory_id, dpn_id, client) {
  if (!factory_id) throw new Error(`Cannot assign: factory_id is null`);
  if (!dpn_id) throw new Error(`Cannot assign: dpn_id is missing`);

  const { rows } = await client.query(
    `
    SELECT p.id, p.pallet_number
    FROM pallet p
    LEFT JOIN pallet_system ps
      ON p.id = ps.pallet_id AND ps.removed_at IS NULL
    WHERE p.status = 'open' AND p.locked = FALSE
      AND p.factory_id = $1
      AND p.dpn_id = $2
    GROUP BY p.id, p.pallet_number
    HAVING COUNT(ps.id) < 9
    LIMIT 1
    `,
    [factory_id, dpn_id]
  );

  let palletId, palletNumber;
  if (rows.length) {
    ({ id: palletId, pallet_number: palletNumber } = rows[0]);
  } else {
    const newNumber = await generatePalletNumber(factory_id, dpn_id, client);
    const ins = await client.query(
      `INSERT INTO pallet (factory_id, pallet_number, dpn_id)
       VALUES ($1, $2, $3)
       RETURNING id, pallet_number`,
      [factory_id, newNumber, dpn_id]
    );
    palletId = ins.rows[0].id;
    palletNumber = ins.rows[0].pallet_number;
  }

  await client.query(
    `INSERT INTO pallet_system (pallet_id, system_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [palletId, system_id]
  );

  return { pallet_id: palletId, pallet_number: palletNumber };
}

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

async function getFactoryByPPIDCode(ppidCode) {
  const result = await db.query(
    `SELECT id, code, name FROM factory WHERE ppid_code = $1`,
    [ppidCode]
  );
  return result.rows[0] || null;
}

// ---------- helpers ----------
async function ensureAdmin(req, res, next) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { rows } = await db.query(`SELECT admin FROM users WHERE id = $1`, [
      req.user.userId,
    ]);
    if (!rows.length || !rows[0].admin) {
      return res.status(403).json({ error: "Admin privileges required" });
    }
    return next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Auth check failed" });
  }
}

function isPgUniqueViolation(err) {
  return err && err.code === "23505";
}

// ---------- PART CRUD ----------

// GET /api/v1/systems/part  (?q= to search by part name, ?category_id=123 to filter)
router.get("/part", async (req, res) => {
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
router.get("/part/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.part_category_id,
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

// POST /api/v1/systems/part   { name, part_category_id? }  (admin)
router.post("/part", authenticateToken, ensureAdmin, async (req, res) => {
  const { name, part_category_id } = req.body || {};
  const cleanName = (name || "").trim();
  if (!cleanName) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const { rows } = await db.query(
      `
      INSERT INTO parts (name, part_category_id)
      VALUES ($1, $2)
      RETURNING id, name, part_category_id
      `,
      [cleanName, part_category_id || null]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res.status(409).json({ error: "Part name already exists" });
    }
    return res.status(500).json({ error: "Failed to create part" });
  }
});

// PATCH /api/v1/systems/part/:id   { name?, part_category_id? }  (admin)
router.patch("/part/:id", authenticateToken, ensureAdmin, async (req, res) => {
  const { name, part_category_id } = req.body || {};

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
  if (!fields.length) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  try {
    const { rows } = await db.query(
      `
      UPDATE parts
         SET ${fields.join(", ")}
       WHERE id = $${fields.length + 1}
   RETURNING id, name, part_category_id
      `,
      [...vals, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Part not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res.status(409).json({ error: "Part name already exists" });
    }
    return res.status(500).json({ error: "Failed to update part" });
  }
});

// ---------- PART CATEGORY CRUD ----------

// GET /api/v1/systems/part-category (?q= to search by name)
router.get("/part-category", async (req, res) => {
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
router.get("/part-category/:id", async (req, res) => {
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
router.post(
  "/part-category",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
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
  }
);

// PATCH /api/v1/systems/part-category/:id (admin)
router.patch(
  "/part-category/:id",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
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
  }
);

// DELETE /api/v1/systems/part-category/:id (admin)
// If referenced by parts, block with 409.
router.delete(
  "/part-category/:id",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
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
  }
);

// ---------- FACTORY CRUD ----------

// GET factories (optional ?q= search by code or name)
// GET factories (optional ?q= search by code or name)
router.get("/factory", async (req, res) => {
  const { q } = req.query;
  try {
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      const { rows } = await db.query(
        `SELECT id, code, name, ppid_code
           FROM factory
          WHERE code ILIKE $1 OR name ILIKE $1
          ORDER BY code ASC`,
        [like]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(
      `SELECT id, code, name, ppid_code FROM factory ORDER BY code ASC`
    );
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list factories" });
  }
});

// GET single factory
router.get("/factory/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, code, name, ppid_code FROM factory WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Factory not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch factory" });
  }
});

// POST factory (admin)
router.post("/factory", authenticateToken, ensureAdmin, async (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) {
    return res.status(400).json({ error: "code and name are required" });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO factory (code, name)
       VALUES ($1, $2)
       RETURNING id, code, name, ppid_code`,
      [code.trim(), name.trim()]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res
        .status(409)
        .json({ error: "Factory code or name already exists" });
    }
    return res.status(500).json({ error: "Failed to create factory" });
  }
});

// PATCH factory (admin)
router.patch(
  "/factory/:id",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
    const { code, name } = req.body || {};
    if (!code && !name) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    const fields = [];
    const vals = [];
    if (code) {
      fields.push(`code = $${fields.length + 1}`);
      vals.push(code.trim());
    }
    if (name) {
      fields.push(`name = $${fields.length + 1}`);
      vals.push(name.trim());
    }
    try {
      const { rows } = await db.query(
        `UPDATE factory SET ${fields.join(", ")}
         WHERE id = $${fields.length + 1}
       RETURNING id, code, name, ppid_code`,
        [...vals, req.params.id]
      );
      if (!rows.length)
        return res.status(404).json({ error: "Factory not found" });
      return res.json(rows[0]);
    } catch (e) {
      console.error(e);
      if (isPgUniqueViolation(e)) {
        return res
          .status(409)
          .json({ error: "Factory code or name already exists" });
      }
      return res.status(500).json({ error: "Failed to update factory" });
    }
  }
);

// DELETE factory (admin) – block if referenced
router.delete(
  "/factory/:id",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
    const id = req.params.id;
    try {
      // Block delete if referenced by system or pallet
      const ref = await db.query(
        `
      SELECT
        EXISTS(SELECT 1 FROM system WHERE factory_id = $1) AS has_systems,
        EXISTS(SELECT 1 FROM pallet WHERE factory_id = $1) AS has_pallets
      `,
        [id]
      );
      if (ref.rows[0].has_systems || ref.rows[0].has_pallets) {
        return res.status(409).json({
          error: "Cannot delete factory: referenced by systems or pallets",
        });
      }

      const del = await db.query(`DELETE FROM factory WHERE id = $1`, [id]);
      if (del.rowCount === 0) {
        return res.status(404).json({ error: "Factory not found" });
      }
      return res.json({ message: "Factory deleted" });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to delete factory" });
    }
  }
);

// ---------- DPN CRUD ----------

// GET dpns (optional ?q= search by name or config)
router.get("/dpn", async (req, res) => {
  const { q } = req.query;
  try {
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      const { rows } = await db.query(
        `SELECT id, name, config, dell_customer
           FROM dpn
          WHERE name ILIKE $1
           OR CAST(config AS TEXT) ILIKE $1
           OR dell_customer ILIKE $1
          ORDER BY name ASC`,
        [like]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(
      `SELECT id, name, config, dell_customer FROM dpn ORDER BY name ASC`
    );
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list DPNs" });
  }
});

// GET single dpn
router.get("/dpn/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, config, dell_customer FROM dpn WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "DPN not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch DPN" });
  }
});

// POST dpn (admin)
router.post("/dpn", authenticateToken, ensureAdmin, async (req, res) => {
  const { name, config, dell_customer } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO dpn (name, config, dell_customer)
        VALUES ($1, $2, $3)
        RETURNING id, name, config, dell_customer`,
      [name.trim(), (config ?? "").trim(), (dell_customer ?? "").trim()]
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res.status(409).json({ error: "DPN name already exists" });
    }
    return res.status(500).json({ error: "Failed to create DPN" });
  }
});

// PATCH dpn (admin)
router.patch("/dpn/:id", authenticateToken, ensureAdmin, async (req, res) => {
  const { name, config, dell_customer } = req.body || {};
  if (
    typeof name === "undefined" &&
    typeof config === "undefined" &&
    typeof dell_customer === "undefined"
  ) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const fields = [];
  const vals = [];
  if (typeof name !== "undefined") {
    fields.push(`name = $${fields.length + 1}`);
    vals.push(name.trim());
  }
  if (typeof config !== "undefined") {
    fields.push(`config = $${fields.length + 1}`);
    vals.push((config ?? "").trim());
  }
  if (typeof dell_customer !== "undefined") {
    fields.push(`dell_customer = $${fields.length + 1}`);
    vals.push((dell_customer ?? "").trim());
  }
  try {
    const { rows } = await db.query(
      `UPDATE dpn SET ${fields.join(", ")}
         WHERE id = $${fields.length + 1}
       RETURNING id, name, config, dell_customer`,
      [...vals, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "DPN not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    if (isPgUniqueViolation(e)) {
      return res.status(409).json({ error: "DPN name already exists" });
    }
    return res.status(500).json({ error: "Failed to update DPN" });
  }
});

// DELETE dpn (admin) – block if referenced
router.delete("/dpn/:id", authenticateToken, ensureAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    // Block delete if referenced by system or pallet
    const ref = await db.query(
      `
      SELECT
        EXISTS(SELECT 1 FROM system WHERE dpn_id = $1) AS has_systems,
        EXISTS(SELECT 1 FROM pallet WHERE dpn_id = $1) AS has_pallets
      `,
      [id]
    );
    if (ref.rows[0].has_systems || ref.rows[0].has_pallets) {
      return res.status(409).json({
        error: "Cannot delete DPN: referenced by systems or pallets",
      });
    }

    const del = await db.query(`DELETE FROM dpn WHERE id = $1`, [id]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: "DPN not found" });
    }
    return res.json({ message: "DPN deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to delete DPN" });
  }
});

// ---------- ROOT CAUSE (LIST/GET) ----------
router.get("/root-cause", async (req, res) => {
  const { q } = req.query;
  try {
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      const { rows } = await db.query(
        `SELECT id, name
           FROM root_cause
          WHERE name ILIKE $1
          ORDER BY name ASC`,
        [like]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(
      `SELECT id, name FROM root_cause ORDER BY name ASC`
    );
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to list root causes" });
  }
});

router.get("/root-cause/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM root_cause WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to fetch root cause" });
  }
});

// ---------- ROOT CAUSE SUB-CATEGORIES (LIST/GET) ----------
router.get("/root-cause-sub-categories", async (req, res) => {
  const { q } = req.query;
  try {
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      const { rows } = await db.query(
        `SELECT id, name
           FROM root_cause_sub_categories
          WHERE name ILIKE $1
          ORDER BY name ASC`,
        [like]
      );
      return res.json(rows);
    }
    const { rows } = await db.query(
      `SELECT id, name FROM root_cause_sub_categories ORDER BY name ASC`
    );
    return res.json(rows);
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: "Failed to list root cause sub-categories" });
  }
});

router.get("/root-cause-sub-categories/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM root_cause_sub_categories WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: "Failed to fetch root cause sub-category" });
  }
});

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
    search, // 👈 capture it
  } = req.query;

  const params = [];
  let whereSQL = "";

  // --- filters (existing) ---
  if (filters) {
    const parsed = typeof filters === "string" ? JSON.parse(filters) : filters;
    if (parsed && parsed.conditions?.length) {
      const filtersSQL = buildWhereClause(parsed, params, {
        service_tag: "s.service_tag",
        issue: "s.issue",
        location_id: "s.location_id",
        location: "l.name",
        dpn: "d.name",
        dell_customer: "d.dell_customer",
        manufactured_date: "s.manufactured_date",
        serial: "s.serial",
        rev: "s.rev",
        factory: "f.code",
        ppid: "s.ppid",
        root_cause: "rc.name",
        root_cause_sub_category: "rcs.name",
      });
      if (filtersSQL) whereSQL = `WHERE ${filtersSQL}`;
    }
  }

  // --- free-text search (NEW) ---
  // AND across terms, OR across fields per term
  // e.g. search="KR7T5 bianca" -> matches rows that contain "KR7T5" AND "bianca" somewhere among these columns
  if (search && String(search).trim()) {
    const terms = String(search).trim().split(/\s+/).slice(0, 8); // cap terms defensively
    const searchClauses = terms.map((t) => {
      const p = `%${t}%`;
      // push one param per field below (keep order consistent with SQL)
      params.push(p, p, p, p, p, p, p, p, p, p);
      //            1  2  3  4  5  6  7  8   9   10
      // fields: service_tag, issue, location, dpn, dpn.config, dell_customer,
      //         ppid, factory_code, rc.name, rcs.name
      return `(
        s.service_tag ILIKE $${params.length - 9} OR
        s.issue       ILIKE $${params.length - 8} OR
        l.name        ILIKE $${params.length - 7} OR
        d.name        ILIKE $${params.length - 6} OR
        d.config      ILIKE $${params.length - 5} OR
        d.dell_customer ILIKE $${params.length - 4} OR
        s.ppid        ILIKE $${params.length - 3} OR
        f.code        ILIKE $${params.length - 2} OR
        rc.name       ILIKE $${params.length - 1} OR
        rcs.name      ILIKE $${params.length - 0}
      )`;
    });

    const searchSQL = searchClauses.join(" AND "); // AND across terms
    whereSQL = whereSQL
      ? `${whereSQL} AND (${searchSQL})`
      : `WHERE ${searchSQL}`;
  }

  // --- sorting (existing) ---
  const allowedSortColumns = {
    service_tag: "s.service_tag",
    issue: "s.issue",
    location: "l.name",
    dpn: "d.name",
    dell_customer: "d.dell_customer",
    manufactured_date: "s.manufactured_date",
    serial: "s.serial",
    rev: "s.rev",
    factory: "f.code",
    date_created: "first_history.changed_at",
    date_modified: "last_history.changed_at",
    added_by: "first_user.username",
    root_cause: "rc.name",
    root_cause_sub_category: "rcs.name",
  };
  const orderColumn = allowedSortColumns[sort_by] || "s.service_tag";
  const orderDirection = sort_order === "asc" ? "ASC" : "DESC";
  const orderSql = `${orderColumn} ${orderDirection} NULLS LAST`;

  // --- paging (existing) ---
  let limitOffsetSQL = "";
  let pageNum, pageSize, offset;
  if (!all || all === "false") {
    pageNum = Math.max(parseInt(page), 1);
    pageSize = Math.min(parseInt(page_size), 100);
    offset = (pageNum - 1) * pageSize;
    limitOffsetSQL = `LIMIT ${pageSize} OFFSET ${offset}`;
  }

  try {
    const baseSelect = `
      SELECT 
        s.id,
        s.service_tag,
        s.issue,
        d.name  AS dpn,
        d.config AS config,
        d.dell_customer AS dell_customer,
        s.manufactured_date,
        s.serial,
        s.rev,
        s.ppid,
        s.rack_service_tag AS rack_id, 
        l.name AS location,
        f.code AS factory_code,
        f.name AS factory_name,
        rc.name  AS root_cause,
        rcs.name AS root_cause_sub_category,
        first_history.changed_at AS date_created,
        first_user.username AS added_by,
        last_history.changed_at AS date_modified
      FROM system s
      JOIN location l ON s.location_id = l.id
      LEFT JOIN factory f ON s.factory_id = f.id
      LEFT JOIN dpn d ON s.dpn_id = d.id
      LEFT JOIN root_cause rc                 ON rc.id  = s.root_cause_id
      LEFT JOIN root_cause_sub_categories rcs ON rcs.id = s.root_cause_sub_category_id
      LEFT JOIN LATERAL (
        SELECT h.changed_at, h.moved_by
        FROM system_location_history h
        WHERE h.system_id = s.id
        ORDER BY h.changed_at ASC
        LIMIT 1
      ) AS first_history ON TRUE
      LEFT JOIN users first_user ON first_user.id = first_history.moved_by
      LEFT JOIN LATERAL (
        SELECT h.changed_at
        FROM system_location_history h
        WHERE h.system_id = s.id
        ORDER BY h.changed_at DESC
        LIMIT 1
      ) AS last_history ON TRUE
    `;

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `${baseSelect} ${whereSQL} ORDER BY ${orderSql} ${limitOffsetSQL}`,
        params
      ),
      !all || all === "false"
        ? db.query(
            `
            SELECT COUNT(*) AS count
            FROM system s
            JOIN location l ON s.location_id = l.id
            LEFT JOIN factory f ON s.factory_id = f.id
            LEFT JOIN dpn d ON s.dpn_id = d.id
            LEFT JOIN root_cause rc                 ON rc.id  = s.root_cause_id
            LEFT JOIN root_cause_sub_categories rcs ON rcs.id = s.root_cause_sub_category_id
            ${whereSQL}
            `,
            params
          )
        : Promise.resolve({ rows: [] }),
    ]);

    if (all && all !== "false") return res.json(dataResult.rows);

    const total_count = parseInt(countResult.rows[0].count, 10);
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
  const {
    date, // REQUIRED: EOD ISO
    locations, // OPTIONAL: comma-separated names
    includeNote, // OPTIONAL
    noCache, // OPTIONAL
    mode = "cumulative", // 'perday' | 'cumulative'
    start, // SoD ISO, required when mode=perday
    includeReceived, // 'true' to compute "Last Received On"
    format, // 'csv' to return CSV
    timezone, // for MM/DD in notes
    simplified, // NEW: if true, apply simplified status mapping
  } = req.query;

  if (!date) {
    return res
      .status(400)
      .json({ error: "Missing required `date` query param" });
  }
  if (mode === "perday" && !start) {
    return res
      .status(400)
      .json({ error: "When mode=perday, `start` is required" });
  }

  const includeNoteFlag =
    includeNote === "true" || includeNote === "1" || includeNote === true;
  const noCacheFlag = noCache === "true" || noCache === "1" || noCache === true;
  const includeReceivedFlag =
    includeReceived === "true" ||
    includeReceived === "1" ||
    includeReceived === true;
  const wantCSV = format === "csv";

  // NEW: simplified flag
  const simplifiedFlag =
    simplified === "true" || simplified === "1" || simplified === true;

  const INACTIVE_LOCATION_IDS = [6, 7, 8, 9];
  const RECEIVED_LOCATION_ID = 1;

  const serverZone = process.env.SERVER_TZ || "UTC";
  const displayZone = timezone || serverZone;

  // NEW: add simplifiedFlag to cache key
  const cacheKey =
    `${date}:${locations || ""}:${includeNoteFlag}:${mode}:${start || ""}:` +
    `${includeReceivedFlag}:${displayZone}:${simplifiedFlag}`;
  if (!noCacheFlag && !wantCSV) {
    const cached = snapshotCache.get(cacheKey);
    if (cached) {
      snapshotCache.ttl(cacheKey, 300);
      return res.json(cached);
    }
  }

  // Build params
  const params = [date];
  const locationFilterSQL = [];
  if (locations) {
    const list = locations
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) {
      const placeholders = list.map((_, i) => `$${i + 2}`);
      locationFilterSQL.push(`AND l.name IN (${placeholders.join(", ")})`);
      params.push(...list);
    }
  }

  // Notes aggregate (unchanged) ...
  const selectNotesAggregate = includeNoteFlag
    ? `,
        nh.notes_history`
    : ``;

  const lateralJoinNotesAggregate = includeNoteFlag
    ? `
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'changed_at', to_char(h2.changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'from_location', l_from.name,
              'to_location', l_to.name,
              'note', h2.note,
              'moved_by', u.username
            )
            ORDER BY h2.changed_at DESC
          ),
          '[]'::json
        ) AS notes_history
        FROM system_location_history h2
        LEFT JOIN location l_from ON h2.from_location_id = l_from.id
        JOIN location l_to   ON h2.to_location_id = l_to.id
        LEFT JOIN users   u  ON h2.moved_by       = u.id
        WHERE h2.system_id = s.id
          AND h2.changed_at <= $1
      ) nh ON TRUE
    `
    : ``;

  // Unit parts aggregate (unchanged) ...
  const lateralJoinUnitParts = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'is_functional', pl.is_functional,
          'ppid', pl.ppid,
          'part_name', p.name,
          'line',
            CASE WHEN pl.is_functional
              THEN 'Good Part - ' || COALESCE(p.name, '#' || pl.part_id) || ' - ' || COALESCE(pl.ppid,'')
              ELSE 'BAD PART - '  || COALESCE(p.name, '#' || pl.part_id) || ' - ' || COALESCE(pl.ppid,'')
            END
        )
        ORDER BY pl.created_at DESC
      ), '[]'::json
    ) AS unit_parts
    FROM part_list pl
    JOIN parts p ON p.id = pl.part_id
    WHERE pl.place = 'unit'::part_place
      AND pl.unit_id = s.id
  ) up ON TRUE
`;

  // Per-day exclusion SQL (unchanged) ...
  let perDayExclusionSQL = ``;
  if (mode === "perday") {
    const startIdx = params.length + 1;
    const inactiveIdx = params.length + 2;
    perDayExclusionSQL = `
    AND NOT (
      l.id = ANY($${inactiveIdx}::int[])
      AND h.changed_at < $${startIdx}
      AND NOT EXISTS (
        SELECT 1
        FROM pallet p
        JOIN pallet_system ps ON ps.pallet_id = p.id
        WHERE p.status = 'released'
          AND p.released_at >= $${startIdx}
          AND p.released_at <= $1
          AND ps.system_id = s.id
          AND ps.added_at <= p.released_at
          AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
      )
    )
  `;
    params.push(start);
    params.push(INACTIVE_LOCATION_IDS);
  }

  try {
    const snapshotResult = await db.query(
      `
      WITH latest_state AS (
        SELECT DISTINCT ON (h.system_id)
          h.system_id,
          h.to_location_id,
          h.changed_at
        FROM system_location_history h
        WHERE h.changed_at <= $1
        ORDER BY h.system_id, h.changed_at DESC
      )
      SELECT 
        s.service_tag,
        COALESCE(f.code, 'Not Entered Yet') AS factory_code,
        s.issue,
        d.name   AS dpn,
        d.config AS config,
        d.dell_customer AS dell_customer,
        CASE
          WHEN trim(l.name) ILIKE 'RMA%' THEN
            regexp_replace(l.name, '\\s*\\((PENDING|COMPLETE)\\)$', '', 'i')
            ||
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM pallet p
                JOIN pallet_system ps ON ps.pallet_id = p.id
                WHERE p.status = 'open'
                  AND ps.system_id = s.id
                  AND ps.removed_at IS NULL
              )
              THEN ' (PENDING)'
              ELSE ' (COMPLETE)'
            END
          ELSE l.name
        END AS location,
        to_char(h.changed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS date_modified
        s.rack_service_tag AS rack_id
        ${selectNotesAggregate}
        , up.unit_parts
        , CASE
            WHEN s.root_cause_id IS NULL AND s.root_cause_sub_category_id IS NULL THEN NULL
            WHEN s.root_cause_id IS NOT NULL AND s.root_cause_sub_category_id IS NOT NULL THEN rc.name || ' - ' || rcs.name
            WHEN s.root_cause_id IS NOT NULL THEN rc.name
            ELSE rcs.name
          END AS root_cause
        , to_char(first_history.first_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS first_received_on
        ${
          includeReceivedFlag
            ? `,
        to_char(last_recv.last_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_received_on`
            : ``
        }
      FROM system s
      JOIN latest_state h  ON h.system_id = s.id
      JOIN location l      ON h.to_location_id = l.id
      LEFT JOIN factory f  ON s.factory_id = f.id
      LEFT JOIN dpn d      ON s.dpn_id     = d.id
      LEFT JOIN root_cause rc ON rc.id = s.root_cause_id
      LEFT JOIN root_cause_sub_categories rcs ON rcs.id = s.root_cause_sub_category_id
      ${lateralJoinNotesAggregate}
      ${lateralJoinUnitParts}
      LEFT JOIN LATERAL (
        SELECT h0.changed_at AS first_at
        FROM system_location_history h0
        WHERE h0.system_id = s.id
        ORDER BY h0.changed_at ASC
        LIMIT 1
      ) AS first_history ON TRUE
      ${
        includeReceivedFlag
          ? `
      LEFT JOIN LATERAL (
        SELECT h3.changed_at AS last_received_at
        FROM system_location_history h3
        WHERE h3.system_id = s.id
          AND h3.changed_at <= $1
          AND h3.to_location_id = ${RECEIVED_LOCATION_ID}
        ORDER BY h3.changed_at DESC
        LIMIT 1
      ) AS last_recv ON TRUE`
          : ``
      }
      LEFT JOIN LATERAL (
        SELECT TRUE AS on_open_pallet
        FROM pallet p
        JOIN pallet_system ps ON ps.pallet_id = p.id
        WHERE p.status = 'open'
          AND ps.system_id = s.id
          AND ps.removed_at IS NULL
        LIMIT 1
      ) ops ON TRUE
      WHERE 1=1
      ${locationFilterSQL.join(" ")}
      ${perDayExclusionSQL}
      ORDER BY s.service_tag
      `,
      params
    );

    const rows = snapshotResult.rows;

    // NEW: apply simplified mapping (but keep original for PIC usage)
    if (simplifiedFlag) {
      const reRMAComplete = /^RMA\s+(VID|CID|PID)\s+\(COMPLETE\)$/i;
      const reRMAPending = /^RMA\s+(VID|CID|PID)\s+\(PENDING\)$/i;
      const reInDebugSet = /^(In L10|In Debug - Wistron|Received)$/i;

      for (const r of rows) {
        const original = (r.location || "").trim();
        r._orig_location = original; // preserve for PIC extraction in CSV

        if (reRMAComplete.test(original)) {
          r.location = "RMA Done";
        } else if (reRMAPending.test(original)) {
          r.location = "Waiting for RMA";
        } else if (/^Sent to L11$/i.test(original)) {
          r.location = "Fixed";
        } else if (reInDebugSet.test(original)) {
          r.location = "In Debug";
        } // else leave as-is
      }
    }

    if (!wantCSV) {
      if (!noCacheFlag) snapshotCache.set(cacheKey, rows, 300);
      return res.json(rows);
    }

    // ---- CSV (send once, no streaming) ----
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="snapshot_${(date || "").slice(0, 10)}_${mode}.csv"`
    );
    res.setHeader("Cache-Control", "no-store");

    const header = [
      "First Received On",
      "Last Received On",
      "Date Modified",
      "Rack ID",
      "PIC",
      "From",
      "Status",
      "Service Tag",
      "DPN",
      "Config",
      ...(!simplifiedFlag ? ["Dell Customer"] : []),
      "Issue",
      "Note History",
      "Root Cause",
      "Unit Parts",
    ];

    const csvEsc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: displayZone,
      month: "2-digit",
      day: "2-digit",
    });

    // const fmtDateTime = new Intl.DateTimeFormat("en-US", {
    //   timeZone: "America/Chicago",
    //   year: "numeric",
    //   month: "2-digit",
    //   day: "2-digit",
    //   hour: "2-digit",
    //   minute: "2-digit",
    //   hour12: true,
    // });

    // replace your fmtDateTime with:
    const fmtExcelText = (iso) => {
      if (!iso) return "";
      // displayZone already comes from query or SERVER_TZ
      return new Date(iso).toLocaleString("sv-SE", {
        timeZone: displayZone, // e.g., "America/Chicago"
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    };

    const lines = [];
    lines.push(header.join(","));

    for (const r of rows) {
      // const firstLocal = r.first_received_on
      //   ? fmtDateTime.format(new Date(r.first_received_on))
      //   : "";
      // const lastLocal =
      //   includeReceivedFlag && r.last_received_on
      //     ? fmtDateTime.format(new Date(r.last_received_on))
      //     : "";
      // const modifiedLocal = r.date_modified
      //   ? fmtDateTime.format(new Date(r.date_modified))
      //   : "";
      const firstLocal = r.first_received_on
        ? fmtExcelText(r.first_received_on)
        : "";
      const lastLocal =
        includeReceivedFlag && r.last_received_on
          ? fmtExcelText(r.last_received_on)
          : "";
      const modifiedLocal = r.date_modified
        ? fmtExcelText(r.date_modified)
        : "";

      // Use original RMA location for PIC extraction so simplified labels don’t break it
      const locForPic = r._orig_location || r.location || "";
      const pic = locForPic.startsWith("RMA ")
        ? locForPic
            .replace(/^RMA\s+/, "")
            .replace(/\s+\((PENDING|COMPLETE)\)$/, "")
        : "";

      let noteHistoryText = "";
      if (
        includeNoteFlag &&
        Array.isArray(r.notes_history) &&
        r.notes_history.length
      ) {
        const reversed = [...r.notes_history].reverse(); // oldest -> newest
        noteHistoryText = reversed
          .map((e) => {
            const dt = new Date(e.changed_at);
            const mmdd = fmt.format(dt);
            const fromLoc = e.from_location || "";
            const toLoc = e.to_location || "";
            const note = (e.note || "").trim();
            const by = e.moved_by || "";
            return fromLoc
              ? `${mmdd} - [${fromLoc} -> ${toLoc}] - ${note} [via] ${by}`
              : `${mmdd} - [${toLoc}] - ${note} [via] ${by}`;
          })
          .join("\n");
      }

      let unitPartsText = "";
      if (Array.isArray(r.unit_parts) && r.unit_parts.length) {
        unitPartsText = r.unit_parts.map((e) => e.line).join("\n");
      }
      const rootCauseText = r.root_cause || "";

      const row = [
        firstLocal ?? "",
        includeReceivedFlag ? lastLocal ?? "" : "",
        modifiedLocal ?? "",
        r.rack_id ?? "",
        pic ?? "",
        r.factory_code ?? "",
        r.location ?? "", // already simplified upstream if needed
        r.service_tag ?? "",
        r.dpn ?? "",
        r.config != null ? `Config ${r.config}` : "",
        ...(!simplifiedFlag ? [r.dell_customer ?? ""] : []),
        r.issue ?? "",
        noteHistoryText ?? "",
        rootCauseText ?? "",
        unitPartsText ?? "",
      ].map((v) => csvEsc(String(v)));

      lines.push(row.join(","));
    }

    const csv = lines.join("\n");
    return res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch snapshot" });
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
            note: "h.note",
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
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // 1. Find system by service_tag
      const systemResult = await client.query(
        "SELECT id FROM system WHERE service_tag = $1",
        [service_tag]
      );
      if (systemResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "System not found" });
      }
      const system_id = systemResult.rows[0].id;

      // Resolve IDs for: "Sent to L11", "RMA VID", "RMA CID", "RMA PID"
      const resolvedLocRes = await client.query(
        `
            SELECT id
            FROM location
            WHERE name = ANY($1)
          `,
        [["Sent to L11", "RMA VID", "RMA CID", "RMA PID"]]
      );
      const RESOLVED_LOCATION_IDS = resolvedLocRes.rows.map((r) => r.id);

      // 2. Get history entries newest → oldest
      const historyResult = await client.query(
        `
        SELECT id, moved_by, to_location_id
        FROM system_location_history
        WHERE system_id = $1
        ORDER BY changed_at DESC
        `,
        [system_id]
      );
      if (historyResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "No history entries found" });
      }
      if (historyResult.rows.length === 1) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: "Cannot delete the first history entry" });
      }

      const {
        id: history_id,
        moved_by,
        to_location_id: deletedToLocationId,
      } = historyResult.rows[0];

      // 3. Who is deleting? (check admin flag from DB)
      const meRes = await client.query(
        `SELECT admin FROM users WHERE id = $1`,
        [req.user.userId]
      );
      const isAdmin = !!meRes.rows[0]?.admin;

      // 3b. (Optional) Get deleted_user id, if present
      let deletedUserId = null;
      const deletedUserIdResult = await client.query(
        `SELECT id FROM users WHERE username = 'deleted_user@example.com'`
      );
      if (deletedUserIdResult.rows.length) {
        deletedUserId = deletedUserIdResult.rows[0].id;
      }

      // 4. Authorization check:
      //    Allow if admin OR self-owned entry OR an entry created by deleted_user
      if (
        !isAdmin &&
        moved_by !== req.user.userId &&
        !(deletedUserId && moved_by === deletedUserId)
      ) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error:
            "Not authorized. Only the note author or an other authorized users can delete this entry.",
        });
      }
      const onLocked = await systemOnLockedPallet(client, system_id);
      if (onLocked) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "System is on a locked pallet — cannot roll back history",
        });
      }

      // 4b. If the *current* (to-be-deleted) entry is a resolved location,
      //     clear root cause fields on the system.
      if (
        deletedToLocationId &&
        RESOLVED_LOCATION_IDS.includes(deletedToLocationId)
      ) {
        await client.query(
          `
                  UPDATE system
                  SET root_cause_id = NULL,
                      root_cause_sub_category_id = NULL
                WHERE id = $1
                `,
          [system_id]
        );
      }

      // 5. Delete latest history entry
      await client.query("DELETE FROM system_location_history WHERE id = $1", [
        history_id,
      ]);

      // 6. Roll back system.location_id to new latest entry
      const latestRemaining = await client.query(
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

      await client.query("UPDATE system SET location_id = $1 WHERE id = $2", [
        rollbackLocation,
        system_id,
      ]);

      // 7. If we are LEAVING an RMA location, remove from any open pallet
      if (
        deletedToLocationId &&
        RMA_LOCATION_IDS.includes(deletedToLocationId)
      ) {
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

      await client.query("COMMIT");
      res.json({
        message:
          "Last history entry deleted, system location rolled back" +
          (deletedToLocationId && RMA_LOCATION_IDS.includes(deletedToLocationId)
            ? " and removed from open pallet"
            : ""),
        new_location_id: rollbackLocation,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ error: "Failed to delete last history entry" });
    } finally {
      client.release();
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
  const { service_tag, issue, location_id, ppid, rack_service_tag } = req.body;

  if (
    !service_tag?.trim() ||
    !location_id ||
    !ppid?.trim() ||
    !rack_service_tag?.trim()
  ) {
    return res.status(400).json({
      error:
        "service_tag, location_id, ppid, and rack_service_tag are required",
    });
  }

  let parsed;
  try {
    parsed = parseAndValidatePPID(ppid);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // DPN upsert
    const upsertDpn = await client.query(
      `INSERT INTO dpn (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [parsed.dpn]
    );
    const dpn_id = upsertDpn.rows[0].id;

    // factory via PPID code
    const facRes = await client.query(
      `SELECT id FROM factory WHERE ppid_code = $1`,
      [parsed.factoryCodeRaw]
    );
    const factory_id = facRes.rows[0]?.id || null;
    if (!factory_id)
      throw new Error(`Unknown factory PPID code: ${parsed.factoryCodeRaw}`);

    // insert system
    const ins = await client.query(
      `
      INSERT INTO system
        (service_tag, issue, location_id, ppid, dpn_id, factory_id,
         manufactured_date, serial, rev, rack_service_tag)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
      `,
      [
        service_tag.trim().toUpperCase(),
        issue ?? null,
        location_id,
        parsed.ppid,
        dpn_id,
        factory_id,
        parsed.manufacturedDate,
        parsed.serial,
        parsed.rev,
        rack_service_tag.trim().toUpperCase(),
      ]
    );
    const system_id = ins.rows[0].id;

    await client.query(
      `INSERT INTO system_location_history
         (system_id, from_location_id, to_location_id, note, moved_by)
       VALUES ($1, NULL, $2, $3, $4)`,
      [
        system_id,
        location_id,
        `added to system with issue "${issue}"`,
        req.user.userId,
      ]
    );

    await client.query("COMMIT");

    // respond immediately
    const stUpper = service_tag.trim().toUpperCase();
    const rackUpper = rack_service_tag.trim().toUpperCase();
    res.status(201).json({ service_tag: stUpper });

    // fire-and-forget webhook AFTER response
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000); // 5s for ACK

      const resp = await fetch("http://172.17.0.1:9000/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": process.env.WEBHOOK_TOKEN || "",
        },
        body: JSON.stringify({
          script: "/opt/hooks/on-system-created.sh",
          args: [stUpper, rackUpper], // <-- unit, rack
          wait: "ack", // immediate acknowledgement from host-runner
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await resp.text();
      if (!resp.ok) {
        console.warn(`host-runner ack failed: ${resp.status} ${text}`);
      } else {
        console.log(`host-runner ack: ${text}`);
      }
    } catch (e) {
      console.error("host-runner call failed:", e);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    if (err.code === "23505") {
      return res.status(409).json({ error: "Service tag already exists" });
    }
    return res.status(500).json({ error: "Failed to create system" });
  } finally {
    client.release();
  }
});

// GET /api/v1/systems/:service_tag - get single system
router.get("/:service_tag", async (req, res) => {
  const { service_tag } = req.params;

  try {
    const result = await db.query(
      `
      SELECT 
        s.id,
        s.service_tag,
        s.issue,
        d.name   AS dpn,
        d.config AS config,
        d.dell_customer AS dell_customer,
        s.manufactured_date,
        s.serial,
        s.rev,
        s.ppid,
        s.rack_service_tag AS rack_id,
        l.name AS location,
        f.code AS factory_code,
        f.name AS factory_name,
        rc.name  AS root_cause,
        rcs.name AS root_cause_sub_category,
        -- first history entry
        first_history.changed_at AS date_created,
        first_user.username AS added_by,
        -- last history entry
        last_history.changed_at AS date_modified
      FROM system s
      JOIN location l ON s.location_id = l.id
      LEFT JOIN factory f ON s.factory_id = f.id
      LEFT JOIN dpn d ON s.dpn_id = d.id
      LEFT JOIN root_cause rc                 ON rc.id  = s.root_cause_id
      LEFT JOIN root_cause_sub_categories rcs ON rcs.id = s.root_cause_sub_category_id

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

// PATCH /api/v1/systems/:service_tag/root-cause
router.patch(
  "/:service_tag/root-cause",
  authenticateToken,
  async (req, res) => {
    const { service_tag } = req.params;
    let { root_cause_id, root_cause_sub_category_id } = req.body || {};

    const providedRoot = typeof root_cause_id !== "undefined";
    const providedSub = typeof root_cause_sub_category_id !== "undefined";

    if (!providedRoot && !providedSub) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    if (providedRoot !== providedSub) {
      return res.status(400).json({
        error:
          "root_cause_id and root_cause_sub_category_id must be provided together (both null or both set).",
      });
    }

    // At this point, both are provided. Enforce pair rule:
    const bothNull =
      root_cause_id === null && root_cause_sub_category_id === null;
    const bothSet =
      root_cause_id !== null && root_cause_sub_category_id !== null;

    if (!bothNull && !bothSet) {
      return res.status(400).json({
        error: "Invalid pair: both must be null or both must be non-null.",
      });
    }

    try {
      // Validate when set (existence in lookup tables)
      if (bothSet) {
        const [rc, rcs] = await Promise.all([
          db.query(`SELECT 1 FROM root_cause WHERE id = $1`, [root_cause_id]),
          db.query(`SELECT 1 FROM root_cause_sub_categories WHERE id = $1`, [
            root_cause_sub_category_id,
          ]),
        ]);
        if (!rc.rowCount)
          return res
            .status(400)
            .json({ error: `root_cause id ${root_cause_id} not found` });
        if (!rcs.rowCount)
          return res.status(400).json({
            error: `root_cause_sub_category id ${root_cause_sub_category_id} not found`,
          });
      }

      // Update both columns in one statement
      const upd = await db.query(
        `
      UPDATE system
         SET root_cause_id = $2,
             root_cause_sub_category_id = $3
       WHERE service_tag = $1
       RETURNING id
      `,
        [service_tag, root_cause_id, root_cause_sub_category_id]
      );

      if (!upd.rowCount) {
        return res.status(404).json({ error: "System not found" });
      }

      // Return names (not ids)
      const { rows } = await db.query(
        `
      SELECT rc.name  AS root_cause,
             rcs.name AS root_cause_sub_category
      FROM system s
      LEFT JOIN root_cause rc                 ON rc.id  = s.root_cause_id
      LEFT JOIN root_cause_sub_categories rcs ON rcs.id = s.root_cause_sub_category_id
      WHERE s.service_tag = $1
      `,
        [service_tag]
      );

      return res.json({
        message: "Root cause fields updated",
        root_cause: rows[0].root_cause || null,
        root_cause_sub_category: rows[0].root_cause_sub_category || null,
      });
    } catch (err) {
      console.error(err);
      // Will also catch CHECK constraint violations if someone tries to bypass the API
      return res
        .status(500)
        .json({ error: "Failed to update root cause fields" });
    }
  }
);

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
      `SELECT 
         id, 
         location_id, 
         factory_id, 
         ppid, 
         dpn_id, 
         manufactured_date, 
         serial, 
         rev
       FROM system 
       WHERE service_tag = $1`,
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
      ppid,
      dpn_id,
      manufactured_date,
      serial,
      rev,
    } = rows[0];

    //check if system is on a locked pallet
    const onLocked = await systemOnLockedPallet(client, system_id);
    if (onLocked) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "System is on a locked pallet — location changes are not allowed",
      });
    }

    // RMA validation
    if (RMA_LOCATION_IDS.includes(to_location_id)) {
      const missingFields = [];
      if (!factory_id) missingFields.push("factory_id");
      if (!ppid) missingFields.push("ppid");
      if (!dpn_id) missingFields.push("dpn"); // NULL means missing
      if (!manufactured_date) missingFields.push("manufactured_date");
      if (!serial) missingFields.push("serial");
      if (!rev) missingFields.push("rev");

      if (missingFields.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Cannot move to an RMA location because the following fields are missing: ${missingFields.join(
            ", "
          )}. Update PPID first.`,
        });
      }
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
      const { pallet_number } = await assignSystemToPallet(
        system_id,
        factory_id,
        dpn_id,
        client
      );
      finalNote = `${note} - added to ${pallet_number}`;
    } else if (RMA_LOCATION_IDS.includes(from_location_id)) {
      await client.query(
        `
        UPDATE pallet_system
        SET removed_at = NOW()
        WHERE system_id = $1
          AND removed_at IS NULL
        `,
        [system_id]
      );
    }

    // Log history
    await client.query(
      `INSERT INTO system_location_history
       (system_id, from_location_id, to_location_id, note, moved_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [system_id, from_location_id, to_location_id, finalNote, req.user.userId]
    );

    await client.query("COMMIT");
    // If we added to an RMA pallet, include it in the response
    return res.json({
      message: "Location updated",
      ...(RMA_LOCATION_IDS.includes(to_location_id)
        ? { pallet_number: finalNote.split(" - added to ")[1] }
        : {}),
    });
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

  if (!ppid?.trim()) {
    return res.status(400).json({ error: "ppid is required" });
  }

  let parsed;
  try {
    parsed = parseAndValidatePPID(ppid);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    // factory_id via dynamic ppid_code
    const { rows } = await db.query(
      "SELECT id FROM factory WHERE ppid_code = $1",
      [parsed.factoryCodeRaw]
    );
    const factoryId = rows.length ? rows[0].id : null;

    if (!factoryId) {
      throw new Error(`Unknown factory PPID code: ${parsed.factoryCodeRaw}`);
    }

    // dpn_id from parsed.dpn
    const upsert = await db.query(
      `INSERT INTO dpn (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [parsed.dpn]
    );
    const dpnId = upsert.rows[0].id;

    const fields = [
      { column: "ppid", value: parsed.ppid },
      { column: "dpn_id", value: dpnId },
      { column: "manufactured_date", value: parsed.manufacturedDate },
      { column: "serial", value: parsed.serial },
      { column: "rev", value: parsed.rev },
    ];
    if (factoryId) fields.push({ column: "factory_id", value: factoryId });

    const setClauses = fields
      .map((f, i) => `${f.column} = $${i + 2}`)
      .join(", ");
    const values = fields.map((f) => f.value);

    const result = await db.query(
      `UPDATE system SET ${setClauses} WHERE service_tag = $1 RETURNING service_tag`,
      [service_tag, ...values]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "System not found" });
    }

    res.json({ message: "System PPID fields updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update PPID data" });
  }
});

// PATCH /api/v1/systems/:service_tag/add-to-pallet
router.patch(
  "/:service_tag/add-to-pallet",
  authenticateToken,
  async (req, res) => {
    const { service_tag } = req.params;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // 1. Get system details including location_id and ppid
      const { rows } = await client.query(
        `
      SELECT id, factory_id, dpn_id, location_id, ppid
      FROM system
      WHERE service_tag = $1
      `,
        [service_tag]
      );

      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "System not found" });
      }

      const { id: system_id, factory_id, dpn_id, location_id, ppid } = rows[0];

      // 2. Validate RMA location
      if (!RMA_LOCATION_IDS.includes(location_id)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "System must be in an RMA location before being added to a pallet",
        });
      }

      // 3. Validate PPID
      if (!ppid || !ppid.trim()) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "System must have a valid PPID before being added to a pallet",
        });
      }

      // 4. Validate factory_id and dpn
      if (!factory_id || !dpn_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "System must have factory_id and dpn set before being added to a pallet",
        });
      }

      // 4.5 Block if already on an active pallet (covers locked pallets too)
      const { rows: activePalletRows } = await client.query(
        `
      SELECT p.pallet_number, p.locked, p.status
      FROM pallet_system ps
      JOIN pallet p ON p.id = ps.pallet_id
      WHERE ps.system_id = $1
        AND ps.removed_at IS NULL
      LIMIT 1
      `,
        [system_id]
      );
      if (activePalletRows.length > 0) {
        const { pallet_number, locked, status } = activePalletRows[0];
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `System is already on pallet ${pallet_number} (status: ${status})${
            locked ? " and locked" : ""
          }`,
        });
      }

      // 5. Assign to pallet (your helper already ignores locked pallets)
      const { pallet_id, pallet_number } = await assignSystemToPallet(
        system_id,
        factory_id,
        dpn_id,
        client
      );

      await client.query("COMMIT");

      return res.json({
        message: `System ${service_tag} added to pallet ${pallet_number}`,
        pallet_id,
        pallet_number,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ error: "Failed to add system to pallet" });
    } finally {
      client.release();
    }
  }
);

// DELETE /api/v1/systems/:service_tag
router.delete(
  "/:service_tag",
  authenticateToken,
  ensureAdmin,
  async (req, res) => {
    const { service_tag } = req.params;

    const result = await db.query(
      "DELETE FROM system WHERE service_tag = $1 RETURNING service_tag",
      [service_tag]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "System not found" });
    }

    res.json({ message: "System deleted" });
  }
);

router.get("/:service_tag/pallet", async (req, res) => {
  const { service_tag } = req.params;

  const systemRes = await db.query(
    `SELECT id FROM system WHERE service_tag = $1`,
    [service_tag]
  );

  if (systemRes.rows.length === 0) {
    return res.status(404).json({ message: "System not found." });
  }

  const systemId = systemRes.rows[0].id;

  const result = await db.query(
    `
    SELECT
      p.id AS pallet_id,
      p.pallet_number,
      d.name AS dpn,      
      p.status,
      p.created_at,
      f.name AS factory,
      f.code AS factory_code,
      ps.added_at
    FROM pallet_system ps
    JOIN pallet p ON ps.pallet_id = p.id
    JOIN factory f ON p.factory_id = f.id
    LEFT JOIN dpn d ON p.dpn_id = d.id
    WHERE ps.system_id = $1
      AND ps.removed_at IS NULL
      AND p.status = 'open'
    ORDER BY ps.added_at DESC
    LIMIT 1;
    `,
    [systemId]
  );

  if (result.rows.length === 0) {
    return res
      .status(404)
      .json({ message: "System is not on an active pallet." });
  }

  res.json(result.rows[0]);
});

router.get("/:service_tag/pallet-history", async (req, res) => {
  const { service_tag } = req.params;

  const systemRes = await db.query(
    `SELECT id FROM system WHERE service_tag = $1`,
    [service_tag]
  );

  if (systemRes.rows.length === 0) {
    return res.status(404).json({ message: "System not found." });
  }

  const systemId = systemRes.rows[0].id;

  const result = await db.query(
    `
    SELECT
      ps.id AS assignment_id,
      p.id AS pallet_id,
      p.pallet_number,
      d.name AS dpn,
      f.name AS factory,
      f.code AS factory_code,
      p.status AS pallet_status,
      ps.added_at,
      ps.removed_at
    FROM pallet_system ps
    JOIN pallet p ON ps.pallet_id = p.id
    JOIN factory f ON p.factory_id = f.id
    LEFT JOIN dpn d ON p.dpn_id = d.id
    WHERE ps.system_id = $1
    ORDER BY ps.added_at ASC;
    `,
    [systemId]
  );

  res.json(result.rows);
});

module.exports = router;
