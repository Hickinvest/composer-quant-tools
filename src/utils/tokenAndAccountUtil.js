import { log } from "./logger.js";

export function buildHeaders(token, sessionId) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["X-Session-Id"] = sessionId;
  return headers;
}

let tokenString;
let sessionId;

export function initTokenAndAccountUtil() {
  chrome.storage.local.get(["tokenInfo"], function (result) {
    const tokenInfo = result.tokenInfo;
    if (tokenInfo) {
      if (typeof tokenInfo.token === "object" && tokenInfo.token !== null) {
        tokenString = tokenInfo.token.token;
        sessionId = tokenInfo.token.sessionId;
      } else {
        tokenString = tokenInfo.token;
      }
    }
    log("Token loaded:", tokenString, "SessionId:", sessionId);
  });

  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === "local" && changes.tokenInfo) {
      const newValue = changes.tokenInfo.newValue;
      if (newValue) {
        if (typeof newValue.token === "object" && newValue.token !== null) {
          tokenString = newValue.token.token;
          sessionId = newValue.token.sessionId;
        } else {
          tokenString = newValue.token;
        }
      }
      log("Token updated:", tokenString, "SessionId:", sessionId);
    }
  });
}

async function pollForToken() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (tokenString) {
        clearInterval(interval);
        resolve({ token: tokenString, sessionId });
      }
    }, 100);
  });
}

let accountPromise;

// getAccount will poll for selectedAccount every 200ms until it is found (So it could run indefinitely if the account is never found)
function getAccount(auth) {
  const { token, sessionId } = auth;
  if (!accountPromise) {
    accountPromise = new Promise(async (resolve) => {
      try {
        const resp = await fetch(
          "https://stagehand-api.composer.trade/api/v1/accounts/list",
          { headers: buildHeaders(token, sessionId) },
        );
        const data = await resp.json();

        let account;

        // Try to find account from localStorage (with timeout to prevent infinite loop)
        let attempts = 0;
        const maxAttempts = 10; // 2 seconds max

        while (!account && attempts < maxAttempts) {
          const selectedAccount = localStorage.getItem("selectedAccount");
          if (selectedAccount) {
            account = data.accounts.find(
              (acct) => acct.account_uuid === selectedAccount,
            );
          }
          if (!account) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        if (account) {
          log("Found account from localStorage:", account.account_uuid);
          resolve(account);
        } else {
          // Fallback: try to detect from UI buttons
          const getElementsByText = (text, selector) => {
            return Array.from(document.querySelectorAll(selector)).filter(el => el.textContent.includes(text));
          };

          const isStocks = getElementsByText("Stocks", "button").length > 0;
          const isRoth = getElementsByText("Roth", "button").length > 0;
          const isTraditional = getElementsByText("Traditional", "button").length > 0;

          if (isStocks) {
            account = data.accounts.filter((acct) =>
              acct.account_type.toLowerCase().includes("individual"),
            )[0];
          } else if (isRoth) {
            account = data.accounts.filter((acct) =>
              acct.account_type.toLowerCase().includes("roth"),
            )[0];
          } else if (isTraditional) {
            account = data.accounts.filter((acct) =>
              acct.account_type.toLowerCase().includes("traditional"),
            )[0];
          }

          // Final fallback: just use the first account
          if (!account && data.accounts && data.accounts.length > 0) {
            account = data.accounts[0];
            log("Using first account as fallback:", account.account_uuid);
          }

          if (account) {
            resolve(account);
          } else {
            log("No accounts found");
            resolve(null);
          }
        }
      } catch (error) {
        log("Unable to detect account type:", error);
        resolve(null);
      }
    });
  }
  return accountPromise;
}

function getAccountInfoFromLocalStorage() {
  const selectedPortfolioType = localStorage.getItem('selectedPortfolioType');
  const selectedPortfolioTypeData = selectedPortfolioType?.match(/\:[^\"]+\"[^\"]+\"/g)
  const accountInfo = selectedPortfolioTypeData?.reduce((acc, item)=>{
    const splitItem = item.split(' ');
    acc[splitItem[0].replace(':', '')] = splitItem.slice(1).join(' ').replace(/"/g, '');
    return acc;
  }, {}) || {};

  return accountInfo;
}

function getTokenAndAccountUtil() {
  let lastAuthRequest;
  let cachedAuth;
  let account;
  let accountId;

  return async function getTokenAndAccount() {
    const accountInfo = getAccountInfoFromLocalStorage();
    const currentAccountId = accountInfo['account-id'];

    // Check if cache is still valid: same account and within 20 minutes
    const cacheValid = lastAuthRequest && Date.now() - lastAuthRequest < 20 * 60 * 1000;

    if (cachedAuth && accountId && cacheValid && currentAccountId === accountId) {
      return {
        token: cachedAuth.token,
        sessionId: cachedAuth.sessionId,
        account: {account_uuid: accountId},
      };
    } else {
      cachedAuth = await pollForToken();
      if (currentAccountId) {
        accountId = currentAccountId;
        account = {account_uuid: accountId};
      } else {
        // Only reset the account promise if we don't have a valid account yet
        // (allows retry after failure without re-fetching on every cache miss)
        if (!accountId) {
          accountPromise = null;
        }
        account = await getAccount(cachedAuth);
        accountId = account?.account_uuid;
      }
      lastAuthRequest = Date.now();
      return {
        token: cachedAuth.token,
        sessionId: cachedAuth.sessionId,
        account,
      };
    }
  };
}

export const getTokenAndAccount = getTokenAndAccountUtil();
