const express = require("express");
const router = express.Router();

const qbAuthController = require("../controllers/qbAuth.controller");
const qbWebhookController = require("../controllers/qbWebhook.controller");
const estimateController = require("../controllers/estimate.controller");

router.get("/", qbAuthController.connectQuickBooks);
router.get("/callback", qbAuthController.quickBooksCallback);
router.get("/test-invoices", qbAuthController.testInvoices);
router.get("/query-estimate", qbAuthController.queryEstimate);

router.post("/estimate-mapping", estimateController.saveEstimateMapping);

// ✅ webhook
router.post("/webhook", qbWebhookController.quickBooksWebhook);

module.exports = router;