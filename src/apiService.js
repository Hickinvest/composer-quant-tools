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
// expose performanceData to the window object
window.composerQuantTools = {
  performanceData,
};

export async function getSymphonyDailyChange(
  symphonyId,
  cacheTimeout = TwelveHours,
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
    // return symphonyStats;
    // 86400000 is 24 hours in milliseconds
    // there is a bug in the api where the epoch_ms is one day behind the actual date
    // TODO: fix this if they ever fix it in the api
    const oneDayInMs = 86400000;
    symphonyStats.epoch_ms = symphonyStats.epoch_ms.map(epoch_ms => epoch_ms + oneDayInMs);
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

export async function getSymphonyActivityHistory(symphonyId, cacheTimeout = TwelveHours) {
  const { token, account } = await getTokenAndAccount();
  const cacheKey = `composerQuantTools-symphony-activity-history-${symphonyId}`;
  const symphonyStats = await makeApiCallWithCache(
    // this limit is a hack to get all the activity history ... it sucks but it works
    `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphonies/${symphonyId}/activity-history?limit=9999999&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
    { cacheKey, cacheTimeout },
    `Get symphony activity history for ${symphonyId}`
  );
  return symphonyStats;
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
    // No cache - always fetch fresh data on page load for accurate P/L values
    const symphonyStats = await makeApiCallWithCache(
      `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphony-stats-meta`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey: `composerQuantTools-symphony-stats-meta`,
        cacheTimeout: 0, // No cache - symphony.value changes during trading
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

// Fetch aggregate portfolio stats (includes net_deposits which captures wires/IRA rollovers)
export async function fetchAggregatePortfolioStats(account, token) {
  const url = `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/aggregate-stats`;
  try {
    const data = await makeApiCallWithCache(
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      { cacheKey: `composerQuantTools-aggregate-stats-${account.account_uuid}`, cacheTimeout: 60 * 60 * 1000 },
      `Get aggregate portfolio stats for ${account.account_uuid}`
    );
    return data;
  } catch (error) {
    log("Error fetching aggregate portfolio stats:", error);
    return null;
  }
}

// Export getTokenAndAccount for convenience
export { getTokenAndAccount }; 