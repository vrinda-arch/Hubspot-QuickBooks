const axios = require("axios");
const Mapping = require("../../models/Mapping");
const QuickBooksConnection = require("../../models/QuickBooksConnection");
const { quickBooksRequest, getInvoicePdfLink } = require("../quickbooks/qbClient.service");
const { updateDeal, getHubSpotDealOwnerName, HUBSPOT_BASE, hsHeaders } = require("./hubspot.service");
const { createHubSpotInvoice, attachInvoicePdfToDeal, attachEstimatePdfToDeal } = require("./hubspotInvoice.service");
const { DEAL_STAGES } = require("../../config/constants");

exports.handleDealCreation = async ({ dealId }) => {
  console.log("Deal creation received:", dealId);

  // 1. Fetch deal name from HubSpot
  const dealRes = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}?properties=dealname`,
    { headers: hsHeaders() }
  );
  const dealName = dealRes.data.properties?.dealname || "";
  console.log("Deal name:", dealName);

  // 2. Extract proposal number (e.g. "Proposal #1306233")
  const match = dealName.match(/#(\d+)/);
  if (!match) {
    console.log("No proposal number found in deal name, skipping mapping.");
    return;
  }
  const proposalNumber = match[1];
  console.log("Extracted proposal number:", proposalNumber);

  // 3. Get active QB connection
  const qb = await QuickBooksConnection.findOne({ isActive: true });
  if (!qb) { console.log("No active QB connection"); return; }

  // 4. Query QB for matching estimate by DocNumber
  const data = await quickBooksRequest({
    realmId: qb.realmId,
    endpoint: "/query",
    params: { query: `SELECT * FROM Estimate WHERE DocNumber = '${proposalNumber}'` },
  });

  const estimate = data.QueryResponse?.Estimate?.[0];
  if (!estimate) {
    console.log("No QB estimate found for proposal number:", proposalNumber);
    return;
  }
  console.log("QB estimate found:", { id: estimate.Id, docNumber: estimate.DocNumber });

  // 5. Save mapping
  await Mapping.findOneAndUpdate(
    { proposalId: proposalNumber },
    {
      proposalId: proposalNumber,
      hubspotDealId: dealId,
      qbEstimateId: estimate.Id,
      qbDocNumber: estimate.DocNumber,
      realmId: qb.realmId,
    },
    { upsert: true, new: true }
  );

  console.log(`Mapping auto-created for deal ${dealId} ↔ estimate ${estimate.Id}`);
};

exports.handleDealStageChange = async ({ dealId, dealStage }) => {
  console.log("Deal stage change received:", { dealId, dealStage });
  // ============================
  // ESTIMATE SENT → push advance payment link to HubSpot
  // ============================
  if (dealStage === DEAL_STAGES.CONTRACT_SENT) {
    const mapping = await Mapping.findOne({ hubspotDealId: dealId });
    console.log("contractsent mapping:", mapping ? { id: mapping._id, advancePaymentLink: mapping.advancePaymentLink } : "NOT FOUND");
    if (!mapping) { console.log("No mapping found for deal", dealId); return; }
    if (!mapping.advancePaymentLink) { console.log("Mapping has no advancePaymentLink for deal", dealId); return; }

    await updateDeal(dealId, {
      advance_payment_link: mapping.advancePaymentLink,
      advance_payment_status: "Pending",
    });
    console.log("Advance payment link pushed to HubSpot deal", dealId);
    return;
  }

  // ============================
  // ESTIMATE LINK REQUESTED → sync estimate PDF to deal, move to Estimate Delivered
  // ============================
  if (dealStage === DEAL_STAGES.ESTIMATE_LINK_REQUESTED) {
    const mapping = await Mapping.findOne({ hubspotDealId: dealId });
    if (!mapping) { console.log("No mapping found for deal", dealId); return; }
    if (!mapping.qbEstimateId || !mapping.realmId) { console.log("Mapping missing estimateId or realmId for deal", dealId); return; }

    console.log("Syncing estimate PDF for deal", dealId);
    await attachEstimatePdfToDeal({ realmId: mapping.realmId, estimateId: mapping.qbEstimateId, dealId });

    await updateDeal(dealId, { dealstage: DEAL_STAGES.ESTIMATE_DELIVERED });
    console.log("Deal moved to Estimate Delivered for deal", dealId);
    return;
  }

  // ============================
  // COMPLETED - READY TO BILL → create QB invoice
  // ============================
  if (dealStage !== DEAL_STAGES.READY_TO_BILL) return;

  // Atomic claim — only one concurrent request can proceed
  const mapping = await Mapping.findOneAndUpdate(
    { hubspotDealId: dealId, qbEstimateId: { $exists: true, $ne: null }, qbInvoiceId: { $exists: false } },
    { $set: { qbInvoiceId: "pending" } },
    { new: false }
  );

  if (!mapping) {
    console.log("Invoice already created or being processed for this deal, skipping.");
    return;
  }

  const realmId = mapping.realmId;
  if (!realmId) throw new Error("Mapping missing realmId");

  const qb = await QuickBooksConnection.findOne({ realmId, isActive: true });
  if (!qb) throw new Error("QB not connected for this company");

  const estimateRes = await quickBooksRequest({
    realmId,
    endpoint: `/estimate/${mapping.qbEstimateId}`,
  });
  const estimate = estimateRes.Estimate;

  const lines = (estimate.Line || [])
    .filter((l) => l.DetailType === "SalesItemLineDetail")
    .map(({ Id, ...line }) => line);

  const invoicePayload = {
    CustomerRef: estimate.CustomerRef,
    Line: lines,
    LinkedTxn: [{ TxnId: mapping.qbEstimateId, TxnType: "Estimate" }],
  };

  if (estimate.BillEmail) invoicePayload.BillEmail = estimate.BillEmail;
  if (estimate.TxnTaxDetail) invoicePayload.TxnTaxDetail = estimate.TxnTaxDetail;

  const pmName = await getHubSpotDealOwnerName(dealId).catch(() => null);
  if (pmName) invoicePayload.PrivateNote = `PM: ${pmName}`;

  const invoiceRes = await quickBooksRequest({
    realmId,
    endpoint: `/invoice`,
    method: "POST",
    data: invoicePayload,
  });

  const invoice = invoiceRes.Invoice;
  const invoiceLink = invoice.InvoiceLink
    || getInvoicePdfLink({ realmId, invoiceId: invoice.Id, environment: qb.environment });

  const { hubspotInvoiceId } = await createHubSpotInvoice({
    dealId,
    qbInvoiceId: invoice.Id,
    pdfLink: invoiceLink,
    lines,
  });

  await Mapping.findOneAndUpdate(
    { hubspotDealId: dealId },
    { $set: { qbInvoiceId: invoice.Id, hubspotInvoiceId, finalInvoiceLink: invoiceLink } }
  );

  await updateDeal(dealId, {
    dealstage: DEAL_STAGES.BILLED,
    final_invoice_link: invoiceLink,
  });

  await attachInvoicePdfToDeal({ realmId, invoiceId: invoice.Id, dealId });

  console.log("Invoice created & synced");
};