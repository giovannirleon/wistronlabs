const express = require("express");
const db = require("../db");
const { authenticateToken } = require("./auth");

const router = express.Router();

// GET /api/v1/pallets
router.get("/", async (req, res) => {
  try {
    const pallets = await db.query(
      `
      SELECT p.id, p.pallet_number, p.factory_id, p.dpn, p.status, p.released_at,
            json_agg(json_build_object(
              'system_id', ps.system_id,
              'service_tag', s.service_tag
            )) FILTER (WHERE ps.removed_at IS NULL) AS active_systems
      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      LEFT JOIN system s ON s.id = ps.system_id
      GROUP BY p.id, p.released_at
      ORDER BY p.created_at DESC
      `
    );

    res.json(pallets.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pallets" });
  }
});

// GET /api/v1/pallets/:pallet_number
router.get("/:pallet_number", async (req, res) => {
  const { pallet_number } = req.params;
  try {
    const result = await db.query(
      `
    SELECT p.id, p.pallet_number, p.factory_id, p.dpn, p.status, p.released_at,
          json_agg(json_build_object(
            'system_id', ps.system_id,
            'service_tag', s.service_tag
          )) FILTER (WHERE ps.removed_at IS NULL) AS active_systems
    FROM pallet p
    LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
    LEFT JOIN system s ON s.id = ps.system_id
    WHERE p.pallet_number = $1
    GROUP BY p.id, p.released_at
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

router.patch("/move", authenticateToken, async (req, res) => {
  const { system_id, from_pallet_id, to_pallet_id } = req.body;

  if (!system_id || !from_pallet_id || !to_pallet_id) {
    return res.status(400).json({
      error: "system_id, from_pallet_id, and to_pallet_id are required",
    });
  }

  if (from_pallet_id === to_pallet_id) {
    return res
      .status(400)
      .json({ error: "Source and destination pallets must be different" });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Get both pallets
    const { rows: pallets } = await client.query(
      `
      SELECT id, status, factory_id, dpn
      FROM pallet
      WHERE id = ANY($1::int[])
      `,
      [[from_pallet_id, to_pallet_id]]
    );

    if (pallets.length !== 2) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "One or both pallets not found" });
    }

    const fromPallet = pallets.find((p) => p.id == from_pallet_id);
    const toPallet = pallets.find((p) => p.id == to_pallet_id);

    // 2. Ensure both pallets are open
    if (fromPallet.status !== "open" || toPallet.status !== "open") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Cannot move from/to a released pallet" });
    }

    // 3. Same factory_id and dpn
    if (
      fromPallet.factory_id !== toPallet.factory_id ||
      fromPallet.dpn !== toPallet.dpn
    ) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Pallets must have the same factory_id and DPN" });
    }

    // 4. Confirm system is currently in from_pallet
    const { rowCount: inPallet } = await client.query(
      `
      SELECT 1
      FROM pallet_system
      WHERE pallet_id = $1 AND system_id = $2 AND removed_at IS NULL
      `,
      [from_pallet_id, system_id]
    );

    if (inPallet === 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "System is not in the source pallet" });
    }

    // 5. Confirm system's location is RMA
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
      return res.status(404).json({ error: "System not found" });
    }

    const locationName = locationRows[0].location_name;
    if (!locationName.startsWith("RMA")) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "System is not in an RMA location" });
    }

    // 6. Mark removed from source pallet
    await client.query(
      `
      UPDATE pallet_system
      SET removed_at = NOW()
      WHERE pallet_id = $1 AND system_id = $2 AND removed_at IS NULL
      `,
      [from_pallet_id, system_id]
    );

    // 7. Add to destination pallet
    await client.query(
      `
      INSERT INTO pallet_system (pallet_id, system_id)
      VALUES ($1, $2)
      `,
      [to_pallet_id, system_id]
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

// PATCH /api/v1/pallets/:id/release
router.patch("/:id/release", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { doa_number } = req.body;

  if (!doa_number) {
    return res
      .status(400)
      .json({ error: "doa_number is required to release a pallet" });
  }

  try {
    // Check current pallet status and count active systems
    const { rows } = await db.query(
      `
      SELECT p.status,
             COUNT(ps.id) FILTER (WHERE ps.removed_at IS NULL) AS active_count
      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      WHERE p.id = $1
      GROUP BY p.status
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pallet not found" });
    }

    const { status, active_count } = rows[0];

    if (status !== "open") {
      return res.status(400).json({ error: "Pallet is already released" });
    }

    if (parseInt(active_count, 10) === 0) {
      return res.status(400).json({ error: "Cannot release an empty pallet" });
    }

    // Update pallet to released
    await db.query(
      `
      UPDATE pallet
      SET status = 'released',
          doa_number = $1,
          released_at = NOW()
      WHERE id = $2
      `,
      [doa_number, id]
    );

    res.json({ message: "Pallet released successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to release pallet" });
  }
});

// DELETE /api/v1/pallets/:id
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Check pallet status and count of active systems
    const { rows } = await db.query(
      `
      SELECT p.status,
             COUNT(ps.id) FILTER (WHERE ps.removed_at IS NULL) AS active_count
      FROM pallet p
      LEFT JOIN pallet_system ps ON p.id = ps.pallet_id
      WHERE p.id = $1
      GROUP BY p.status
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pallet not found" });
    }

    const { status, active_count } = rows[0];

    // Must be open
    if (status !== "open") {
      return res.status(400).json({ error: "Cannot delete a released pallet" });
    }

    // Must have no active systems
    if (parseInt(active_count, 10) > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a pallet with active systems" });
    }

    // Safe to delete
    await db.query("DELETE FROM pallet WHERE id = $1", [id]);

    res.json({ message: "Pallet deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete pallet" });
  }
});

module.exports = router;
