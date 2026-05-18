const crypto = require("crypto");
const { handleDealStageChange, handleDealCreation } = require("../services/hubspot/hubspotWebhook.service");

exports.hubspotWebhook = async (req, res) => {
  try {
    console.log("HubSpot webhook received, headers:", {
      sig: req.headers["x-hubspot-signature"],
      sigVersion: req.headers["x-hubspot-signature-version"],
    });

    const sig = req.headers["x-hubspot-signature"];
    const rawBody = req.body.toString();

    const hash = crypto
      .createHash("sha256")
      .update(process.env.HUBSPOT_CLIENT_SECRET + rawBody)
      .digest("hex");

    console.log("Signature check:", { received: sig, computed: hash, match: sig === hash });

    if (!sig || sig !== hash) {
      console.error("HubSpot signature mismatch — returning 401");
      return res.status(401).send("Invalid signature");
    }

    const events = JSON.parse(rawBody);

    for (const event of events) {
      const dealId = String(event.objectId);

      if (event.subscriptionType === "deal.creation") {
        await handleDealCreation({ dealId });
      }

      if (event.subscriptionType === "deal.propertyChange" && event.propertyName === "dealstage") {
        await handleDealStageChange({ dealId, dealStage: event.propertyValue });
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
};