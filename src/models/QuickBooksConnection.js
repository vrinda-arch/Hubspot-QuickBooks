const mongoose = require("mongoose");

const quickBooksConnectionSchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
    },

    realmId: {
      type: String,
      required: true,
    },

    accessToken: {
      type: String,
      required: true,
    },

    refreshToken: {
      type: String,
      required: true,
    },

    accessTokenExpiresAt: {
      type: Date,
      required: true,
    },

    refreshTokenExpiresAt: {
      type: Date,
      required: true,
    },

    environment: {
      type: String,
      enum: ["sandbox", "production"],
      default: "sandbox",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    needsReconnect: {
      type: Boolean,
      default: false,
    },

    lastRefreshedAt: {
      type: Date,
      default: null,
    },

    lastRefreshError: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// one tenant/company can connect multiple QB accounts,
// but not the same realm twice
quickBooksConnectionSchema.index(
  { companyId: 1, realmId: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "QuickBooksConnection",
  quickBooksConnectionSchema
);