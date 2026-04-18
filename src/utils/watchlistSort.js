// Adds sort functionality and a "Show all" mode to the watchlist page.
//
// Problem Composer's watchlist has:
//   - Pagination is server-side (20 rows per page), so clicking a sort arrow
//     only sorts the visible page.
//   - "Today's Change" has no sort arrow at all.
//
// What this module adds:
//   - A small "Show all" toggle button inside the Today's Change header cell.
//     Click it once → fetch the full watchlist + current quotes, render every
//     symphony in one scrolling tbody, hide Composer's pagination. Click
//     again → revert to Composer's paginated view.
//   - A sort arrow on Today's Change (which Composer doesn't render).
//   - While "Show all" is active, clicks on ANY column header sort our rows
//     client-side using the raw API values. Click the same header again to
//     toggle asc/desc.
//
// Uses only endpoints Composer already calls (backtest-api/v1/watchlist,
// stagehand-api/v1/public/quotes) and the extension's existing
// getTokenAndAccount helper. No new permissions needed.

import { log } from "./logger.js";
import { getTokenAndAccount, buildHeaders } from "./tokenAndAccountUtil.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let showAllActive = false;
let watchlistCache = null;
let watchlistCacheTime = 0;
let currentSortKey = null; // normalized column key, e.g. "todayschange"
let currentSortDir = "desc"; // 'asc' | 'desc'
let sortedSymphonies = [];
let originalTbody = null;
let customTbody = null;
let stashedPagination = [];
let observer = null;
let pollInterval = null;
let isApplyingDomChange = false;

const WATCHLIST_CACHE_TTL = 5 * 60 * 1000;
const TODAYS_CHANGE_RE = /today.{0,3}s\s+change/i;
const WATCHED_SINCE_RE = /watched\s+since/i;

// ---------------------------------------------------------------------------
// Column mapping. Keys are derived from header text via headerKey().
// ---------------------------------------------------------------------------

const COLUMN_VALUE_GETTERS = {
  name: (s) => (s.name || "").toLowerCase(),
  todayschange: (s) => (typeof s._todaysChange === "number" ? s._todaysChange : null),
  watchedsince: (s) => (s.watched_since ? new Date(s.watched_since).getTime() : null),
  outofsampledate: () => null, // not in watchlist API
  annualizedreturn: (s) => s.annualized_rate_of_return ?? null,
  cumulativereturn: (s) => s.simple_return ?? null,
  sharperatio: (s) => s.sharpe_ratio ?? null,
  calmarratio: (s) => s.calmar_ratio ?? null,
  standarddeviation: (s) => s.standard_deviation ?? null,
  maxdrawdown: (s) => s.max_drawdown ?? null,
  trailing1mreturn: (s) => s.trailing_one_month_return ?? null,
  trailing3mreturn: (s) => s.trailing_three_month_return ?? null,
};

