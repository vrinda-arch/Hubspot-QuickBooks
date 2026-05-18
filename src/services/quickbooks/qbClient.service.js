const axios = require("axios");
const { getValidAccessToken } = require("./qbToken.service");

/**
 * Generic QuickBooks API request
 */
exports.quickBooksRequest = async ({
  realmId,
  endpoint,
  method = "GET",
  data = null,
  params = {},
}) => {
  try {
    const { accessToken, environment } = await getValidAccessToken(realmId);

    const baseUrl =
      environment === "sandbox"
        ? "https://sandbox-quickbooks.api.intuit.com"
        : "https://quickbooks.api.intuit.com";

    const url = `${baseUrl}/v3/company/${realmId}${endpoint}`;

    const response = await axios({
      url,
      method,
      data,
      params,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    console.error("QuickBooks API Error:", JSON.stringify({
      message: error.message,
      code: error.code,
      status: error?.response?.status,
      data: error?.response?.data,
    }, null, 2));

    throw new Error("QuickBooks request failed");
  }
};

/**
 * Create Invoice from Estimate
 */
exports.createInvoiceFromEstimate = async ({ realmId, estimateId }) => {
  return await exports.quickBooksRequest({
    realmId,
    endpoint: `/invoice`,
    method: "POST",
    data: {
      Line: [],
      LinkedTxn: [
        {
          TxnId: estimateId,
          TxnType: "Estimate",
        },
      ],
    },
  });
};

/**
 * Get Invoice PDF link
 */
exports.getInvoicePdfLink = ({ realmId, invoiceId, environment = "sandbox" }) => {
  const base = environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${base}/v3/company/${realmId}/invoice/${invoiceId}/pdf`;
};