const express = require("express");
const router = express.Router();

// API route for local server time
router.get("/time", (req, res) => {
  const now = new Date();

  const response = {
    localTime: now.toLocaleString(),
    isoTime: now.toISOString(),
    timestamp: now.getTime(),
  };

  res.json(response);
});

module.exports = router;
