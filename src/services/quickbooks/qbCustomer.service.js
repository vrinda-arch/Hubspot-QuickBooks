const { quickBooksRequest } = require("./qbClient.service");

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

exports.syncCustomerFieldsToQb = async ({ realmId, qbCustomerId, customerType, taxExemption }) => {
  if (!customerType && !taxExemption) {
    console.log(`No customer fields to sync for QB customer ${qbCustomerId}, skipping.`);
    return;
  }

  const fetchRes = await quickBooksRequest({ realmId, endpoint: `/customer/${qbCustomerId}` });
  const customer = fetchRes.Customer;
  if (!customer) {
    console.log(`QB customer ${qbCustomerId} not found, skipping sync.`);
    return;
  }

  const updatePayload = {
    Id: customer.Id,
    SyncToken: customer.SyncToken,
    sparse: true,
  };

  if (customerType) {
    const typeId = QB_CUSTOMER_TYPE_MAP[customerType.toLowerCase()];
    if (typeId) {
      updatePayload.CustomerTypeRef = { value: typeId };
      console.log(`Setting QB CustomerType to "${customerType}" (${typeId})`);
    } else {
      console.log(`Unknown customer type "${customerType}", skipping CustomerTypeRef.`);
    }
  }

  if (taxExemption) {
    const existingNotes = customer.Notes || "";
    const taxNote = `Tax Exemption: ${taxExemption}`;
    updatePayload.Notes = existingNotes
      ? existingNotes.replace(/Tax Exemption:.*$/m, taxNote)
      : taxNote;
    console.log(`Setting QB Customer Notes with tax exemption: "${taxExemption}"`);
  }

  await quickBooksRequest({ realmId, endpoint: `/customer`, method: "POST", data: updatePayload });

  console.log(`QB customer ${qbCustomerId} fields synced successfully.`);
};
