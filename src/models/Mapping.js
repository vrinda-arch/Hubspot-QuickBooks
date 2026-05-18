const mongoose = require("mongoose");

const mappingSchema = new mongoose.Schema({
  qbDocNumber: String,
  qbEstimateId: String,
  realmId: String,

  proposalId: String,
  hubspotDealId: String,

  qbCustomerId: String,

  advancePaymentLink: String,

  qbInvoiceId: String,
  hubspotInvoiceId: String,
  finalInvoiceLink: String,

  advancePaymentStatus: {
    type: String,
    default: "PENDING",
  },

  finalPaymentStatus: {
    type: String,
    default: "PENDING",
  },
}, { timestamps: true });

mappingSchema.index({ hubspotDealId: 1 });
mappingSchema.index({ qbEstimateId: 1 });
mappingSchema.index({ qbInvoiceId: 1 });

module.exports = mongoose.model("Mapping", mappingSchema);