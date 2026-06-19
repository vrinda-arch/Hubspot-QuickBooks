const mongoose = require("mongoose");

const mappingSchema = new mongoose.Schema({
  qbDocNumber: String,
  qbEstimateId: String,
  realmId: String,

  proposalId: String,
  hubspotDealId: String,

  qbCustomerId: String,

  qbInvoiceId: String,
  hubspotInvoiceId: String,
  finalInvoiceLink: String,

  finalPaymentStatus: {
    type: String,
    default: "PENDING",
  },
}, { timestamps: true });

mappingSchema.index({ hubspotDealId: 1 });
mappingSchema.index({ qbEstimateId: 1 });
mappingSchema.index({ qbInvoiceId: 1 });
mappingSchema.index({ qbCustomerId: 1 });

module.exports = mongoose.model("Mapping", mappingSchema);