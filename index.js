const express = require("express");
const cron = require("node-cron");
require("dotenv").config();

const REQUIRED_ENV = ["HUBSPOT_TOKEN", "HUBSPOT_CLIENT_SECRET", "CLIENT_ID", "CLIENT_SECRET", "REDIRECT_URI", "QB_WEBHOOK_VERIFIER", "MONGO_URI"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error("Missing required environment variables:", missingEnv.join(", "));
  process.exit(1);
}

const connectDB = require("./src/config/db");
const checkOverdueInvoices = require("./src/jobs/overdueInvoice.job");

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

// Runs every day at 7 AM Pacific Time (PST/PDT handled automatically)
cron.schedule("0 7 * * *", () => {
  checkOverdueInvoices().catch((err) =>
    console.error("Overdue invoice job failed:", err.message)
  );
}, { timezone: "America/Los_Angeles" });