function headerKey(text) {
  return (text || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function getWatchlistTable() {
  const tables = document.querySelectorAll("table");
  for (const table of tables) {
    const thead = table.querySelector("thead");
    if (!thead) continue;
    const text = thead.textContent || "";
    if (TODAYS_CHANGE_RE.test(text) && WATCHED_SINCE_RE.test(text)) {
      return table;
    }
  }
  return null;
}

function findTodaysChangeHeader(table) {
  const headers = table.querySelectorAll("thead th");
  for (const th of headers) {
    if (TODAYS_CHANGE_RE.test(th.textContent || "")) return th;
  }
  return null;
}

function buildColumnIndexMap(table) {
  const headers = Array.from(table.querySelectorAll("thead th"));
  const map = {};
  headers.forEach((th, i) => {
    const key = headerKey(th.textContent);
    if (key && COLUMN_VALUE_GETTERS[key]) {
      map[key] = i;
    }
  });
  return map;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchWatchlist() {
  const now = Date.now();
  if (watchlistCache && now - watchlistCacheTime < WATCHLIST_CACHE_TTL) {
    return watchlistCache;
  }
  const { token, sessionId } = await getTokenAndAccount();
  const resp = await fetch(
    "https://backtest-api.composer.trade/api/v1/watchlist",
    { headers: buildHeaders(token, sessionId) }
  );
  if (!resp.ok) throw new Error(`watchlist HTTP ${resp.status}`);
  const data = await resp.json();
  watchlistCache = data;
  watchlistCacheTime = now;
  return data;
}

async function fetchQuotesChunk(tickers, token, sessionId) {
  const resp = await fetch(
    "https://stagehand-api.composer.trade/api/v1/public/quotes",
    {
      method: "POST",
      headers: {
        ...buildHeaders(token, sessionId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tickers }),
    }
  );
  if (!resp.ok) throw new Error(`quotes HTTP ${resp.status}`);
  return resp.json();
}

async function fetchQuotes(tickers) {
  if (!tickers.length) return {};
  const { token, sessionId } = await getTokenAndAccount();
  // Batch to avoid large POST bodies / server-side limits
  const BATCH_SIZE = 100;
  const merged = {};
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const chunk = tickers.slice(i, i + BATCH_SIZE);
    const res = await fetchQuotesChunk(chunk, token, sessionId);
    Object.assign(merged, res);
  }
  return merged;
}

function collectTickers(symphonies) {
  const set = new Set();
  for (const s of symphonies) {
    const h = s.last_backtest_holdings || {};
    for (const t of Object.keys(h)) {
      if (!t || t === "$USD" || t === "USD") continue;
      set.add(`EQUITIES::${t}//USD`);
    }
  }
  return [...set];
}

function computeTodaysChange(symphony, quotes) {
  const holdings = symphony.last_backtest_holdings || {};
  let totalValue = 0;
  let weightedChangeDollar = 0;
  let anyMatched = false;
  for (const [ticker, value] of Object.entries(holdings)) {
    if (!value || value <= 0) continue;
    if (ticker === "$USD" || ticker === "USD") {
      totalValue += value;
      anyMatched = true;
      continue;
    }
    const qKey = `EQUITIES::${ticker}//USD`;
    const q = quotes[qKey];
    if (!q || !q.price || !q.previous_price) continue;
    const change = (q.price - q.previous_price) / q.previous_price;
    weightedChangeDollar += value * change;
    totalValue += value;
    anyMatched = true;
  }
  if (!anyMatched || totalValue === 0) return null;
  return (weightedChangeDollar / totalValue) * 100;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtPercent(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return `${val.toFixed(decimals)}%`;
}
function fmtRatio(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return val.toFixed(decimals);
}
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch (_) {
    return "—";
  }
}
function fmtTodaysChange(pct) {
  if (pct === null || pct === undefined || isNaN(pct))
    return { text: "—", color: "" };
  const arrow = pct >= 0 ? "↑" : "↓";
  const color = pct >= 0 ? "#16a34a" : "#dc2626";
  return { text: `${arrow} ${Math.abs(pct).toFixed(2)}%`, color };
}

// ---------------------------------------------------------------------------
// Visual: sort arrow + Show-all toggle button
// ---------------------------------------------------------------------------

function buildSortArrows() {
  const wrap = document.createElement("span");
  wrap.className = "cqt-watchlist-sort-arrows";
  wrap.style.cssText =
    "display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;margin-left:4px;vertical-align:middle;";
  wrap.innerHTML = `
    <span class="cqt-arrow-up" style="display:block;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:4px solid rgba(0,0,0,0.25);"></span>
    <span class="cqt-arrow-down" style="display:block;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:4px solid rgba(0,0,0,0.25);"></span>
  `;
  return wrap;
}

function updateArrowForKey(th, key) {
  const up = th.querySelector(".cqt-arrow-up");
  const down = th.querySelector(".cqt-arrow-down");
  if (!up || !down) return;
  const active = currentSortKey === key;
  up.style.borderBottomColor =
    active && currentSortDir === "asc" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.25)";
  down.style.borderTopColor =
    active && currentSortDir === "desc" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.25)";
}

function ensureTodaysChangeArrow(table) {
  const th = findTodaysChangeHeader(table);
  if (!th) return;
  if (!th.querySelector(".cqt-watchlist-sort-arrows")) {
    th.appendChild(buildSortArrows());
  }
  // Tooltip hint so users know clicking will trigger Show all
  const hint = showAllActive
    ? "Click to sort by Today's Change"
    : "Click to load all symphonies and sort by Today's Change (may take a moment)";
  th.title = hint;
  th.style.cursor = "pointer";
  updateArrowForKey(th, "todayschange");
}

function updateActiveArrowOnNativeHeaders(table) {
  // We don't inject arrows into native columns (Composer already has them),
  // but we do mark our own arrow state on Today's Change.
  ensureTodaysChangeArrow(table);
}

