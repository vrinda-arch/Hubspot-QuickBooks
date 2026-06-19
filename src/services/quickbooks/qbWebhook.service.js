const axios = require("axios");
const Mapping = require("../../models/Mapping");
const QuickBooksConnection = require("../../models/QuickBooksConnection");
const { quickBooksRequest, getInvoicePdfLink } = require("./qbClient.service");
const { updateDeal, getHubSpotDealOwnerName, getHubSpotCompanyForDeal, HUBSPOT_BASE, hsHeaders, hsRequest } = require("../hubspot/hubspot.service");
const { createHubSpotInvoice, updateHubSpotInvoiceStatus, updateHubSpotInvoiceBalance, attachInvoicePdfToDeal } = require("../hubspot/hubspotInvoice.service");
const { syncCustomerFieldsToQb } = require("./qbCustomer.service");
const { DEAL_STAGES } = require("../../config/constants");

const findHubSpotDealByProposalId = async (proposalId) => {
  const res = await hsRequest(
    () => axios.post(
      `${HUBSPOT_BASE}/crm/v3/objects/deals/search`,
      {
        filterGroups: [{ filters: [{ propertyName: "dealname", operator: "CONTAINS_TOKEN", value: proposalId }] }],
        properties: ["dealname"],
        limit: 5,
      },
      { headers: hsHeaders() }
    ),
    `searchDealByProposal ${proposalId}`
  );
  const deals = res.data?.results ?? [];
  const match = deals.find((d) => new RegExp(`#${proposalId}\\b`).test(d.properties?.dealname ?? ""));
  return match?.id ?? null;
};

exports.handleEstimate = async ({ realmId, id }) => {
  console.log(`handleEstimate called: estimate ${id}, realmId ${realmId}`);
  const estRes = await quickBooksRequest({ realmId, endpoint: `/estimate/${id}` });
  const estimate = estRes.Estimate;
  const docNumber = estimate?.DocNumber;
  if (!docNumber) {
    console.log(`Estimate ${id} has no DocNumber, skipping.`);
    return;
  }

  // Skip PHC sub-estimates (trailing letter suffix) — handled by lazy-mapping in handleInvoice
  const baseProposalId = docNumber.replace(/[A-Za-z]+$/, "");
  if (baseProposalId !== docNumber) {
    console.log(`Estimate ${id} (${docNumber}) is a PHC sub-estimate, skipping.`);
    return;
  }

  // Skip if mapping already exists
  const existing = await Mapping.findOne({ qbEstimateId: id });
  if (existing) {
    console.log(`Mapping already exists for estimate ${id} (${docNumber}), skipping.`);
    return;
  }

  // Find the HubSpot deal with this proposal number
  const hubspotDealId = await findHubSpotDealByProposalId(docNumber);
  if (!hubspotDealId) {
    console.log(`No HubSpot deal found for proposal ${docNumber}, skipping.`);
    return;
  }

  const qbCustomerId = estimate.CustomerRef?.value;
  await Mapping.create({ proposalId: docNumber, hubspotDealId, qbEstimateId: id, qbDocNumber: docNumber, realmId, qbCustomerId });
  console.log(`Mapping created via QB estimate webhook: ${docNumber} → deal ${hubspotDealId}`);

  // Fire-and-forget: sync customer fields from HS company → QB customer
  if (qbCustomerId) {
    getHubSpotCompanyForDeal(hubspotDealId)
      .then((company) => {
        if (!company) return;
        return syncCustomerFieldsToQb({ realmId, qbCustomerId, customerType: company.customer_type, taxExemption: company.tax_exemption });
      })
      .catch((err) => console.error("syncCustomerFieldsToQb failed:", err.message));
  }

  // Fire-and-forget: PM name → QB estimate PrivateNote
  getHubSpotDealOwnerName(hubspotDealId)
    .then(async (pmName) => {
      if (!pmName) return;
      await quickBooksRequest({ realmId, endpoint: `/estimate`, method: "POST", data: { Id: id, SyncToken: estimate.SyncToken, sparse: true, PrivateNote: `PM: ${pmName}` } });
      console.log(`QB estimate ${docNumber} PrivateNote updated with PM: ${pmName}`);
    })
    .catch((err) => console.error("PM sync to QB estimate failed:", err.message));
};

