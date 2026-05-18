// const axios = require("axios");
// const QuickBooksConnection = require("../../models/QuickBooksConnection");

// const CLIENT_ID = process.env.CLIENT_ID;
// const CLIENT_SECRET = process.env.CLIENT_SECRET;

// async function refreshAccessToken(refreshToken) {
//   const response = await axios.post(
//     "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
//     new URLSearchParams({
//       grant_type: "refresh_token",
//       refresh_token: refreshToken,
//     }).toString(),
//     {
//       auth: {
//         username: CLIENT_ID,
//         password: CLIENT_SECRET,
//       },
//       headers: {
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//     }
//   );

//   return response.data;
// }

// exports.getValidAccessToken = async (companyId) => {
//   const qb = await QuickBooksConnection.findOne({
//     companyId,
//     isActive: true,
//   });

//   if (!qb) {
//     throw new Error("QuickBooks not connected");
//   }

//   const now = Date.now();
//   const accessExpiry = new Date(qb.accessTokenExpiresAt).getTime();
//   const refreshExpiry = new Date(qb.refreshTokenExpiresAt).getTime();

//   // Refresh token expired
//   if (now >= refreshExpiry) {
//     qb.needsReconnect = true;
//     qb.isActive = false;
//     await qb.save();

//     throw new Error("Reconnect QuickBooks");
//   }

//   // Access token valid
//   const buffer = 5 * 60 * 1000;
//   if (now < accessExpiry - buffer) {
//     return {
//       accessToken: qb.accessToken,
//       realmId: qb.realmId,
//       environment: qb.environment,
//     };
//   }

//   // Refresh token
//   const refreshed = await refreshAccessToken(qb.refreshToken);

//   qb.accessToken = refreshed.access_token;
//   qb.refreshToken = refreshed.refresh_token;
//   qb.accessTokenExpiresAt = new Date(now + refreshed.expires_in * 1000);
//   qb.refreshTokenExpiresAt = new Date(
//     now + refreshed.x_refresh_token_expires_in * 1000
//   );
//   qb.lastRefreshedAt = new Date();

//   await qb.save();

//   return {
//     accessToken: qb.accessToken,
//     realmId: qb.realmId,
//     environment: qb.environment,
//   };
// };



const axios = require("axios");
const QuickBooksConnection = require("../../models/QuickBooksConnection");

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const refreshLocks = new Map();

async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      {
        auth: {
          username: CLIENT_ID,
          password: CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error(
      "QB Refresh Error:",
      error?.response?.data || error.message
    );
    throw error;
  }
}

exports.getValidAccessToken = async (realmId) => {
  const qb = await QuickBooksConnection.findOne({
    realmId,
    isActive: true,
  });

  if (!qb) {
    throw new Error("QuickBooks not connected");
  }

  const now = Date.now();
  const buffer = 5 * 60 * 1000;

  const accessExpiry = new Date(qb.accessTokenExpiresAt).getTime();
  const refreshExpiry = new Date(qb.refreshTokenExpiresAt).getTime();

  // Refresh token expired
  if (!refreshExpiry || now >= refreshExpiry) {
    qb.needsReconnect = true;
    qb.isActive = false;
    await qb.save();
    throw new Error("Reconnect QuickBooks");
  }

  // Access token still valid
  if (accessExpiry && now < accessExpiry - buffer) {
    return {
      accessToken: qb.accessToken,
      realmId: qb.realmId,
      environment: qb.environment,
    };
  }

  // Prevent parallel refresh
  if (refreshLocks.has(realmId)) {
    return await refreshLocks.get(realmId);
  }

  const refreshPromise = (async () => {
    try {
      const latestQb = await QuickBooksConnection.findOne({
        realmId,
        isActive: true,
      });

      const latestNow = Date.now();
      const latestAccessExpiry = new Date(
        latestQb.accessTokenExpiresAt
      ).getTime();

      if (latestNow < latestAccessExpiry - buffer) {
        return {
          accessToken: latestQb.accessToken,
          realmId: latestQb.realmId,
          environment: latestQb.environment,
        };
      }

      const refreshed = await refreshAccessToken(latestQb.refreshToken);

      latestQb.accessToken = refreshed.access_token;
      latestQb.refreshToken =
        refreshed.refresh_token || latestQb.refreshToken;

      latestQb.accessTokenExpiresAt = new Date(
        Date.now() + refreshed.expires_in * 1000
      );

      if (refreshed.x_refresh_token_expires_in) {
        latestQb.refreshTokenExpiresAt = new Date(
          Date.now() + refreshed.x_refresh_token_expires_in * 1000
        );
      }

      latestQb.lastRefreshedAt = new Date();
      latestQb.needsReconnect = false;

      await latestQb.save();

      return {
        accessToken: latestQb.accessToken,
        realmId: latestQb.realmId,
        environment: latestQb.environment,
      };
    } catch (error) {
      const qbError = error?.response?.data || {};
      console.error("Token refresh catch:", {
        message: error.message,
        status: error?.response?.status,
        data: JSON.stringify(qbError),
      });

      const msg =
        qbError?.fault?.error?.[0]?.detail?.toLowerCase?.() || "";

      if (
        msg.includes("token expired") ||
        qbError?.error === "invalid_grant" ||
        error.message === "Reconnect QuickBooks"
      ) {
        const stale = await QuickBooksConnection.findOne({ realmId });
        if (stale) {
          stale.needsReconnect = true;
          stale.isActive = false;
          await stale.save();
        }
        throw new Error("Reconnect QuickBooks");
      }

      throw new Error("Token refresh failed");
    } finally {
      refreshLocks.delete(realmId);
    }
  })();

  refreshLocks.set(realmId, refreshPromise);
  return await refreshPromise;
};