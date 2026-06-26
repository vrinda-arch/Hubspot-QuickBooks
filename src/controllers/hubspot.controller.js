const crypto = require("crypto");
const Mapping = require("../models/Mapping");
const { getHubSpotCompanyById, getDealsForCompany } = require("../services/hubspot/hubspot.service");
const { syncCustomerFieldsToQb } = require("../services/quickbooks/qbCustomer.service");

// HubSpot company properties that should trigger a QB customer sync.
const SYNC_TRIGGER_PROPS = new Set(["customer_type", "tax_exemption"]);

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

    // Acknowledge fast; HubSpot expects a prompt 200. Process work async.
    res.status(200).send("OK");

    for (const event of events) {
      console.log(`HS event: ${event.subscriptionType}, objectId: ${event.objectId}, property: ${event.propertyName ?? "-"}, value: ${event.propertyValue ?? "-"}`);

      if (event.subscriptionType === "company.propertyChange" && SYNC_TRIGGER_PROPS.has(event.propertyName)) {
        syncCompanyFieldsToQb(event.objectId).catch((err) =>
          console.error(`Company→QB field sync failed for company ${event.objectId}:`, err?.response?.data ?? err.message)
        );
      }
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).send("Error");
  }
};

// When customer_type / tax_exemption changes on a HubSpot company, push the
// values to the QuickBooks customer(s) behind that company's mapped deals.
async function syncCompanyFieldsToQb(companyId) {
  const company = await getHubSpotCompanyById(companyId);
  if (!company || (!company.customer_type && !company.tax_exemption)) {
    console.log(`Company ${companyId} has no customer_type/tax_exemption to sync, skipping.`);
    return;
  }

  const dealIds = await getDealsForCompany(companyId);
  if (!dealIds.length) {
    console.log(`Company ${companyId} changed but has no associated deals; nothing to sync.`);
    return;
  }

  // Resolve distinct QB customers via the deal mappings (a company may have
  // several deals pointing at the same QB customer).
  const synced = new Set();
  for (const dealId of dealIds) {
    const mapping = await Mapping.findOne({ hubspotDealId: String(dealId) });
    if (!mapping?.qbCustomerId) continue;

    const key = `${mapping.realmId}:${mapping.qbCustomerId}`;
    if (synced.has(key)) continue;
    synced.add(key);

    await syncCustomerFieldsToQb({
      realmId: mapping.realmId,
      qbCustomerId: mapping.qbCustomerId,
      customerType: company.customer_type,
      taxExemption: company.tax_exemption,
    });
  }

  if (!synced.size) {
    console.log(`Company ${companyId}: no mapped QB customer found across ${dealIds.length} deal(s), skipping.`);
  }
}
