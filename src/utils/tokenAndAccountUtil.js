import { log } from "./logger.js";

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
      let data;
      try {
        const headers = {
          Authorization: `Bearer ${token}`,
        };
        if (sessionId) {
          headers["X-Session-Id"] = sessionId;
        }

        const resp = await fetch(
          "https://stagehand-api.composer.trade/api/v1/accounts/list",
          {
            headers: headers,
          },
        );
        data = await resp.json();

        let account;

        while (!account) {
          account = data.accounts.find(
            (account) =>
              account.account_uuid === localStorage.getItem("selectedAccount"),
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if (account) {
          resolve(account);
        } else {
          // Fallback to detecting account type we should remove this at somepoint
          // there is always a chance the localStorage variable will not be used
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
          } else {
            throw new Error(
              "[composer-quant-tools]: Unable to detect account type",
            );
          }
          resolve(account);
        }
      } catch (error) {
        console.error(
          "[composer-quant-tools]: Unable to detect account type with:",
          data || error
        );
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
    // get the latest account type every time and invalidate the cache if it has changed
    const currentAccountId = accountInfo['account-id'];

    if (
      cachedAuth &&
      currentAccountId && 
      (currentAccountId !== accountId || (lastAuthRequest && Date.now() - lastAuthRequest < 20 * 60 * 1000))
    ) {
      accountId = currentAccountId;
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
        account = await getAccount(cachedAuth);
        accountId = account.account_uuid;
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
