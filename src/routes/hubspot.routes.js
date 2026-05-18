const express = require("express");
const router = express.Router();

const hubspotController = require("../controllers/hubspot.controller");

router.post("/webhook",hubspotController .hubspotWebhook);

module.exports = router;