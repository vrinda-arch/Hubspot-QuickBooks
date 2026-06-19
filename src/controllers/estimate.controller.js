const Mapping = require("../models/Mapping");
const { quickBooksRequest } = require("../services/quickbooks/qbClient.service");
const { syncCustomerFieldsToQb } = require("../services/quickbooks/qbCustomer.service");
const { getHubSpotDealOwnerName, getHubSpotCompanyForDeal } = require("../services/hubspot/hubspot.service");

exports.saveEstimateMapping = async (req, res) => {
  try {
    const { proposalId, qbEstimateId, qbDocNumber, hubspotDealId, realmId } = req.body;

    if (!proposalId || !qbEstimateId || !hubspotDealId || !realmId) {
      return res.status(400).json({ error: "proposalId, qbEstimateId, hubspotDealId, and realmId are required" });
    }

    const estimateRes = await quickBooksRequest({ realmId, endpoint: `/estimate/${qbEstimateId}` });
    const qbCustomerId = estimateRes.Estimate?.CustomerRef?.value;

    const mapping = await Mapping.findOneAndUpdate(
      { proposalId },
      { qbEstimateId, qbDocNumber, hubspotDealId, realmId, qbCustomerId },
      { upsert: true, returnDocument: "after" }
    );

    // Fire-and-forget: sync HubSpot company fields to QB customer
    if (qbCustomerId) {
      getHubSpotCompanyForDeal(hubspotDealId)
        .then((company) => {
          if (!company) return;
          return syncCustomerFieldsToQb({
            realmId,
            qbCustomerId,
            customerType: company.customer_type,
            taxExemption: company.tax_exemption,
          });
        })
        .catch((err) => console.error("syncCustomerFieldsToQb failed:", err.message));
    }

    // Fire-and-forget: write PM name to QB estimate PrivateNote
    getHubSpotDealOwnerName(hubspotDealId)
      .then(async (pmName) => {
        if (!pmName) return;
        const estimate = estimateRes.Estimate;
        await quickBooksRequest({
          realmId,
          endpoint: `/estimate`,
          method: "POST",
          data: { Id: estimate.Id, SyncToken: estimate.SyncToken, sparse: true, PrivateNote: `PM: ${pmName}` },
        });
        console.log(`QB estimate ${qbEstimateId} PrivateNote updated with PM: ${pmName}`);
      })
      .catch((err) => console.error("PM sync to QB estimate failed:", err.message));

    res.json(mapping);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save mapping" });
  }
};
