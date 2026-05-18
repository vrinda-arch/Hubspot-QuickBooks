const crypto = require("crypto");
const { handleInvoice, handlePayment, handleCreditMemo } = require("../services/quickbooks/qbWebhook.service");

exports.quickBooksWebhook = async (req, res) => {
  try {
    const sig = req.headers["intuit-signature"];
    const hash = crypto
      .createHmac("sha256", process.env.QB_WEBHOOK_VERIFIER)
      .update(req.body)
      .digest("base64");

    if (!sig || sig !== hash) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString());

    for (const notification of payload.eventNotifications) {
      const realmId = notification.realmId;

      for (const entity of notification.dataChangeEvent.entities) {
        const { id, name } = entity;
        console.log(`QB webhook entity received: ${name} ${id}`);
        try {
          if (name === "Invoice") await handleInvoice({ realmId, id });
          if (name === "Payment") await handlePayment({ realmId, id });
          if (name === "CreditMemo") await handleCreditMemo({ realmId, id });
        } catch (err) {
          console.error(`Error processing QB entity ${name} ${id}:`, err.message);
        }
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
};
