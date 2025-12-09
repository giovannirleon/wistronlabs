const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();
app.use(express.json());

const cookieParser = require("cookie-parser");
app.use(cookieParser());

app.use(
  cors({
    origin: [
      "http://localhost:5174",
      "http://tss.wistronlabs.com",
      "http://localhost:5173",
      "https://tss.wistronlabs.com",
      "https://frk.wistronlabs.com",
      "http://frk.wistronlabs.com",
    ],
    credentials: true,
  })
);

const systemsRouter = require("./routes/systems");
const locationsRouter = require("./routes/locations");
const serverRouter = require("./routes/server");
const stationsRouter = require("./routes/stations");
const palletRouter = require("./routes/pallets");
const { router: authRouter } = require("./routes/auth");
const partItemsRouter = require("./routes/partItems");
const partsRouter = require("./routes/parts");
const partCategoriesRouter = require("./routes/partCategories");

app.use("/api/v1/systems", systemsRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/server", serverRouter);
app.use("/api/v1/stations", stationsRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/pallets", palletRouter);
app.use("/api/v1/part-items", partItemsRouter);
app.use("/api/v1/parts", partsRouter);
app.use("/api/v1/part-categories", partCategoriesRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
