const axios = require("axios");
const { getValidAccessToken } = require("./qbToken.service");

// Maps both label and direct QB ID (HubSpot dropdown values may be QB IDs directly)
const QB_CUSTOMER_TYPE_MAP = {
  residential: "793152",
  commercial:  "793153",
  contract:    "793154",
  municipal:   "793155",
  "793152":    "793152",
  "793153":    "793153",
  "793154":    "793154",
  "793155":    "793155",
};


const getQbBase = (environment) =>
  environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";

exports.syncCustomerFieldsToQb = async ({ realmId, qbCustomerId, customerType, taxExemption }) => {
  if (!customerType && !taxExemption) {
    console.log(`No customer fields to sync for QB customer ${qbCustomerId}, skipping.`);
    return;
  }

  const { accessToken, environment } = await getValidAccessToken(realmId);
  const base = getQbBase(environment);

  // Fetch current customer to get SyncToken (required for sparse updates)
  const fetchRes = await axios.get(
    `${base}/v3/company/${realmId}/customer/${qbCustomerId}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }
  );
  const customer = fetchRes.data.Customer;

  const updatePayload = {
    Id: customer.Id,
    SyncToken: customer.SyncToken,
    sparse: true,
  };

  // Customer Type
  if (customerType) {
    const typeId = QB_CUSTOMER_TYPE_MAP[customerType.toLowerCase()];
    if (typeId) {
      updatePayload.CustomerTypeRef = { value: typeId };
      console.log(`Setting QB CustomerType to "${customerType}" (${typeId})`);
    } else {
      console.log(`Unknown customer type "${customerType}", skipping CustomerTypeRef.`);
    }
  }

  // Tax Exemption — stored in Notes since QBO doesn't support customer-level custom fields via API
  if (taxExemption) {
    const existingNotes = customer.Notes || "";
    const taxNote = `Tax Exemption: ${taxExemption}`;
    updatePayload.Notes = existingNotes
      ? existingNotes.replace(/Tax Exemption:.*$/m, taxNote)
      : taxNote;
    console.log(`Setting QB Customer Notes with tax exemption: "${taxExemption}"`);
  }

  await axios.post(
    `${base}/v3/company/${realmId}/customer`,
    updatePayload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );

  console.log(`QB customer ${qbCustomerId} fields synced successfully.`);
};
