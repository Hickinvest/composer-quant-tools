import { getTokenAndAccount } from "./tokenAndAccountUtil.js";
import { getSymphonyDailyChange, getSymphonyStatsMeta } from "../portfolio.js";
import { log } from "./logger.js";

function isLoggedIn() {
  if (window.location.pathname.endsWith("details")) {
    // details page
    return Boolean(
      document
        .querySelector('a[href="/portfolio"]')
        ?.innerText?.includes?.("Go to Composer")
    );
  }
  // anywhere else
  return true;
}

const waitForFactsheet = async () => {
  const observer = new MutationObserver(async function (
    mutations,
    mutationInstance
  ) {
    let factsheetOpen = document.querySelector(".factsheet-open");
    if (isPathOnDetailsPage()) {
      factsheetOpen = document.getElementById("app");
    }
    // const factsheetClosed = document.querySelector('.factsheet-closed')
    const factsheetGraphNode = factsheetOpen?.querySelector?.("section");

    const widgetAttached = Boolean(
      factsheetOpen?.querySelector?.("#tearsheat-widget")
    );

    if (factsheetOpen && factsheetGraphNode && !widgetAttached) {
      isLoggedIn() && (await getTokenAndAccount()); // this is to cache the token and account
      const exists = factsheetOpen?.querySelector?.("#tearsheat-widget");
      if (exists) {
        return;
      }
      renderTearsheetButton(factsheetOpen);
      // mutationInstance.disconnect(); // we should find a sane place to disconnect and reattatch this
    }
  });
  observer.observe(document, { childList: true, subtree: true });
};

