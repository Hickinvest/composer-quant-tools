import { log } from "./utils/logger.js";
import { makeApiCallWithCache } from "./utils/apiUtils.js";
import { getTokenAndAccount } from "./utils/tokenAndAccountUtil.js";

// Fetch portfolio history for an account
export async function fetchPortfolioHistory(account, token) {
  const url = `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/portfolio-history`;
  const data = await makeApiCallWithCache(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    { cacheKey: `composerQuantTools-portfolio-history-${account.account_uuid}`, cacheTimeout: 60 * 60 * 1000 },
    `Get portfolio history for ${account.account_uuid}`
  );
  return data;
}

// Fetch ACH transfers for a given year
export async function fetchAchTransfers(account, token, year) {
  const url = `https://stagehand-api.composer.trade/api/v1/cash/accounts/${account.account_uuid}/ach-transfers?year=${year}`;
  const data = await makeApiCallWithCache(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    { cacheKey: `composerQuantTools-ach-transfers-${account.account_uuid}-${year}`, cacheTimeout: 60 * 60 * 1000 },
    `Get ACH transfers for ${account.account_uuid} year ${year}`
  );
  return data;
}

// --- Moved from portfolio.js ---
const TwelveHours = 12 * 60 * 60 * 1000;
export const performanceData = {};

export async function getSymphonyDailyChange(
  symphonyId,
  cacheTimeout = 0,
  timeToWaitBeforeCall = 0,
) {
  const cacheKey = "composerQuantTools-" + symphonyId;
  const { token, account } = await getTokenAndAccount();
  try {
    const symphonyStats = await makeApiCallWithCache(
      `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphonies/${symphonyId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey,
        cacheTimeout,
      },
      `Get symphony daily change for ${symphonyId}`
    );
    return symphonyStats;
  } catch (error) {
    log(
      `Cannot load extension. symphonies/${symphonyId} endpoint returned an error`,
      error
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }
}

export async function getAccountDeploys(status = "SUCCEEDED") {
  const { token, account } = await getTokenAndAccount();
  try {
    const symphonyStats = await makeApiCallWithCache(
      `https://trading-api.composer.trade/api/v1/deploy/accounts/${account.account_uuid}/deploys?status=${status}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey: `composerQuantTools-deploys-${status}`,
        cacheTimeout: TwelveHours,
      },
      `Get account deploys with status ${status}`
    );
    return symphonyStats?.deploys;
  } catch (error) {
    log(
      `Cannot load extension. deploys endpoint returned an error`,
      error
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }
}

export async function getSymphonyStatsMeta() {
  const { token, account } = await getTokenAndAccount();
  try {
    const symphonyStats = await makeApiCallWithCache(
      `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphony-stats-meta`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey: `composerQuantTools-symphony-stats-meta`,
        cacheTimeout: TwelveHours,
      },
      `Get symphony stats meta`
    );
    return symphonyStats;
  } catch (error) {
    log(
      `Cannot load extension. symphony-stats endpoint returned an error`,
      error
    );
    const holdings = [];
    return {
      account,
      holdings,
    };
  }
}

// Export getTokenAndAccount for convenience
export { getTokenAndAccount }; 