function findDisplayDropdown() {
  // Composer's "Display" column chooser sits in the top-right of the watchlist
  // controls. Match by its exact button text.
  const candidates = document.querySelectorAll("button, [role='button']");
  for (const el of candidates) {
    const txt = (el.textContent || "").trim();
    // "Display" possibly followed by dropdown chevron
    if (/^Display\b/i.test(txt) && txt.length < 20) return el;
  }
  return null;
}

function ensureShowAllButton(table) {
  let btn = document.getElementById("cqt-show-all-btn");
  if (btn && btn.isConnected) {
    updateShowAllButtonLabel();
    return btn;
  }
  // Stale / removed — rebuild fresh
  btn = document.createElement("button");
  btn.id = "cqt-show-all-btn";
  btn.type = "button";
  btn.style.cssText = [
    "padding:4px 10px",
    "margin-right:8px",
    "border:1px solid rgba(0,0,0,0.15)",
    "background:white",
    "border-radius:4px",
    "cursor:pointer",
    "font-size:12px",
    "font-weight:500",
    "white-space:nowrap",
    "line-height:1.4",
    "vertical-align:middle",
  ].join(";");
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const t = getWatchlistTable();
    if (t) await toggleShowAll(t);
  });

  // Preferred placement: immediately to the LEFT of Composer's "Display"
  // dropdown in the top-right controls row.
  const displayBtn = findDisplayDropdown();
  if (displayBtn && displayBtn.parentNode) {
    displayBtn.parentNode.insertBefore(btn, displayBtn);
  } else {
    // Fallback: floating toolbar above the table
    let toolbar = document.getElementById("cqt-watchlist-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "cqt-watchlist-toolbar";
      toolbar.style.cssText =
        "display:flex;justify-content:flex-end;padding:6px 0;margin:4px 0;";
      table.parentElement?.insertBefore(toolbar, table);
    }
    toolbar.appendChild(btn);
  }
  updateShowAllButtonLabel();
  return btn;
}

function updateShowAllButtonLabel() {
  const btn = document.getElementById("cqt-show-all-btn");
  if (!btn) return;
  btn.textContent = showAllActive ? "Paginate" : "Show all";
  btn.title = showAllActive
    ? "Restore Composer's paginated view (needed for Buy and Watch actions)"
    : "Load all symphonies in one scrolling list (Buy/Watch buttons disabled while active; click a name to open its side panel)";
  btn.style.background = showAllActive ? "#DBEAFE" : "white";
  btn.style.borderColor = showAllActive ? "#60A5FA" : "rgba(0,0,0,0.15)";
}

function showBanner(table, text) {
  let banner = document.getElementById("cqt-sort-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "cqt-sort-banner";
    banner.style.cssText =
      "padding:8px 16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;margin:8px 0;font-size:13px;color:#1E40AF;";
    table.parentElement?.insertBefore(banner, table);
  }
  banner.textContent = text;
  banner.style.display = "";
}

function hideBanner() {
  const banner = document.getElementById("cqt-sort-banner");
  if (banner) banner.style.display = "none";
}

// ---------------------------------------------------------------------------
// Show-all activation / deactivation
// ---------------------------------------------------------------------------

function hidePaginationControls(table) {
  stashedPagination = [];
  const scope = table.parentElement?.parentElement || document.body;
  const divs = scope.querySelectorAll("div");
  for (const d of divs) {
    const txt = (d.textContent || "").trim();
    if (
      /^\s*Prev\s+Next\s+\d/.test(txt) ||
      /\d+\s+total\s*\|\s*Prev/.test(txt)
    ) {
      if (d.style.display !== "none") {
        stashedPagination.push({ el: d, original: d.style.display });
        d.style.display = "none";
      }
    }
  }
}

function restorePaginationControls() {
  for (const { el, original } of stashedPagination) {
    el.style.display = original || "";
  }
  stashedPagination = [];
}

async function toggleShowAll(table) {
  if (showAllActive) {
    deactivateShowAll();
    return;
  }
  await activateShowAll(table);
}