const getAggregateDealBalance = async ({ realmId, hubspotDealId, currentInvoiceId, currentBalance }) => {
  const allMappings = await Mapping.find({
    hubspotDealId,
    qbInvoiceId: { $exists: true, $nin: [null, "pending", "pending_hs"] },
  });
  if (allMappings.length <= 1) return currentBalance;

  let total = 0;
  for (const m of allMappings) {
    if (m.qbInvoiceId === currentInvoiceId) {
      total += currentBalance;
    } else {
      try {
        const invRes = await quickBooksRequest({ realmId, endpoint: `/invoice/${m.qbInvoiceId}` });
        total += invRes.Invoice?.Balance ?? 0;
      } catch (err) {
        console.error(`getAggregateDealBalance: failed to fetch invoice ${m.qbInvoiceId}:`, err.message);
      }
    }
  }
  console.log(`Aggregate balance for deal ${hubspotDealId}: $${total} (${allMappings.length} invoices)`);
  return total;
};

exports.handleInvoice = async ({ realmId, id }) => {
  console.log(`handleInvoice called: invoice ${id}, realmId ${realmId}`);
  const invoiceRes = await quickBooksRequest({ realmId, endpoint: `/invoice/${id}` });
  const invoice = invoiceRes.Invoice;
  const estimateId = invoice.LinkedTxn?.[0]?.TxnId;
  const qbCustomerId = invoice.CustomerRef?.value;
  console.log(`Invoice ${id} — estimateId: ${estimateId}, customerId: ${qbCustomerId}`);

  let mapping;
  if (estimateId) {
    mapping = await Mapping.findOne({ qbEstimateId: estimateId });

    // Lazy-mapping for PHC sub-estimates: if no mapping found, strip trailing letter(s)
    // from the sub-estimate DocNumber (e.g. "1339359A" → "1339359") and find base mapping
    if (!mapping) {
      const estRes = await quickBooksRequest({ realmId, endpoint: `/estimate/${estimateId}` });
      const subDocNumber = estRes.Estimate?.DocNumber;
      const baseProposalId = subDocNumber?.replace(/[A-Za-z]+$/, "");
      if (baseProposalId && baseProposalId !== subDocNumber) {
        const baseMapping = await Mapping.findOne({ proposalId: baseProposalId });
        if (baseMapping) {
          mapping = await Mapping.create({
            proposalId: baseProposalId,
            hubspotDealId: baseMapping.hubspotDealId,
            qbEstimateId: estimateId,
            qbDocNumber: subDocNumber,
            realmId: baseMapping.realmId,
            qbCustomerId: estRes.Estimate?.CustomerRef?.value ?? baseMapping.qbCustomerId,
          });
          console.log(`Lazy-mapped PHC sub-estimate ${subDocNumber} → deal ${baseMapping.hubspotDealId}`);
        }
      }
    }
  } else if (qbCustomerId) {
    mapping = await Mapping.findOne({ qbCustomerId }).sort({ createdAt: -1 });
  }
  if (!mapping) {
    console.log(`No mapping found for invoice ${id} — skipping.`);
    return;
  }

  // Atomic claim — prevents duplicate HS invoice creation from simultaneous QB webhooks
  const claimed = await Mapping.findOneAndUpdate(
    { _id: mapping._id, qbInvoiceId: { $nin: [id, "pending", "pending_hs"] } },
    { $set: { qbInvoiceId: id } },
    { returnDocument: "before" }
  );
  if (!claimed) {
    console.log(`QB invoice ${id} already handled or being processed, skipping.`);
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
    totalAmt: invoice.TotalAmt ?? 0,
    docNumber: invoice.DocNumber ?? null,
    txnDate: invoice.TxnDate ?? null,
    dueDate: invoice.DueDate ?? null,
  });

  mapping.qbInvoiceId = id;
  mapping.hubspotInvoiceId = hubspotInvoiceId;
  mapping.finalInvoiceLink = invoiceLink;
  await mapping.save();

  const currentBalance = invoice.Balance ?? invoice.TotalAmt ?? 0;
  const balanceDue = await getAggregateDealBalance({ realmId, hubspotDealId: mapping.hubspotDealId, currentInvoiceId: id, currentBalance });

  await updateDeal(mapping.hubspotDealId, {
    dealstage: DEAL_STAGES.BILLED,
    final_invoice_link: invoiceLink,
    balance_due: `$${balanceDue}`,
  });

  // Fire-and-forget: download QB invoice PDF and attach to deal as a note in HubSpot
  attachInvoicePdfToDeal({ realmId, invoiceId: id, dealId: mapping.hubspotDealId })
    .catch((err) => console.error(`attachInvoicePdfToDeal failed for invoice ${id}:`, err.message));
};

