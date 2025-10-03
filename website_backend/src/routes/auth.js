const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");

const { sendResetEmail } = require("../utils/mailer");

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Always define secrets in env, never hard-code fallback
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not set in environment variables");
}
const { JWT_SECRET, INTERNAL_API_KEY } = process.env;

// Helper
function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" }); //15m usual
}

function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" }); //USUALLY 7 DAYS
}

// 🔷 Register new user
router.post("/register", async (req, res) => {
  let { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  username = username.trim().toLowerCase();

  if (!isValidEmail(username)) {
    return res
      .status(400)
      .json({ error: "Username must be a valid email address" });
  }

  try {
    const existing = await db.query(
      `SELECT id FROM users WHERE username = $1`,
      [username]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const hash = await bcrypt.hash(password, 12);

    await db.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2)`,
      [username, hash]
    );

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// 🔷 Login
router.post("/login", async (req, res) => {
  let { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  username = username.trim().toLowerCase();

  if (!isValidEmail(username)) {
    return res
      .status(400)
      .json({ error: "Username must be a valid email address" });
  }

  try {
    const result = await db.query(
      `SELECT id, username, password_hash FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accessToken = generateAccessToken({
      userId: user.id,
      username: user.username,
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      username: user.username,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true, // ✅ keep true even locally
      secure: true, // 🚫 must be false because localhost is HTTP
      sameSite: "none", // 🚫 must be none for cross-origin cookies"
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token: accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to login" });
  }
});

router.post("/forgot-password", async (req, res) => {
  let { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  username = username.trim().toLowerCase();

  if (!isValidEmail(username)) {
    return res
      .status(400)
      .json({ error: "Username must be a valid email address" });
  }

  try {
    const result = await db.query(`SELECT id FROM users WHERE username = $1`, [
      username,
    ]);

    if (result.rows.length === 0) {
      // Don’t reveal if user exists or not
      return res.json({
        message: "If this account exists, instructions have been sent.",
      });
    }

    const user = result.rows[0];
    const resetToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await sendResetEmail(username, resetLink);

    res.json({
      message: "If this account exists, instructions have been sent.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to initiate password reset" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const newHash = await bcrypt.hash(newPassword, 12);

    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      newHash,
      userId,
    ]);

    res.json({ message: "Password has been reset successfully." });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Invalid or expired reset token" });
  }
});

// 🔷 Change password (protected)
router.post("/change-password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password required" });
  }

  try {
    const result = await db.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(currentPassword, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Current password incorrect" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      newHash,
      req.user.userId,
    ]);

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  const { rows } = await db.query(
    `SELECT username, admin FROM users WHERE id = $1`,
    [req.user.userId]
  );
  if (!rows.length) return res.status(404).json({ error: "User not found" });
  res.json({
    message: "Authenticated",
    user: {
      userId: req.user.userId,
      username: rows[0].username,
      isAdmin: !!rows[0].admin,
    },
  });
});

// GET /auth/users  (admin-only)
// Supports ?page=1&page_size=50&search=gmail.com&is_admin=true
router.get("/users", authenticateToken, requireAdmin, async (req, res) => {
  let { page = 1, page_size = 50, search, is_admin } = req.query;

  page = Math.max(1, parseInt(page, 10) || 1);
  page_size = Math.min(200, Math.max(1, parseInt(page_size, 10) || 50));

  const where = [];
  const params = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`LOWER(username) LIKE $${params.length}`);
  }

  if (is_admin === "true" || is_admin === "false") {
    params.push(is_admin === "true");
    where.push(`admin = $${params.length}`);
  }

  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const limitParam = params.push(page_size);
  const offsetParam = params.push((page - 1) * page_size);

  try {
    const { rows } = await db.query(
      `
      SELECT id, username, admin, created_at
      FROM users
      ${whereSQL}
      ORDER BY created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      params
    );

    // count query uses only the WHERE params (no limit/offset)
    const countParams = params.slice(0, where.length);
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM users ${whereSQL}`,
      countParams
    );

    res.json({
      page,
      page_size,
      total: countRows[0].count,
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        isAdmin: !!u.admin,
        createdAt: u.created_at,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// middleware: DB-backed admin check (fresh every request)
async function requireAdmin(req, res, next) {
  try {
    const { rows } = await db.query("SELECT admin FROM users WHERE id = $1", [
      req.user.userId,
    ]);
    if (!rows.length || !rows[0].admin) {
      return res.status(403).json({ error: "Admin required" });
    }
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to check admin" });
  }
}

// 🔷 Middleware: Authenticate JWT or internal API key
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  // Check for internal key first
  if (token === INTERNAL_API_KEY) {
    req.user = { userId: -1, username: "internal_script" };
    return next();
  }

  // Otherwise, verify as JWT
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = decoded;
    next();
  });
}

// PATCH /auth/users/:username/admin { admin: boolean }
router.patch(
  "/users/:username/admin",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    const targetUsername = (req.params.username || "").trim().toLowerCase();
    const { admin } = req.body;

    if (!targetUsername)
      return res.status(400).json({ error: "Invalid username" });
    if (typeof admin !== "boolean")
      return res.status(400).json({ error: "`admin` must be boolean" });

    // Block self de-admin
    if (
      req.user?.username?.toLowerCase() === targetUsername &&
      admin === false
    ) {
      return res
        .status(400)
        .json({ error: "You cannot remove your own admin role" });
    }

    // (Optional) prevent removing last admin, then UPDATE users SET admin=$1 WHERE username=$2 ...
  }
);

router.post("/refresh", (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: "Missing refresh token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err)
      return res
        .status(403)
        .json({ error: "Invalid or expired refresh token" });

    const newAccessToken = generateAccessToken({
      userId: user.userId,
      username: user.username,
    });
    res.json({ token: newAccessToken });
  });
});

router.post("/logout", (req, res) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  });
  res.json({ message: "Logged out successfully" });
});

module.exports = { router, authenticateToken };
