const express = require("express");
const router = express.Router();

// API route for server time and CST/CDT
router.get("/time", (req, res) => {
  const now = new Date();

  // Format explicitly to America/Chicago
  const cstFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const cstTime = cstFormatter.format(now);

  const response = {
    timestamp: now.getTime(), // epoch ms
    isoTime: now.toISOString(), // ISO in UTC
    localtime: cstTime, // human-readable CST/CDT
    zone: "America/Chicago",
  };

  res.json(response);
});

module.exports = router;
