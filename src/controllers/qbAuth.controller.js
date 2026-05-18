const crypto = require("crypto");
const qbAuthService = require("../services/quickbooks/qbAuth.service");
const QuickBooksConnection = require("../models/QuickBooksConnection");
const { quickBooksRequest } = require("../services/quickbooks/qbClient.service");

/**
 * Connect button
 */
exports.connectQuickBooks = (req, res) => {
  const { url } = qbAuthService.getAuthUrl();

  res.send(`
    <h2>QuickBooks Integration</h2>
    <a href="${url}">Connect to QuickBooks</a>
  `);
};

/**
 * Callback
 */
exports.quickBooksCallback = async (req, res) => {
  try {
    const { code, realmId } = req.query;
    console.log("Realm ID:",realmId);
    console.log("Auth Code:",code);
    if (!code || !realmId) {
      return res.status(400).send("Missing code or realmId");
    }

    const tokenData = await qbAuthService.exchangeCodeForToken(code);
    const now = Date.now();

    await QuickBooksConnection.findOneAndUpdate(
      { realmId },
      {
        realmId,
        companyId: realmId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        accessTokenExpiresAt: new Date(now + tokenData.expires_in * 1000),
        refreshTokenExpiresAt: new Date(
          now + tokenData.x_refresh_token_expires_in * 1000
        ),
        environment: process.env.QB_ENVIRONMENT || "production",
        isActive: true,
        needsReconnect: false,
        lastRefreshedAt: new Date(),
      },
      { upsert: true, returnDocument: "after" }
    );

    res.send("QuickBooks connected successfully!");
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Connection failed");
  }
};

/**
 * Test API
 */
exports.testInvoices = async (req, res) => {
  try {
    const { realmId } = req.query;

    const data = await quickBooksRequest({
      realmId,
      endpoint: "/query",
      params: {
        query: "SELECT * FROM Invoice MAXRESULTS 5",
      },
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.queryEstimate = async (req, res) => {
  try {
    const { realmId, docNumber } = req.query;

    const data = await quickBooksRequest({
      realmId,
      endpoint: "/query",
      params: {
        query: `SELECT * FROM Estimate WHERE DocNumber = '${docNumber}'`,
      },
    });

    const estimate = data.QueryResponse?.Estimate?.[0];

    if (!estimate) {
      return res.status(404).json({ success: false, message: "Estimate not found" });
    }

    res.json({
      success: true,
      id: estimate.Id,
      docNumber: estimate.DocNumber,
      total: estimate.TotalAmt,
      status: estimate.TxnStatus,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};





