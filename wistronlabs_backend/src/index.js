const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: ["http://localhost:5174", "http://tss.wistronlabs.com"],
  })
);

const systemsRouter = require("./routes/systems");
const locationsRouter = require("./routes/locations");

app.use("/api/v1/systems", systemsRouter);
app.use("/api/v1/locations", locationsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
