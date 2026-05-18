const express = require("express");
require("dotenv").config();

const connectDB = require("./src/config/db");

const qbRoutes = require("./src/routes/quickbooks.routes");
const hubspotRoutes = require("./src/routes/hubspot.routes");

const app = express();

connectDB();

/**
 * ✅ QUICKBOOKS WEBHOOK (RAW BODY REQUIRED)
 */
app.use(
  "/webhooks/quickbooks",
  express.raw({ type: "application/json" }),
  qbRoutes
);

/**
 * ✅ HUBSPOT WEBHOOK (RAW BODY REQUIRED FOR SIGNATURE VERIFICATION)
 */
app.use(
  "/hubspot",
  express.raw({ type: "application/json" }),
  hubspotRoutes
);

/**
 * ✅ NORMAL JSON ROUTES
 */
app.use(express.json());

/**
 * ✅ QB AUTH + TEST ROUTES
 */
app.use("/quickbooks", qbRoutes);

/**
 * HEALTH CHECK
 */
app.get("/", (req, res) => {
  res.send("Server running 🚀");
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});