const Mapping = require("../../models/Mapping");
const QuickBooksConnection = require("../../models/QuickBooksConnection");
const { quickBooksRequest, getInvoicePdfLink } = require("./qbClient.service");
const { updateDeal } = require("../hubspot/hubspot.service");
const { createHubSpotInvoice, updateHubSpotInvoiceStatus } = require("../hubspot/hubspotInvoice.service");

exports.handleInvoice = async ({ realmId, id }) => {
  const invoiceRes = await quickBooksRequest({ realmId, endpoint: `/invoice/${id}` });
  const invoice = invoiceRes.Invoice;
  const estimateId = invoice.LinkedTxn?.[0]?.TxnId;

  const mapping = await Mapping.findOne({ qbEstimateId: estimateId });
  if (!mapping) return;

  if (mapping.hubspotInvoiceId) {
    console.log(`HubSpot invoice already exists for QB invoice ${id}, skipping.`);
    return;
  }

  const qb = await QuickBooksConnection.findOne({ realmId, isActive: true });
  const invoiceLink = invoice.InvoiceLink
    || getInvoicePdfLink({ realmId, invoiceId: id, environment: qb?.environment });

  const invoiceLines = (invoice.Line || [])
    .filter((l) => l.DetailType === "SalesItemLineDetail")
    .map(({ Id, ...l }) => l);

  const { hubspotInvoiceId } = await createHubSpotInvoice({
    dealId: mapping.hubspotDealId,
    qbInvoiceId: id,
    pdfLink: invoiceLink,
    lines: invoiceLines,
  });

  mapping.qbInvoiceId = id;
  mapping.hubspotInvoiceId = hubspotInvoiceId;
  mapping.finalInvoiceLink = invoiceLink;
  await mapping.save();
};

exports.handlePayment = async ({ realmId, id }) => {
  const paymentRes = await quickBooksRequest({ realmId, endpoint: `/payment/${id}` });
  const payment = paymentRes.Payment;
  const linkedTxn = payment.Line?.[0]?.LinkedTxn?.[0];
  if (!linkedTxn) return;

  const { TxnId: txnId, TxnType: txnType } = linkedTxn;

  if (txnType === "Estimate") {
    const mapping = await Mapping.findOne({ qbEstimateId: txnId });
    if (!mapping) return;
    mapping.advancePaymentStatus = "PAID";
    await mapping.save();
    await updateDeal(mapping.hubspotDealId, { advance_payment_status: "Paid" });
  }

  if (txnType === "Invoice") {
    const mapping = await Mapping.findOne({ qbInvoiceId: txnId });
    if (!mapping) return;

    const invoiceRes = await quickBooksRequest({ realmId, endpoint: `/invoice/${txnId}` });
    const invoiceBalance = invoiceRes.Invoice?.Balance ?? 0;

    if (invoiceBalance === 0) {
      mapping.finalPaymentStatus = "PAID";
      await mapping.save();
      await updateDeal(mapping.hubspotDealId, { final_payment_status: "Paid", balance_due: "$0" });
      if (mapping.hubspotInvoiceId) {
        await updateHubSpotInvoiceStatus(mapping.hubspotInvoiceId, "paid");
      }
    } else {
      await updateDeal(mapping.hubspotDealId, {
        final_payment_status: "Partial",
        balance_due: `$${invoiceBalance}`,
      });
    }
  }
};

exports.handleCreditMemo = async ({ realmId, id }) => {
  const creditMemoRes = await quickBooksRequest({ realmId, endpoint: `/creditmemo/${id}` });
  const creditMemo = creditMemoRes.CreditMemo;
  const qbCustomerId = creditMemo.CustomerRef?.value;
  if (!qbCustomerId) return;

  const mapping = await Mapping.findOne({
    qbCustomerId,
    qbInvoiceId: { $exists: true, $nin: [null, "pending"] },
  });

  if (!mapping) {
    console.log(`No active invoice mapping found for QB customer ${qbCustomerId}, skipping credit memo ${id}.`);
    return;
  }

  const invoiceRes = await quickBooksRequest({ realmId, endpoint: `/invoice/${mapping.qbInvoiceId}` });
  const invoiceBalance = invoiceRes.Invoice?.Balance ?? 0;

  await updateDeal(mapping.hubspotDealId, {
    credit_memo_number: creditMemo.DocNumber,
    credit_memo_date: creditMemo.TxnDate,
    credit_memo_amount: `$${creditMemo.TotalAmt}`,
    balance_due: `$${invoiceBalance}`,
  });

  console.log(`Credit memo ${id} synced to HubSpot deal ${mapping.hubspotDealId}`);
};
