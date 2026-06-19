const axios = require("axios");
const { withRetry } = require("../../utils/retry");

const HUBSPOT_BASE = "https://api.hubapi.com";
const hsHeaders = () => ({
  Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
  "Content-Type": "application/json",
});

exports.HUBSPOT_BASE = HUBSPOT_BASE;
exports.hsHeaders = hsHeaders;

exports.hsRequest = (fn, label = "request") =>
  withRetry(fn, { label: `HS ${label}` });

exports.updateDeal = async (dealId, properties) => {
  try {
    const res = await exports.hsRequest(
      () => axios.patch(
        `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}`,
        { properties },
        { headers: hsHeaders() }
      ),
      `updateDeal ${dealId}`
    );
    return res.data;
  } catch (err) {
    console.error(`HubSpot updateDeal error [deal ${dealId}]:`, err?.response?.data || err.message);
    throw err;
  }
};

exports.getHubSpotDealOwnerName = async (dealId) => {
  const dealRes = await exports.hsRequest(
    () => axios.get(
      `${HUBSPOT_BASE}/crm/v3/objects/deals/${dealId}?properties=hubspot_owner_id`,
      { headers: hsHeaders() }
    ),
    `getDealOwner ${dealId}`
  );
  const ownerId = dealRes.data.properties?.hubspot_owner_id;
  if (!ownerId) return null;

  const ownerRes = await exports.hsRequest(
    () => axios.get(`${HUBSPOT_BASE}/crm/v3/owners/${ownerId}`, { headers: hsHeaders() }),
    `getOwner ${ownerId}`
  );
  const { firstName, lastName } = ownerRes.data;
  return [firstName, lastName].filter(Boolean).join(" ") || null;
};

exports.getHubSpotCompanyForDeal = async (dealId) => {
  const assocRes = await exports.hsRequest(
    () => axios.get(
      `${HUBSPOT_BASE}/crm/v4/objects/deals/${dealId}/associations/companies`,
      { headers: hsHeaders() }
    ),
    `getDealCompany ${dealId}`
  );
  const companyId = assocRes.data?.results?.[0]?.toObjectId;
  if (!companyId) {
    console.log(`No associated company found for deal ${dealId}`);
    return null;
  }

  const companyRes = await exports.hsRequest(
    () => axios.get(
      `${HUBSPOT_BASE}/crm/v3/objects/companies/${companyId}?properties=customer_type,tax_exemption`,
      { headers: hsHeaders() }
    ),
    `getCompany ${companyId}`
  );
  return companyRes.data?.properties || null;
};
