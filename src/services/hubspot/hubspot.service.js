const axios = require("axios");

const HUBSPOT_BASE = "https://api.hubapi.com";
const hsHeaders = () => ({
  Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
  "Content-Type": "application/json",
});

exports.HUBSPOT_BASE = HUBSPOT_BASE;
exports.hsHeaders = hsHeaders;

exports.updateDeal = async (dealId, properties) => {
  try {
    const res = await axios.patch(
      `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}`,
      { properties },
      { headers: hsHeaders() }
    );
    return res.data;
  } catch (err) {
    console.error("HubSpot Update Error:", err.response?.data || err.message);
    throw err;
  }
};

exports.getHubSpotDealOwnerName = async (dealId) => {
  const dealRes = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}?properties=hubspot_owner_id`,
    { headers: hsHeaders() }
  );
  const ownerId = dealRes.data.properties?.hubspot_owner_id;
  if (!ownerId) return null;

  const ownerRes = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/owners/${ownerId}`,
    { headers: hsHeaders() }
  );
  const { firstName, lastName } = ownerRes.data;
  return [firstName, lastName].filter(Boolean).join(" ") || null;
};

exports.getHubSpotCompanyForDeal = async (dealId) => {
  const assocRes = await axios.get(
    `${HUBSPOT_BASE}/crm/v4/objects/deals/${dealId}/associations/companies`,
    { headers: hsHeaders() }
  );
  const companyId = assocRes.data?.results?.[0]?.toObjectId;
  if (!companyId) {
    console.log(`No associated company found for deal ${dealId}`);
    return null;
  }

  const companyRes = await axios.get(
    `${HUBSPOT_BASE}/crm/v3/objects/companies/${companyId}?properties=customer_type,tax_exemption`,
    { headers: hsHeaders() }
  );
  return companyRes.data?.properties || null;
};