function renderTearsheetButton(factsheet) {
  const graphNode = factsheet?.querySelector?.("section");

  const button = (buttonId, buttonText, func, css) => {
    let button = document.createElement("button");
    button.id = buttonId;
    button.className = `rounded flex border border-asset-border shadow-sm bg-panel-bg divide-x divide-solid divide-asset-border text-sm font-light flex items-center justify-center px-2 py-2 shadow-inner transition focus:outline-none leading-none select-none ${css} text-dark bg-white hover:bg-tab-light`;

    let span = document.createElement("span");
    span.className = "flex items-center space-x-2";

    let text = document.createElement("span");
    text.innerText = buttonText;

    button.addEventListener("click", (e) => {
      func(e);
    });

    span.appendChild(text);
    button.appendChild(span);
    return button;
  };

  function getTearsheet(symphony, backtestData, testType) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "getTearsheet", symphony, backtestData, type: testType },
        (response) => {
          if (response?.error) {
            log(response?.error);
            reject(response.error);
          } else {
            // Create a Blob from the HTML content
            const blob = new Blob([response], { type: "text/html" });
            const url = URL.createObjectURL(blob);

            const downloadLinkHTML = `
              <a 
                 href="${url}" 
                 target="_blank" 
                 style="display: block; margin-left: 20px; margin-top: 6px; color: #007bff;">
                Open QuantStats ${testType} Tearsheet Report
              </a>
            `;

            resolve(downloadLinkHTML);
          }
        }
      );
    });
  }

  async function buildTearsheetButtonClickHandler(testType) {
    // disable buttons while toggling
    const buildTearsheetButton = factsheet?.querySelector?.(
      `#tearsheat-widget #build-${testType}-tearsheet-button`
    );

    setButtonEnabled(buildTearsheetButton, false);
    let originalText = buildTearsheetButton?.innerText;
    buildTearsheetButton.querySelector("span").innerHTML = `
          ${originalText.replace("Build ", "Building ")}
          <div style="height: 27px; margin: -7px 10px;"><svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" class="h-full w-full" style="color: rgb(28, 32, 51);"><rect width="512" height="512" x="0" y="0" rx="0" fill="transparent" stroke="transparent" stroke-width="0" stroke-opacity="100%" paint-order="stroke"></rect><svg width="512px" height="512px" viewBox="0 0 24 24" fill="#1C2033" x="0" y="0" role="img" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;"><g fill="#1C2033"><circle cx="4" cy="12" r="3" fill="currentColor"><animate id="svgSpinners3DotsScale0" attributeName="r" begin="0;svgSpinners3DotsScale1.end-0.25s" dur="0.75s" values="3;.2;3"></animate></circle><circle cx="12" cy="12" r="3" fill="currentColor"><animate attributeName="r" begin="svgSpinners3DotsScale0.end-0.6s" dur="0.75s" values="3;.2;3"></animate></circle><circle cx="20" cy="12" r="3" fill="currentColor"><animate id="svgSpinners3DotsScale1" attributeName="r" begin="svgSpinners3DotsScale0.end-0.45s" dur="0.75s" values="3;.2;3"></animate></circle></g></svg></svg></div>
        `;

    factsheet?.querySelector?.(`.tearsheet-${testType}-link`)?.remove();
    let symphonyName =
      factsheet?.querySelectorAll?.(".items-start")?.[0]?.innerText;

    const backtestData = await getSymphonyBacktest(
      window.active_factsheet_symphonyId
    );
    let symphony = {
      id: window.active_factsheet_symphonyId,
      name: symphonyName,
    };
    if (testType === "live") {
      symphony = {
        ...symphony,
        dailyChanges: await getSymphonyDailyChange(
          window.active_factsheet_symphonyId
        ),
      };
    } else if (testType === "oos") {
      const { token } = (isLoggedIn() && (await getTokenAndAccount())) || {};
      const fetchHeaders = {};
      isLoggedIn() && (fetchHeaders["Authorization"] = `Bearer ${token}`);
      fetchHeaders["accept"] = "application/json";

      symphony = {
        ...symphony,
        ...(await (
          await fetch(
            "https://backtest-api.composer.trade/api/v1/public/symphonies/" +
              window.active_factsheet_symphonyId,
            { headers: fetchHeaders }
          )
        ).json()),
      };
    }

    let downloadLink;
    try {
      downloadLink = await getTearsheet(symphony, backtestData, testType);
    } catch {
      downloadLink = `<span style="display: block; margin-left: 20px; margin-top: 6px;">(error generating ${testType} tearsheet)</span>`;
      // we already logged it
    }

    const linkContainer = document.createElement('div');
    linkContainer.classList.add(`tearsheet-${testType}-link`)
    linkContainer.innerHTML = downloadLink;
    

    buildTearsheetButton.innerHTML = `<span class="flex items-center space-x-2">${originalText}</span>`; // Clear any previous link
    buildTearsheetButton.insertAdjacentElement('afterend', linkContainer);
    setButtonEnabled(buildTearsheetButton, true);
  }

  const hasLiveData = (
    factsheet.querySelector(".max-w-screen-2xl .flex-col")?.innerText || ""
  )?.includes?.("Live");

  const tearsheetContainer = document.createElement("div");
  tearsheetContainer.id = "tearsheat-widget";
  tearsheetContainer.classList.add(
    "border",
    "border-panel-border",
    "rounded-md",
    "shadow-sm",
    "bg-panel-bg",
    "pt-4",
    "pb-5",
    "px-4",
    "space-y-3"
  );

  const buildBackTestTearsheetButton = button(
    "build-backtest-tearsheet-button",
    "Build Backtest Tearsheet",
    () => buildTearsheetButtonClickHandler("backtest"),
    "rounded-tl rounded-bl"
  ); // this is the button that will build the backtest tearsheet
  const backtestTearsheetArea = document.createElement('div')
  backtestTearsheetArea.style.display = 'flex';
  backtestTearsheetArea.appendChild(buildBackTestTearsheetButton);
  tearsheetContainer.appendChild(backtestTearsheetArea);

  if (hasLiveData) {
    const buildLiveTearsheetButton = button(
      "build-live-tearsheet-button",
      "Build Live Tearsheet",
      () => buildTearsheetButtonClickHandler("live"),
      "rounded-tl rounded-bl"
    ); // this is the button that will build the live tearsheet
    const liveTearsheetArea = document.createElement('div')
    liveTearsheetArea.style.display = 'flex';
    liveTearsheetArea.appendChild(buildLiveTearsheetButton);
    tearsheetContainer.appendChild(liveTearsheetArea);
  }

  const buildOOSTearsheetButton = button(
    "build-oos-tearsheet-button",
    "Build OOS Tearsheet",
    () => buildTearsheetButtonClickHandler("oos"),
    "rounded-tl rounded-bl"
  ); // this is the button that will build the live tearsheet
  const oosTearsheetArea = document.createElement('div')
  oosTearsheetArea.style.display = 'flex';
  oosTearsheetArea.appendChild(buildOOSTearsheetButton);
  tearsheetContainer.appendChild(oosTearsheetArea);

  graphNode.appendChild(tearsheetContainer);
}

