const { quickBooksRequest } = require("./qbClient.service");

// QuickBooks "Customer Type" / "Project Manager" (the custom-fields panel on
// the customer record) are not exposed via the Accounting API in this
// company, so those stay a manual step in QuickBooks. Only Tax Exemption is
// synced here, via the customer Notes field.
exports.syncCustomerFieldsToQb = async ({ realmId, qbCustomerId, taxExemption }) => {
  if (!taxExemption) {
    console.log(`No customer fields to sync for QB customer ${qbCustomerId}, skipping.`);
    return;
  }

  const fetchRes = await quickBooksRequest({ realmId, endpoint: `/customer/${qbCustomerId}` });
  const customer = fetchRes.Customer;
  if (!customer) {
    console.log(`QB customer ${qbCustomerId} not found, skipping sync.`);
    return;
  }

  const existingNotes = customer.Notes || "";
  const taxNote = `Tax Exemption: ${taxExemption}`;
  const updatedNotes = /Tax Exemption:.*$/m.test(existingNotes)
    ? existingNotes.replace(/Tax Exemption:.*$/m, taxNote)
    : existingNotes
      ? `${existingNotes}\n${taxNote}`
      : taxNote;

  const updatePayload = {
    Id: customer.Id,
    SyncToken: customer.SyncToken,
    sparse: true,
    Notes: updatedNotes,
  };
  console.log(`Setting QB Customer Notes with tax exemption: "${taxExemption}"`);

  await quickBooksRequest({ realmId, endpoint: `/customer`, method: "POST", data: updatePayload });

  console.log(`QB customer ${qbCustomerId} fields synced successfully.`);
};
