const axios = require("axios");
const FormData = require("form-data");
const { getValidAccessToken } = require("../quickbooks/qbToken.service");
const { updateDeal, HUBSPOT_BASE, hsHeaders } = require("./hubspot.service");
const { HS_ASSOCIATION_TYPES } = require("../../config/constants");

const QB_BASE = "https://quickbooks.api.intuit.com";

exports.createHubSpotInvoice = async ({ dealId, qbInvoiceId, pdfLink, lines = [] }) => {
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toISOString().split("T")[0];

  let res;
  try {
    res = await axios.post(
      `${HUBSPOT_BASE}/crm/v3/objects/invoices`,
      {
        properties: {
          hs_invoice_status: "draft",
          hs_due_date: dueDateStr,
          hs_currency: "USD",
          qb_invoice_id: qbInvoiceId,
          invoice_pdf_link: pdfLink,
        },
      },
      { headers: hsHeaders() }
    );
  } catch (err) {
    console.error("HubSpot Invoice Create Error:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }

  const hubspotInvoiceId = res.data.id;

  let lineItemsCreated = 0;
  for (const line of lines) {
    try {
      const li = await axios.post(
        `${HUBSPOT_BASE}/crm/v3/objects/line_items`,
        {
          properties: {
            name: line.Description || "Service",
            quantity: String(line.SalesItemLineDetail?.Qty ?? 1),
            price: String(line.SalesItemLineDetail?.UnitPrice ?? line.Amount),
            amount: String(line.Amount),
          },
        },
        { headers: hsHeaders() }
      );

      await axios.put(
        `${HUBSPOT_BASE}/crm/v4/objects/invoices/${hubspotInvoiceId}/associations/line_items/${li.data.id}`,
        [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HS_ASSOCIATION_TYPES.INVOICE_TO_LINE_ITEM }],
        { headers: hsHeaders() }
      );
      lineItemsCreated++;
      console.log(`Line item ${li.data.id} created and associated with invoice ${hubspotInvoiceId}`);
    } catch (err) {
      console.error("HubSpot Line Item Error:", JSON.stringify(err?.response?.data, null, 2));
    }
  }
  console.log(`Line items created: ${lineItemsCreated}/${lines.length}`);

  try {
    await axios.patch(
      `${HUBSPOT_BASE}/crm/v3/objects/invoices/${hubspotInvoiceId}`,
      { properties: { hs_invoice_status: "open" } },
      { headers: hsHeaders() }
    );
    console.log("Invoice status updated to open");
  } catch (err) {
    console.error("HubSpot Invoice Status Update Error:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }

  try {
    const assocRes = await axios.put(
      `${HUBSPOT_BASE}/crm/v4/objects/invoices/${hubspotInvoiceId}/associations/deals/${dealId}`,
      [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HS_ASSOCIATION_TYPES.INVOICE_TO_DEAL }],
      { headers: hsHeaders() }
    );
    console.log(`Invoice ${hubspotInvoiceId} associated with deal ${dealId}:`, JSON.stringify(assocRes.data, null, 2));
  } catch (err) {
    console.error("HubSpot Invoice-Deal Association Error:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }

  return { hubspotInvoiceId };
};

exports.updateHubSpotInvoiceStatus = async (hubspotInvoiceId, status) => {
  await axios.patch(
    `${HUBSPOT_BASE}/crm/v3/objects/invoices/${hubspotInvoiceId}`,
    { properties: { hs_invoice_status: status } },
    { headers: hsHeaders() }
  );
};

exports.attachInvoicePdfToDeal = async ({ realmId, invoiceId, dealId }) => {
  try {
    const { accessToken } = await getValidAccessToken(realmId);
    const pdfRes = await axios.get(
      `${QB_BASE}/v3/company/${realmId}/invoice/${invoiceId}/pdf`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" },
        responseType: "arraybuffer",
      }
    );

    const form = new FormData();
    form.append("file", Buffer.from(pdfRes.data), { filename: `invoice-${invoiceId}.pdf`, contentType: "application/pdf" });
    form.append("folderPath", "/QB-Invoices");
    form.append("options", JSON.stringify({ access: "PUBLIC_NOT_INDEXABLE" }));

    const uploadRes = await axios.post(
      `${HUBSPOT_BASE}/files/v3/files`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } }
    );
    const fileId = uploadRes.data.id;
    const fileUrl = uploadRes.data.url;
    console.log("PDF uploaded to HubSpot Files:", fileUrl);

    const noteRes = await axios.post(
      `${HUBSPOT_BASE}/crm/v3/objects/notes`,
      {
        properties: {
          hs_note_body: `QuickBooks Invoice #${invoiceId} PDF`,
          hs_timestamp: new Date().toISOString(),
          hs_attachment_ids: String(fileId),
        },
      },
      { headers: hsHeaders() }
    );

    await axios.put(
      `${HUBSPOT_BASE}/crm/v4/objects/notes/${noteRes.data.id}/associations/deals/${dealId}`,
      [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: HS_ASSOCIATION_TYPES.NOTE_TO_DEAL }],
      { headers: hsHeaders() }
    );

    console.log(`Invoice PDF attached to deal ${dealId} as note`);
  } catch (err) {
    console.error("Attach Invoice PDF Error:", JSON.stringify(err?.response?.data, null, 2) || err.message);
  }
};

exports.attachEstimatePdfToDeal = async ({ realmId, estimateId, dealId }) => {
  try {
    const { accessToken } = await getValidAccessToken(realmId);
    const pdfRes = await axios.get(
      `${QB_BASE}/v3/company/${realmId}/estimate/${estimateId}/pdf`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" },
        responseType: "arraybuffer",
      }
    );

    const form = new FormData();
    form.append("file", Buffer.from(pdfRes.data), { filename: `estimate-${estimateId}.pdf`, contentType: "application/pdf" });
    form.append("folderPath", "/QB-Estimates");
    form.append("options", JSON.stringify({ access: "PUBLIC_NOT_INDEXABLE" }));

    const uploadRes = await axios.post(
      `${HUBSPOT_BASE}/files/v3/files`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` } }
    );

    const fileUrl = uploadRes.data.url;
    console.log("Estimate PDF uploaded to HubSpot Files:", fileUrl);
    await updateDeal(dealId, { estimate_pdf_link: fileUrl });
    console.log(`estimate_pdf_link pushed to deal ${dealId}`);
    return fileUrl;
  } catch (err) {
    console.error("Attach Estimate PDF Error:", JSON.stringify(err?.response?.data, null, 2) || err.message);
  }
};
