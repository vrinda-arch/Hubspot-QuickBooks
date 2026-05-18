const axios = require("axios");
const crypto = require("crypto");

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const SCOPES = ["com.intuit.quickbooks.accounting"].join(" ");

/**
 * Generate QuickBooks OAuth URL
 */
exports.getAuthUrl = () => {
  const state = crypto.randomBytes(16).toString("hex");

  const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${CLIENT_ID}&response_type=code&scope=${SCOPES}&redirect_uri=${REDIRECT_URI}&state=${state}`;

  return { url, state };
};

/**
 * Exchange auth code for access + refresh token
 */
exports.exchangeCodeForToken = async (code) => {
  try {
    const response = await axios.post(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
      {
        auth: {
          username: CLIENT_ID,
          password: CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("QB Token exchange success");

    return response.data;
  } catch (err) {
    console.error(
      "QB Token Error:",
      err.response?.data || err.message
    );
    throw err;
  }
};