async function activateShowAll(table) {
  showBanner(table, "Loading all symphonies…");

  let watchlist;
  try {
    watchlist = await fetchWatchlist();
  } catch (e) {
    log("[watchlistSort] watchlist fetch failed:", e);
    showBanner(table, `Could not load watchlist: ${e.message}`);
    return;
  }

  const tickers = collectTickers(watchlist.symphonies);
  let quotes;
  try {
    quotes = await fetchQuotes(tickers);
  } catch (e) {
    log("[watchlistSort] quotes fetch failed:", e);
    showBanner(table, `Could not load quotes: ${e.message}`);
    return;
  }

  for (const s of watchlist.symphonies) {
    s._todaysChange = computeTodaysChange(s, quotes);
  }
  const matched = watchlist.symphonies.filter(
    (s) => typeof s._todaysChange === "number"
  ).length;
  log(
    `[watchlistSort] computed today's change for ${matched}/${watchlist.symphonies.length} symphonies (quote keys: ${Object.keys(quotes).length})`
  );

  sortedSymphonies = [...watchlist.symphonies];
  if (currentSortKey) applyClientSort();

  if (!renderCustomTbody(table)) {
    showBanner(table, "Could not render rows — no template row available.");
    return;
  }
  hidePaginationControls(table);
  showAllActive = true;
  updateShowAllButtonLabel();
  updateActiveArrowOnNativeHeaders(table);

  const sortLabel = currentSortKey ? ` sorted by ${currentSortKey}` : "";
  showBanner(
    table,
    `Showing all ${sortedSymphonies.length} symphonies${sortLabel}. Click any column header to re-sort. Click a name to open its side panel. Click "Paginate" to restore Composer's default view (including Buy and Watch actions).`
  );
}

function deactivateShowAll() {
  isApplyingDomChange = true;
  try {
    if (customTbody && customTbody.parentNode) {
      customTbody.parentNode.removeChild(customTbody);
    }
    if (originalTbody) {
      originalTbody.style.display = "";
    }
  } finally {
    isApplyingDomChange = false;
  }
  restorePaginationControls();
  hideBanner();
  customTbody = null;
  originalTbody = null;
  showAllActive = false;
  currentSortKey = null;
  updateShowAllButtonLabel();
  const table = getWatchlistTable();
  if (table) updateActiveArrowOnNativeHeaders(table);
}

// ---------------------------------------------------------------------------
// Rendering the full tbody
// ---------------------------------------------------------------------------

// Replace the TEXT content of a cell in place — preserves the td's classes
// (padding, alignment, etc.) so row heights match Composer's native styling.
function setCellTextPreserveStyle(cell, text, color) {
  if (!cell) return;
  cell.textContent = "";
  if (color) {
    const span = document.createElement("span");
    span.textContent = text;
    span.style.color = color;
    cell.appendChild(span);
  } else {
    cell.appendChild(document.createTextNode(text));
  }
}