async function getSymphonyBacktest(symphonyId) {
  let auth;
  if (isLoggedIn()) {
    auth = await getTokenAndAccount();
  }
  const { token, account } = auth || {};

  const fetchHeaders = {};
  isLoggedIn() && (fetchHeaders["Authorization"] = `Bearer ${token}`);
  fetchHeaders["accept"] = "application/json";
  fetchHeaders["Content-Type"] = "application/json";

  const response = await fetch(
    // using public endpoint for backtests when not logged in
    `https://backtest-api.composer.trade/api/v2${
      isLoggedIn() ? "" : "/public"
    }/symphonies/${symphonyId}/backtest`,
    {
      method: "POST",
      body: JSON.stringify({
        capital: 10000,
        apply_reg_fee: true,
        apply_taf_fee: true,
        apply_subscription: "none",
        backtest_version: "v2",
        slippage_percent: 0,
        spread_markup: 0,
        start_date: "1990-01-01", // we were using this "1969-12-31", But that gives us a "backtest-precedes-earliest-available-data" error from the api
        end_date: new Date().toISOString().split("T")[0],
        benchmark_symphonies: [],
        // "benchmark_tickers": [
        //   "SPY"
        // ]
      }),
      headers: fetchHeaders,
    }
  );

  if (response.status !== 200) {
    log(
      `Cannot load backtest data. Backtest endpoint for ${symphonyId} returned a ${response.status} error code.`
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }

  const backtestData = await response.json();
  return backtestData;
}

const setButtonEnabled = (buttonElement, isEnabled) => {
  if (isEnabled) {
    buttonElement.classList.remove("text-dark-soft");
    buttonElement.classList.add("text-dark");
    buttonElement.classList.remove("bg-background");
    buttonElement.classList.add("bg-white");
    buttonElement.classList.remove("hover:bg-tab-light");
    buttonElement.disabled = false;
  } else {
    buttonElement.classList.add("text-dark-soft");
    buttonElement.classList.remove("text-dark");
    buttonElement.classList.add("bg-background");
    buttonElement.classList.remove("bg-white");
    buttonElement.classList.add("hover:bg-tab-light");
    buttonElement.disabled = true;
  }
};

let cachedSymphonyStats;
async function getSymphonyIdFromName(symphonyName) {
  if (!cachedSymphonyStats) {
    try {
      cachedSymphonyStats = await getSymphonyStatsMeta();
    } catch (e) {
      log('error loading symphonies',e);
    }
  }

  if(!cachedSymphonyStats) {
    log('getSymphonyIdFromName no symphonies loaded');
    return;
  }

  const symphony = cachedSymphonyStats.symphonies.find((symphony) =>
    symphony.name.replace("  ", " ").includes(
      symphonyName.replace("  ", " ") // this is a weird discrepancy between the symphony name and the factsheet name there are extra double spaces
    )
  );
  if (!symphony) {
    log(`Symphony ${symphonyName} not found`);
    return;
  }
  return symphony.id;
}

// Helper function to get React props from main world
function getReactProps(selector, propSelector) {
  return new Promise((resolve, reject) => {
    const messageId = Date.now().toString();
    
    // Listen for response from main world
    const listener = function(event) {
      if (event.data.type === 'REACT_PROPS_RESULT' && event.data.id === messageId) {
        window.removeEventListener('message', listener);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.data);
        }
      }
    };
    
    window.addEventListener('message', listener);
    
    // Send request to main world
    window.postMessage({
      type: 'GET_REACT_PROPS',
      element: selector,
      propSelector: propSelector,
      id: messageId
    }, '*');
  });
}

async function handleOpenFactSheet(event) {
  // Check if the clicked element or any of its parents is a tr or table cell

  // the a tag has the id in the href
  // in all other cases we try to get the id from the react props using the dom node
  let clickedTableRow = event.target.closest("tbody tr");
  // log(clickedTableRow, 'clicked')

  // if the clicked element is not a table row, do nothing
  if(!clickedTableRow) {
    return
  }

  let clickedRowAnchor = clickedTableRow.querySelector("a");

  if (clickedRowAnchor) {
    window.active_factsheet_symphonyId = clickedRowAnchor?.href?.split?.("/")?.[4];
  } else if (clickedTableRow?.tagName === 'TR') {
    try {
      // Add a unique class to the clicked row
      const uniqueClass = `symphony-row-${Date.now()}`;
      clickedTableRow.classList.add(uniqueClass);
      
      // Get React props from the main world using the unique class
      const symphonyId = await getReactProps(`.${uniqueClass}`, 'child.pendingProps.row.original.id');
      
      // Remove the unique class after we're done
      clickedTableRow.classList.remove(uniqueClass);
      
      if (symphonyId) {
        window.active_factsheet_symphonyId = symphonyId;
        return;
      }
    } catch (error) {
      log("Error getting React props:", error);
    }
  } else {
    log("Could not find get dom node for symphony id");
  }
}


async function collectSymphonyDataForFactsheet() {
  // Attach the click event listener to the body this will collect the id of the symphony that was clicked
  document.body.addEventListener("click", handleOpenFactSheet);

  if (isPathOnDetailsPage()) {
    // pull the sypmhony id from the url
    window.active_factsheet_symphonyId = window.location.pathname.split("/")[2];
    waitForFactsheet();
  }
}

function isPathOnDetailsPage() {
  return (
    window.location.pathname.startsWith("/symphony") &&
    window.location.pathname.endsWith("/details")
  );
}

function initNavigation() {
  if (
    window.location.pathname === "/portfolio" ||
    window.location.pathname === "/watch" ||
    window.location.pathname === "/discover"
  ) {
    waitForFactsheet();
  }

  window.navigation.addEventListener("navigate", (event) => {
    if (
      event.destination.url === "https://app.composer.trade/portfolio" ||
      event.destination.url === "https://app.composer.trade/watch" ||
      event.destination.url === "https://app.composer.trade/discover"
    ) {
      waitForFactsheet();
    }
  });
}

export function initFactsheet() {
  collectSymphonyDataForFactsheet();
  initNavigation();
}
