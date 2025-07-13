const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: ["*"], //"https://tss.wistronlabs.com"],
  })
);

const systemsRouter = require("./routes/systems");
const locationsRouter = require("./routes/locations");
const serverRouter = require("./routes/server");
const stationsRouter = require("./routes/stations");

app.use("/api/v1/systems", systemsRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/server", serverRouter);
app.use("/api/v1/stations", stationsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