function renderRow(symphony, colMap, templateRow) {
  const tr = templateRow.cloneNode(true);
  const cells = Array.from(tr.children);

  // Name cell: clear the template content and rebuild minimally. The td's own
  // classes (padding, alignment) are preserved because we only touch innerHTML,
  // not the td attributes. No extra wrapping div with padding — that's what
  // inflated row heights in the previous iteration.
  if (colMap.name !== undefined && cells[colMap.name]) {
    const cell = cells[colMap.name];
    cell.innerHTML = "";

    const newName = symphony.name || "(unnamed)";
    const tickers = (symphony.tickers || [])
      .slice(0, 3)
      .map((t) =>
        typeof t === "string" ? t.split("::")[1]?.split("//")[0] || t : t.symbol
      )
      .filter(Boolean);
    const extra = (symphony.tickers || []).length - tickers.length;
    const tradingText = `Trading: ${tickers.join(", ")}${extra > 0 ? `, +${extra}` : ""}`;

    const nameLink = document.createElement("a");
    // Use Composer's own factsheet URL so clicking opens the side panel
    // rather than navigating to the full /symphony page. Intercept the
    // click and push-state so Composer's router re-renders in place.
    nameLink.href = `/watch?factsheet=${symphony.id}`;
    nameLink.textContent = newName;
    nameLink.style.cssText =
      "font-weight:500;color:inherit;text-decoration:none;display:block;line-height:1.2;margin:0;";
    nameLink.onmouseover = () => (nameLink.style.textDecoration = "underline");
    nameLink.onmouseout = () => (nameLink.style.textDecoration = "none");
    nameLink.addEventListener("click", (e) => {
      // Let cmd/ctrl/middle-click open a new tab normally
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      const url = `/watch?factsheet=${symphony.id}`;
      window.history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    const trading = document.createElement("div");
    trading.textContent = tradingText;
    trading.style.cssText =
      "font-size:10px;color:rgba(0,0,0,0.5);line-height:1.2;margin:0;";

    cell.appendChild(nameLink);
    cell.appendChild(trading);
  }

  const { text: tcText, color: tcColor } = fmtTodaysChange(symphony._todaysChange);
  setCellTextPreserveStyle(cells[colMap.todayschange], tcText, tcColor);
  setCellTextPreserveStyle(cells[colMap.watchedsince], fmtDate(symphony.watched_since));
  setCellTextPreserveStyle(cells[colMap.outofsampledate], "—");
  setCellTextPreserveStyle(
    cells[colMap.annualizedreturn],
    fmtPercent((symphony.annualized_rate_of_return ?? 0) * 100, 1)
  );
  setCellTextPreserveStyle(
    cells[colMap.cumulativereturn],
    fmtPercent((symphony.simple_return ?? 0) * 100, 1)
  );
  setCellTextPreserveStyle(cells[colMap.sharperatio], fmtRatio(symphony.sharpe_ratio, 2));
  setCellTextPreserveStyle(cells[colMap.calmarratio], fmtRatio(symphony.calmar_ratio, 2));
  setCellTextPreserveStyle(
    cells[colMap.standarddeviation],
    fmtPercent((symphony.standard_deviation ?? 0) * 100, 1)
  );
  setCellTextPreserveStyle(
    cells[colMap.maxdrawdown],
    fmtPercent((symphony.max_drawdown ?? 0) * 100, 1)
  );
  setCellTextPreserveStyle(
    cells[colMap.trailing1mreturn],
    fmtPercent((symphony.trailing_one_month_return ?? 0) * 100, 1)
  );
  setCellTextPreserveStyle(
    cells[colMap.trailing3mreturn],
    fmtPercent((symphony.trailing_three_month_return ?? 0) * 100, 1)
  );

  tr.dataset.cqtCustomRow = "true";
  return tr;
}

function renderCustomTbody(table) {
  const colMap = buildColumnIndexMap(table);
  const existingTbody = table.querySelector("tbody:not([data-cqt-custom-tbody])");
  if (!existingTbody) return false;
  const templateRow = existingTbody.querySelector("tr");
  if (!templateRow) return false;

  const newTbody = document.createElement("tbody");
  newTbody.dataset.cqtCustomTbody = "true";
  for (const s of sortedSymphonies) {
    try {
      newTbody.appendChild(renderRow(s, colMap, templateRow));
    } catch (e) {
      log("[watchlistSort] render error for", s.id, e);
    }
  }

  isApplyingDomChange = true;
  try {
    originalTbody = existingTbody;
    originalTbody.style.display = "none";
    originalTbody.parentNode.insertBefore(newTbody, originalTbody.nextSibling);
    customTbody = newTbody;
  } finally {
    isApplyingDomChange = false;
  }
  return true;
}

function rerenderCustomTbody(table) {
  if (!customTbody || !customTbody.parentNode) return;
  const colMap = buildColumnIndexMap(table);
  // Prefer the original tbody's first row as template (richest structure);
  // fall back to our own row.
  const templateRow =
    originalTbody?.querySelector("tr") || customTbody.querySelector("tr");
  if (!templateRow) return;

  isApplyingDomChange = true;
  try {
    customTbody.innerHTML = "";
    for (const s of sortedSymphonies) {
      try {
        customTbody.appendChild(renderRow(s, colMap, templateRow));
      } catch (e) {
        log("[watchlistSort] rerender error for", s.id, e);
      }
    }
  } finally {
    isApplyingDomChange = false;
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function applyClientSort() {
  const getter = COLUMN_VALUE_GETTERS[currentSortKey];
  if (!getter) return;
  const dir = currentSortDir === "asc" ? 1 : -1;
  sortedSymphonies.sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return dir * String(va).localeCompare(String(vb));
    }
    return dir * (va - vb);
  });
}

function perPageSortTodaysChange(table) {
  const tbody = table.querySelector("tbody:not([data-cqt-custom-tbody])");
  if (!tbody) return;
  const headers = Array.from(table.querySelectorAll("thead th"));
  const idx = headers.findIndex((th) => TODAYS_CHANGE_RE.test(th.textContent || ""));
  if (idx < 0) return;

  const rows = Array.from(tbody.children).filter((r) => r.tagName === "TR");
  const parse = (txt) => {
    const t = (txt || "").trim();
    if (!t || t === "-" || t === "—") return null;
    const down = t.includes("↓");
    const n = parseFloat(t.replace(/[↑↓%+\s,]/g, ""));
    if (isNaN(n)) return null;
    return down && n > 0 ? -n : n;
  };
  const dir = currentSortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const va = parse(a.querySelectorAll(":scope > td")[idx]?.textContent);
    const vb = parse(b.querySelectorAll(":scope > td")[idx]?.textContent);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return dir * (va - vb);
  });

  isApplyingDomChange = true;
  try {
    rows.forEach((r) => tbody.appendChild(r));
  } finally {
    setTimeout(() => {
      isApplyingDomChange = false;
    }, 200);
  }
}

