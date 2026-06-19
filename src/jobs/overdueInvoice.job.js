const Mapping = require("../models/Mapping");
const { quickBooksRequest } = require("../services/quickbooks/qbClient.service");
const { updateDeal } = require("../services/hubspot/hubspot.service");
const { updateHubSpotInvoiceBalance } = require("../services/hubspot/hubspotInvoice.service");

module.exports = async function checkOverdueInvoices() {
  console.log("Running overdue invoice check...");

  const mappings = await Mapping.find({
    finalPaymentStatus: { $ne: "PAID" },
    qbInvoiceId: { $exists: true, $nin: [null, "pending"] },
  });

  console.log(`Checking ${mappings.length} unpaid invoice(s) for overdue status.`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const mapping of mappings) {
    try {
      const invoiceRes = await quickBooksRequest({
        realmId: mapping.realmId,
        endpoint: `/invoice/${mapping.qbInvoiceId}`,
      });

      const invoice = invoiceRes.Invoice;
      const dueDate = invoice.DueDate ? new Date(invoice.DueDate) : null;
      const balance = invoice.Balance ?? 0;

      if (dueDate && dueDate < today && balance > 0) {
        await updateDeal(mapping.hubspotDealId, { final_payment_status: "Overdue" });
        if (mapping.hubspotInvoiceId) {
          await updateHubSpotInvoiceBalance(mapping.hubspotInvoiceId, balance, "Overdue");
        }
        console.log(`Invoice ${mapping.qbInvoiceId} overdue — deal ${mapping.hubspotDealId} updated.`);
      }
    } catch (err) {
      console.error(`Overdue check failed for invoice ${mapping.qbInvoiceId}:`, err.message);
    }
  }

  console.log("Overdue invoice check complete.");
};
