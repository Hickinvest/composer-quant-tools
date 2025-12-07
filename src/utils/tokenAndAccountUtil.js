import { log } from "./logger.js";

let token;

export function initTokenAndAccountUtil() {
  chrome.storage.local.get(["tokenInfo"], function (result) {
    token = result.tokenInfo?.token;
    log("Token loaded:", token);
  });

  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === "local" && changes.tokenInfo) {
      token = changes?.tokenInfo?.newValue?.token;
      log("Token updated:", token);
    }
  });
}

async function pollForToken() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (token) {
        clearInterval(interval);
        resolve(token);
      }
    }, 100);
  });
}

let accountPromise;

// getAccount will poll for selectedAccount every 200ms until it is found (So it could run indefinitely if the account is never found)
function getAccount(token) {
  if (!accountPromise) {
    accountPromise = new Promise(async (resolve) => {
      try {
        const resp = await fetch(
          "https://stagehand-api.composer.trade/api/v1/accounts/list",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
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
  let token;
  let account;
  let accountId;
  return async function getTokenAndAccount() {
    const accountInfo = getAccountInfoFromLocalStorage();
    // get the latest account type every time and invalidate the cache if it has changed
    const currentAccountId = accountInfo['account-id'];

    // Check if we have a valid cached token and account (within 20 minutes)
    const cacheValid = lastAuthRequest && (Date.now() - lastAuthRequest < 20 * 60 * 1000);

    if (token && accountId && cacheValid && currentAccountId === accountId) {
      return {
        token,
        account: {account_uuid: accountId},
      };
    } else {
      token = await pollForToken();

      // Try to use currentAccountId from localStorage, otherwise fetch account
      if (currentAccountId) {
        accountId = currentAccountId;
        account = {account_uuid: accountId};
        log("Using account from localStorage:", accountId);
      } else {
        // Reset the promise so we can try again
        accountPromise = null;
        account = await getAccount(token);
        accountId = account?.account_uuid;
      }

      if (!accountId) {
        log("Could not determine account ID");
      }

      lastAuthRequest = Date.now();
      return {
        token,
        account,
      };
    }
  };
}

export const getTokenAndAccount = getTokenAndAccountUtil();
