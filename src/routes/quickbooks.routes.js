const express = require("express");
const router = express.Router();

const qbAuthController = require("../controllers/qbAuth.controller");
const qbWebhookController = require("../controllers/qbWebhook.controller");
const estimateController = require("../controllers/estimate.controller");
const checkOverdueInvoices = require("../jobs/overdueInvoice.job");

router.get("/", qbAuthController.connectQuickBooks);
router.get("/callback", qbAuthController.quickBooksCallback);
router.get("/test-invoices", qbAuthController.testInvoices);
router.get("/query-estimate", qbAuthController.queryEstimate);
router.get("/query-sub-estimates", qbAuthController.querySubEstimates);
router.get("/query-invoices-for-customer", qbAuthController.queryInvoicesForCustomer);
router.get("/query-creditmemo", qbAuthController.queryCreditMemo);
router.get("/query-payment", qbAuthController.queryPayment);

router.post("/estimate-mapping", estimateController.saveEstimateMapping);

router.get("/test-overdue", async (req, res) => {
  try {
    await checkOverdueInvoices();
    res.json({ success: true, message: "Overdue check complete — see server logs." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


router.post("/trigger-payment/:realmId/:paymentId", async (req, res) => {
  try {
    const { handlePayment } = require("../services/quickbooks/qbWebhook.service");
    await handlePayment({ realmId: req.params.realmId, id: req.params.paymentId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.response?.data ?? err.message });
  }
});

// ✅ webhook
router.post("/webhook", qbWebhookController.quickBooksWebhook);

module.exports = router;