// ---------------------------------------------------------------------------
// Header click wiring
// ---------------------------------------------------------------------------

function attachHeaderClickHandlers(table) {
  if (table.dataset.cqtHeadersWired === "true") return;
  const thead = table.querySelector("thead");
  if (!thead) return;

  thead.addEventListener(
    "click",
    async (e) => {
      // Our Show-all button handles itself
      if (e.target.closest("#cqt-show-all-btn")) return;

      const th = e.target.closest("th");
      if (!th) return;
      const key = headerKey(th.textContent);
      if (!COLUMN_VALUE_GETTERS[key]) return;

      if (showAllActive) {
        // Sort our rows client-side; don't let Composer re-paginate.
        e.stopPropagation();
        e.preventDefault();
        if (currentSortKey === key) {
          currentSortDir = currentSortDir === "desc" ? "asc" : "desc";
        } else {
          currentSortKey = key;
          currentSortDir = "desc";
        }
        applyClientSort();
        rerenderCustomTbody(table);
        updateActiveArrowOnNativeHeaders(table);
      } else if (key === "todayschange") {
        // Not in show-all mode: clicking Today's Change activates Show-all
        // (since Composer has no sort for this column anyway) and sorts by
        // today's change desc. Subsequent clicks toggle direction.
        e.stopPropagation();
        e.preventDefault();
        currentSortKey = "todayschange";
        currentSortDir = "desc";
        await activateShowAll(table);
      }
      // else: native columns fall through to Composer.
    },
    true // capture phase to beat Composer's bubble-phase listeners
  );

  table.dataset.cqtHeadersWired = "true";
}

// ---------------------------------------------------------------------------
// Observer + lifecycle
// ---------------------------------------------------------------------------

function setupObserver(table) {
  if (observer) return;
  let scheduled = false;
  observer = new MutationObserver(() => {
    if (isApplyingDomChange || scheduled) return;
    scheduled = true;
    // Coalesce many React re-renders into one callback per frame
    requestAnimationFrame(() => {
      scheduled = false;
      if (showAllActive) {
        const currentOriginal = table.querySelector(
          "tbody:not([data-cqt-custom-tbody])"
        );
        if (currentOriginal && currentOriginal.style.display !== "none") {
          isApplyingDomChange = true;
          try {
            originalTbody = currentOriginal;
            originalTbody.style.display = "none";
            if (customTbody && !customTbody.isConnected) {
              originalTbody.parentNode.insertBefore(
                customTbody,
                originalTbody.nextSibling
              );
            }
          } finally {
            isApplyingDomChange = false;
          }
        }
      }
    });
  });
  // Narrow scope: only watch direct children of the table (thead/tbody swaps).
  // We don't need to observe the entire subtree — React makes many inner
  // updates that aren't relevant, and observing all of them burns CPU.
  observer.observe(table, { childList: true, subtree: false });
}

let tickCount = 0;
let cachedTable = null;
function tick() {
  tickCount++;
  // Reuse the cached table if it's still in the DOM — avoids scanning all
  // tables + their thead textContent every second.
  if (!cachedTable || !cachedTable.isConnected) {
    cachedTable = getWatchlistTable();
  }
  const table = cachedTable;
  if (!table) {
    if (tickCount === 5 || tickCount === 30) {
      log(
        `[watchlistSort] tick ${tickCount}: no watchlist table yet (path=${location.pathname})`
      );
    }
    return;
  }
  ensureShowAllButton(table);
  ensureTodaysChangeArrow(table);
  attachHeaderClickHandlers(table);
  setupObserver(table);
}

export function initWatchlistSortModule() {
  log("[watchlistSort] module init");
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(tick, 1000);
  window.addEventListener("unload", () => {
    if (pollInterval) clearInterval(pollInterval);
    if (observer) observer.disconnect();
  });
}
