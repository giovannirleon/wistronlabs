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

module.exports = { ensureAdmin };
