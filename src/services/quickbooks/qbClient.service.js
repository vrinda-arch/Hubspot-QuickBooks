const axios = require("axios");
const https = require("https");
const { getValidAccessToken } = require("./qbToken.service");
const { withRetry } = require("../../utils/retry");

// Node 24 / OpenSSL 3.5 offers post-quantum (ML-KEM) TLS key shares by default,
// producing a large ClientHello that some networks/AV/firewalls reject with an
// SSL "internal error" alert. Pin classic curves to keep the handshake small and
// reuse connections via keep-alive.
const qbHttpsAgent = new https.Agent({
  keepAlive: true,
  ecdhCurve: "X25519:prime256v1:secp384r1",
});

exports.quickBooksRequest = async ({ realmId, endpoint, method = "GET", data = null, params = {} }) => {
  const { accessToken, environment } = await getValidAccessToken(realmId);

  const baseUrl = environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
  const url = `${baseUrl}/v3/company/${realmId}${endpoint}`;

  return withRetry(
    async () => {
      try {
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        };
        // QuickBooks rejects a Content-Type header on requests without a body
        // (GET reads) with a 2010 "ContentType Header ... unsupported" fault,
        // so only set it when we're actually sending a payload.
        if (data) headers["Content-Type"] = "application/json";

        const response = await axios({ url, method, data, params, httpsAgent: qbHttpsAgent, headers });
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