exports.handlePayment = async ({ realmId, id }) => {
  console.log(`handlePayment called: payment ${id}, realmId ${realmId}`);
  const paymentRes = await quickBooksRequest({ realmId, endpoint: `/payment/${id}` });
  const payment = paymentRes.Payment;

  // QB spreads invoice and credit memo across separate lines — find each by TxnType
  const lines = payment.Line ?? [];
  const invoiceLine = lines.find((l) => l.LinkedTxn?.[0]?.TxnType === "Invoice");
  const creditMemoLine = lines.find((l) => l.LinkedTxn?.[0]?.TxnType === "CreditMemo");

  if (!invoiceLine) {
    console.log(`Payment ${id} has no linked invoice, skipping.`);
    return;
  }

  const txnId = invoiceLine.LinkedTxn[0].TxnId;
  const creditMemoId = creditMemoLine?.LinkedTxn?.[0]?.TxnId ?? null;
  console.log(`Payment ${id} → invoice ${txnId}${creditMemoId ? `, credit memo ${creditMemoId}` : ""}`);

  const mapping = await Mapping.findOne({ qbInvoiceId: txnId });
  if (!mapping) {
    console.log(`No mapping found for invoice ${txnId}, skipping payment ${id}.`);
    return;
  }

  const invoiceRes = await quickBooksRequest({ realmId, endpoint: `/invoice/${txnId}` });
  const invoiceBalance = invoiceRes.Invoice?.Balance ?? 0;

  const aggregateBalance = await getAggregateDealBalance({ realmId, hubspotDealId: mapping.hubspotDealId, currentInvoiceId: txnId, currentBalance: invoiceBalance });

  // If this payment is a credit memo application, fetch and attach credit memo metadata
  const creditMemoUpdate = {};
  if (creditMemoId) {
    const cmRes = await quickBooksRequest({ realmId, endpoint: `/creditmemo/${creditMemoId}` });
    const cm = cmRes.CreditMemo;
    creditMemoUpdate.qb_credit_memo_number = cm.DocNumber;
    creditMemoUpdate.qb_credit_memo_date = cm.TxnDate;
    creditMemoUpdate.qb_credit_memo_amount = `$${cm.TotalAmt}`;
    console.log(`Credit memo ${creditMemoId} metadata attached to deal ${mapping.hubspotDealId}`);
  }

  // Payment date and amount (skip for internal $0 credit memo linking payments)
  const paymentUpdate = {};
  if (payment.TotalAmt > 0) {
    paymentUpdate.amount_paid = `$${payment.TotalAmt}`;
    paymentUpdate.payment_date = new Date(payment.TxnDate).getTime();
  }

  if (aggregateBalance === 0) {
    mapping.finalPaymentStatus = "PAID";
    await mapping.save();
    await updateDeal(mapping.hubspotDealId, {
      ...creditMemoUpdate,
      ...paymentUpdate,
      dealstage: DEAL_STAGES.PAID,
      final_payment_status: "Paid",
      balance_due: "$0",
    });
    if (mapping.hubspotInvoiceId) {
      await updateHubSpotInvoiceStatus(mapping.hubspotInvoiceId, "paid");
      await updateHubSpotInvoiceBalance(mapping.hubspotInvoiceId, invoiceBalance, "Paid");
    }
    console.log(`Payment ${id} fully paid — deal ${mapping.hubspotDealId} moved to Paid.`);
  } else {
    await updateDeal(mapping.hubspotDealId, {
      ...creditMemoUpdate,
      ...paymentUpdate,
      final_payment_status: "Partial",
      balance_due: `$${aggregateBalance}`,
    });
    if (mapping.hubspotInvoiceId) {
      await updateHubSpotInvoiceBalance(mapping.hubspotInvoiceId, invoiceBalance, invoiceBalance === 0 ? "Paid" : "Partially Paid");
    }
    console.log(`Payment ${id} partial — deal ${mapping.hubspotDealId} balance remaining: $${aggregateBalance}.`);
  }
};

exports.handleCreditMemo = async ({ realmId, id }) => {
  // QB credit memos have no LinkedTxn pointing to the invoice they were applied to.
  // When QB applies a credit memo to an invoice it creates an internal Payment
  // ("Created by QB Online to link credits to charges.") whose Line[] contains both
  // the Invoice and CreditMemo references — that Payment webhook is where we set
  // credit memo metadata and update balance_due (see handlePayment).
  console.log(`handleCreditMemo called: credit memo ${id}, realmId ${realmId} — balance/metadata handled via Payment webhook.`);
};
