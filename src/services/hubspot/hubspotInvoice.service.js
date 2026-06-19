const axios = require("axios");
const FormData = require("form-data");
const { getValidAccessToken } = require("../quickbooks/qbToken.service");
const { updateDeal, HUBSPOT_BASE, hsHeaders, hsRequest } = require("./hubspot.service");
const { HS_ASSOCIATION_TYPES } = require("../../config/constants");
const { withRetry } = require("../../utils/retry");

const QB_BASE = "https://quickbooks.api.intuit.com";

exports.createHubSpotInvoice = async ({ dealId, qbInvoiceId, pdfLink, lines = [], totalAmt = 0, docNumber = null, txnDate = null, dueDate = null }) => {
  const invoiceProperties = {
    hs_invoice_status: "draft",
    ...(dueDate && { hs_due_date: dueDate }),
    hs_currency: "USD",
    qb_invoice_id: qbInvoiceId,
    invoice_pdf_link: pdfLink,
    qb_balance_due: totalAmt,
    qb_payment_status: "Unpaid",
    ...(docNumber && { qb_invoice_number: docNumber }),
    ...(txnDate && { qb_invoice_date: txnDate }),
  };

  let res;
  try {
    res = await hsRequest(
      () => axios.post(
        `${HUBSPOT_BASE}/crm/v3/objects/invoices`,
        { properties: invoiceProperties },
        { headers: hsHeaders() }
      ),
      "createInvoice"
    );
  } catch (err) {
    console.error("HubSpot Invoice Create Error:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }

  const hubspotInvoiceId = res.data.id;

  let lineItemsCreated = 0;
  for (const line of lines) {
    try {
      const qty = line.SalesItemLineDetail?.Qty ?? 1;
      const unitPrice = line.SalesItemLineDetail?.UnitPrice ?? (line.Amount ?? 0) / (qty || 1);
      const li = await hsRequest(
        () => axios.post(
          `${HUBSPOT_BASE}/crm/v3/objects/line_items`,
          {
            properties: {
              name: line.Description || "Service",
              quantity: String(qty),
              price: String(unitPrice),
            },
          },
          { headers: hsHeaders() }
        ),
        "createLineItem"
      );

      await hsRequest(
        () => axios.put(
          `${HUBSPOT_BASE}/crm/v4/objects/invoices/${hubspotInvoiceId}/associations/line_items/${li.data.id}`,
          [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HS_ASSOCIATION_TYPES.INVOICE_TO_LINE_ITEM }],
          { headers: hsHeaders() }
        ),
        "associateLineItem"
      );
      lineItemsCreated++;
      console.log(`Line item ${li.data.id} created and associated with invoice ${hubspotInvoiceId}`);
    } catch (err) {
      console.error("HubSpot Line Item Error:", JSON.stringify(err?.response?.data, null, 2));
    }
  }
  console.log(`Line items created: ${lineItemsCreated}/${lines.length}`);

  try {
    await hsRequest(
      () => axios.patch(
        `${HUBSPOT_BASE}/crm/v3/objects/invoices/${hubspotInvoiceId}`,
        { properties: { hs_invoice_status: "open" } },
        { headers: hsHeaders() }
      ),
      "setInvoiceOpen"
    );
    console.log("Invoice status updated to open");
  } catch (err) {
    console.error("HubSpot Invoice Status Update Error:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }

  try {
    const assocRes = await hsRequest(
      () => axios.put(
        `${HUBSPOT_BASE}/crm/v4/objects/invoices/${hubspotInvoiceId}/associations/deals/${dealId}`,
        [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HS_ASSOCIATION_TYPES.INVOICE_TO_DEAL }],
        { headers: hsHeaders() }
      ),
      "associateInvoiceDeal"
    );
    console.log(`Invoice ${hubspotInvoiceId} associated with deal ${dealId}:`, JSON.stringify(assocRes.data, null, 2));
  } catch (err) {
    console.error("HubSpot Invoice-Deal Association Error:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }

  return { hubspotInvoiceId };
};

exports.updateHubSpotInvoiceStatus = async (hubspotInvoiceId, status) => {
  try {
    await hsRequest(
      () => axios.patch(
        `${HUBSPOT_BASE}/crm/v3/objects/invoices/${hubspotInvoiceId}`,
        { properties: { hs_invoice_status: status } },
        { headers: hsHeaders() }
      ),
      `updateInvoiceStatus ${hubspotInvoiceId}`
    );
  } catch (err) {
    console.error(`HubSpot updateInvoiceStatus error [invoice ${hubspotInvoiceId}]:`, err?.response?.data || err.message);
    throw err;
  }
};

exports.updateHubSpotInvoiceBalance = async (hubspotInvoiceId, balanceAmt, paymentStatus = null) => {
  const properties = { qb_balance_due: balanceAmt };
  if (paymentStatus) properties.qb_payment_status = paymentStatus;
  try {
    await hsRequest(
      () => axios.patch(
        `${HUBSPOT_BASE}/crm/v3/objects/invoices/${hubspotInvoiceId}`,
        { properties },
        { headers: hsHeaders() }
      ),
      `updateInvoiceBalance ${hubspotInvoiceId}`
    );
  } catch (err) {
    console.error(`HubSpot updateInvoiceBalance error [invoice ${hubspotInvoiceId}]:`, err?.response?.data || err.message);
    throw err;
  }
};

exports.attachInvoicePdfToDeal = async ({ realmId, invoiceId, dealId }) => {
  try {
    const { accessToken } = await getValidAccessToken(realmId);

    const pdfRes = await withRetry(
      () => axios.get(
        `${QB_BASE}/v3/company/${realmId}/invoice/${invoiceId}/pdf`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" }, responseType: "arraybuffer" }
      ),
      { label: `QB PDF invoice ${invoiceId}` }
    );

    const form = new FormData();
    form.append("file", Buffer.from(pdfRes.data), { filename: `invoice-${invoiceId}.pdf`, contentType: "application/pdf" });
    form.append("folderPath", "/QB-Invoices");
    form.append("options", JSON.stringify({ access: "PUBLIC_NOT_INDEXABLE" }));

    const uploadRes = await withRetry(
      () => axios.post(
        `${HUBSPOT_BASE}/files/v3/files`,
        form,
        { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } }
      ),
      { label: `HS upload invoice PDF ${invoiceId}` }
    );
    const fileId = uploadRes.data.id;
    const fileUrl = uploadRes.data.url;
    console.log("PDF uploaded to HubSpot Files:", fileUrl);

    const noteRes = await hsRequest(
      () => axios.post(
        `${HUBSPOT_BASE}/crm/v3/objects/notes`,
        {
          properties: {
            hs_note_body: `QuickBooks Invoice #${invoiceId} PDF`,
            hs_timestamp: new Date().toISOString(),
            hs_attachment_ids: String(fileId),
          },
        },
        { headers: hsHeaders() }
      ),
      "createInvoiceNote"
    );

    await hsRequest(
      () => axios.put(
        `${HUBSPOT_BASE}/crm/v4/objects/notes/${noteRes.data.id}/associations/deals/${dealId}`,
        [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HS_ASSOCIATION_TYPES.NOTE_TO_DEAL }],
        { headers: hsHeaders() }
      ),
      "associateNoteWithDeal"
    );

    console.log(`Invoice PDF attached to deal ${dealId} as note`);
  } catch (err) {
    console.error("Attach Invoice PDF Error:", JSON.stringify(err?.response?.data, null, 2) || err.message);
  }
};
