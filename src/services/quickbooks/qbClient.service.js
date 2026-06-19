const axios = require("axios");
const { getValidAccessToken } = require("./qbToken.service");
const { withRetry } = require("../../utils/retry");

exports.quickBooksRequest = async ({ realmId, endpoint, method = "GET", data = null, params = {} }) => {
  const { accessToken, environment } = await getValidAccessToken(realmId);

  const baseUrl = environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const url = `${baseUrl}/v3/company/${realmId}${endpoint}`;

  return withRetry(
    async () => {
      try {
        const response = await axios({ url, method, data, params, headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        }});
        return response.data;
      } catch (error) {
        console.error(`QB API Error [${method} ${endpoint}]:`, JSON.stringify({
          status: error?.response?.status,
          message: error.message,
          data: error?.response?.data,
        }));
        throw error;
      }
    },
    { label: `QB ${method} ${endpoint}` }
  );
};

exports.createInvoiceFromEstimate = async ({ realmId, estimateId }) => {
  return await exports.quickBooksRequest({
    realmId,
    endpoint: `/invoice`,
    method: "POST",
    data: {
      Line: [],
      LinkedTxn: [{ TxnId: estimateId, TxnType: "Estimate" }],
    },
  });
};

exports.getInvoicePdfLink = ({ realmId, invoiceId, environment = "sandbox" }) => {
  const base = environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  return `${base}/v3/company/${realmId}/invoice/${invoiceId}/pdf`;
};
