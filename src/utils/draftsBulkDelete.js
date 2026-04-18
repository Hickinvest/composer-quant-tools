// Bulk-delete for the Drafts page.
// - Adds a checkbox to each row + a master checkbox in the header
// - Adds a toolbar above the table with:
//     "Select all 'Copy of…' drafts" button — selects rows whose name starts
//     with "Copy of" (case-insensitive, ignores rows starting with "SAVE")
//     "Delete selected (N)" button — clicks each row's trash → confirms delete
//       sequentially with short delays

import { log } from "./logger.js";

let pollInterval = null;
let observer = null;
let currentTable = null;
let deleteInProgress = false;

// The exact SVG path Composer uses for the trash icon (from user-supplied HTML)
const TRASH_PATH_SIG = "M216,48H176";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function getDraftsTable() {
  const tables = document.querySelectorAll("table");
  for (const table of tables) {
    const thead = table.querySelector("thead");
    if (!thead) continue;
    const headerText = (thead.textContent || "").toLowerCase();
    const hasTrashButton = !!findAnyTrashButton(table);
    if (
      headerText.includes("name") &&
      headerText.includes("created") &&
      headerText.includes("last modified") &&
      hasTrashButton
    ) {
      return table;
    }
  }
  return null;
}

function findAnyTrashButton(root) {
  const svgs = root.querySelectorAll("svg path");
  for (const path of svgs) {
    const d = path.getAttribute("d") || "";
    if (d.startsWith(TRASH_PATH_SIG)) {
      return path.closest("button");
    }
  }
  return null;
}

function findTrashButton(row) {
  const svgs = row.querySelectorAll("svg path");
  for (const path of svgs) {
    const d = path.getAttribute("d") || "";
    if (d.startsWith(TRASH_PATH_SIG)) {
      return path.closest("button");
    }
  }
  return null;
}

function getRowName(row) {
  // Name lives in the first non-checkbox cell. It's typically "Copy of X"
  // followed by a "Trading: TKR1, TKR2, …" subtext line with no newline
  // separator, so we split off the ticker subtext explicitly.
  const cells = row.querySelectorAll(":scope > td");
  for (const cell of cells) {
    if (cell.classList.contains("cqt-checkbox-col")) continue;
    const txt = (cell.textContent || "").trim();
    if (!txt) continue;
    // Skip cells that are just button labels or dates
    if (/^(Buy|Watch)$/i.test(txt)) continue;
    if (/^[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}$/.test(txt)) continue;
    // Strip the "Trading: …" ticker list that lives in the same cell
    const beforeTrading = txt.split(/\s*Trading:/i)[0].trim();
    return beforeTrading || txt.split("\n")[0].trim();
  }
  return "";
}

// Extract the symphony ID from any /symphony/{id} link inside the row.
// Used as a stable identity for matching rows across React re-renders.
function getRowSymphonyId(row) {
  const link = row.querySelector("a[href*='/symphony/']");
  if (!link) return null;
  const m = (link.getAttribute("href") || link.href || "").match(/\/symphony\/([^/?#]+)/);
  return m ? m[1] : null;
}

function findRowBySymphonyId(table, id) {
  if (!id) return null;
  const tbody = table.querySelector("tbody");
  if (!tbody) return null;
  for (const row of tbody.querySelectorAll(":scope > tr")) {
    if (getRowSymphonyId(row) === id) return row;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checkbox injection
// ---------------------------------------------------------------------------

function ensureCheckboxColumn(table) {
  const thead = table.querySelector("thead tr");
  const tbody = table.querySelector("tbody");
  if (!thead || !tbody) return;

  // Header cell
  if (!thead.querySelector("th.cqt-checkbox-col")) {
    const th = document.createElement("th");
    th.className = "cqt-checkbox-col";
    th.style.cssText = "width:32px;padding:0 4px;";
    const master = document.createElement("input");
    master.type = "checkbox";
    master.className = "cqt-master-checkbox";
    master.title = "Select all";
    master.style.cssText = "cursor:pointer;";
    master.addEventListener("click", (e) => {
      e.stopPropagation();
      const checked = master.checked;
      tbody
        .querySelectorAll("input.cqt-row-checkbox")
        .forEach((cb) => (cb.checked = checked));
      updateDeleteButtonLabel();
    });
    th.appendChild(master);
    thead.insertBefore(th, thead.firstChild);
  }

  // Row cells
  const rows = tbody.querySelectorAll("tr");
  rows.forEach((row) => {
    if (row.querySelector("td.cqt-checkbox-col")) return;
    // Skip rows that don't have a trash button (not a real draft row)
    if (!findTrashButton(row)) return;

    const td = document.createElement("td");
    td.className = "cqt-checkbox-col";
    td.style.cssText = "width:32px;padding:0 4px;text-align:center;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cqt-row-checkbox";
    cb.style.cssText = "cursor:pointer;";
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      updateDeleteButtonLabel();
    });
    td.appendChild(cb);
    row.insertBefore(td, row.firstChild);
  });
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function ensureToolbar(table) {
  let toolbar = document.getElementById("cqt-drafts-toolbar");
  if (toolbar) return toolbar;

  toolbar = document.createElement("div");
  toolbar.id = "cqt-drafts-toolbar";
  toolbar.style.cssText =
    "display:flex;gap:8px;align-items:center;padding:8px 12px;margin:8px 0;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;";

  const selectCopyBtn = document.createElement("button");
  selectCopyBtn.type = "button";
  selectCopyBtn.textContent = 'Select all "Copy of…" drafts';
  selectCopyBtn.style.cssText =
    "padding:6px 12px;border:1px solid #D1D5DB;background:white;border-radius:4px;cursor:pointer;";
  selectCopyBtn.addEventListener("click", () => {
    const t = getDraftsTable();
    if (t) selectCopyOfDrafts(t);
  });

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "Clear";
  clearBtn.style.cssText =
    "padding:6px 12px;border:1px solid #D1D5DB;background:white;border-radius:4px;cursor:pointer;";
  clearBtn.addEventListener("click", () => {
    const t = getDraftsTable();
    if (!t) return;
    t.querySelectorAll("input.cqt-row-checkbox, input.cqt-master-checkbox").forEach(
      (cb) => (cb.checked = false)
    );
    updateDeleteButtonLabel();
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.id = "cqt-delete-selected-btn";
  deleteBtn.textContent = "Delete selected (0)";
  deleteBtn.disabled = true;
  deleteBtn.style.cssText =
    "padding:6px 12px;border:1px solid #DC2626;background:#EF4444;color:white;border-radius:4px;cursor:pointer;margin-left:auto;";
  deleteBtn.addEventListener("click", () => {
    const t = getDraftsTable();
    if (t) runBulkDelete(t);
  });

  const status = document.createElement("span");
  status.id = "cqt-bulk-status";
  status.style.cssText = "color:#6B7280;margin-left:8px;";

  toolbar.appendChild(selectCopyBtn);
  toolbar.appendChild(clearBtn);
  toolbar.appendChild(status);
  toolbar.appendChild(deleteBtn);

  table.parentElement?.insertBefore(toolbar, table);
  return toolbar;
}

function getSelectedRows(table) {
  const tbody = table.querySelector("tbody");
  if (!tbody) return [];
  const rows = [];
  tbody.querySelectorAll("tr").forEach((row) => {
    const cb = row.querySelector("input.cqt-row-checkbox");
    if (cb?.checked) rows.push(row);
  });
  return rows;
}

function updateDeleteButtonLabel() {
  const btn = document.getElementById("cqt-delete-selected-btn");
  if (!btn || !currentTable) return;
  const count = getSelectedRows(currentTable).length;
  btn.textContent = `Delete selected (${count})`;
  btn.disabled = count === 0 || deleteInProgress;
  btn.style.opacity = btn.disabled ? "0.5" : "1";
}

function setStatus(text) {
  const s = document.getElementById("cqt-bulk-status");
  if (s) s.textContent = text || "";
}

// ---------------------------------------------------------------------------
// "Copy of…" auto-selection
// ---------------------------------------------------------------------------

function selectCopyOfDrafts(table) {
  // Make sure checkboxes are present on current rows before selecting
  ensureCheckboxColumn(table);

  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  let matched = 0;
  let scanned = 0;
  const samples = [];
  tbody.querySelectorAll(":scope > tr").forEach((row) => {
    const cb = row.querySelector("input.cqt-row-checkbox");
    if (!cb) return;
    scanned++;
    const name = getRowName(row);
    if (samples.length < 3) samples.push(name);
    if (!name) return;
    const lower = name.toLowerCase();
    if (lower.startsWith("save")) return;
    if (lower.startsWith("copy of")) {
      cb.checked = true;
      matched++;
    }
  });
  log(
    `[draftsBulkDelete] select-copy: scanned=${scanned} matched=${matched} sample-names=${JSON.stringify(samples)}`
  );
  updateDeleteButtonLabel();
  setStatus(
    matched > 0
      ? `Selected ${matched} "Copy of…" drafts`
      : `No "Copy of…" drafts found (scanned ${scanned} rows — check console for samples)`
  );
}

// ---------------------------------------------------------------------------
// Bulk delete execution
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, timeoutMs = 2000, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function findYesDeleteButton() {
  // Find a visible button with text "Yes, delete"
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    const txt = (btn.textContent || "").trim().toLowerCase();
    if (txt === "yes, delete") return btn;
  }
  return null;
}

// Find and dismiss Composer's "Something went wrong" error popup.
function dismissErrorPopup() {
  const buttons = document.querySelectorAll("button");
  for (const btn of buttons) {
    const t = (btn.textContent || "").trim().toLowerCase();
    if (t === "no, don't delete" || t === "cancel" || t === "close") {
      btn.click();
      return true;
    }
  }
  return false;
}

async function deleteOneBySymphonyId(table, entry) {
  const { id, name } = entry;
  // Re-locate the row each iteration — DOM nodes can be reused by React.
  const row = findRowBySymphonyId(table, id);
  if (!row) return { ok: false, reason: "row-not-found" };

  const trashBtn = findTrashButton(row);
  if (!trashBtn) return { ok: false, reason: "no-trash" };
  trashBtn.click();

  const yesBtn = await waitFor(findYesDeleteButton, 2500);
  if (!yesBtn) return { ok: false, reason: "no-confirm" };
  yesBtn.click();

  // Success signal: the row with this symphony ID is no longer in the DOM.
  // We poll directly for that — ignoring dialog close timing, which can
  // happen before React finishes removing the row.
  const rowGone = await waitFor(
    () => findRowBySymphonyId(table, id) === null,
    6000
  );

  if (!rowGone) {
    // Likely hit Composer's "Something went wrong" popup. Dismiss and bail.
    dismissErrorPopup();
    await sleep(300);
    return { ok: false, reason: "row-persisted" };
  }

  // Brief settle so React fully reconciles before the next click.
  await sleep(250);
  return { ok: true, reason: "ok" };
}

function clearAllCheckboxes(table) {
  table
    .querySelectorAll("input.cqt-row-checkbox, input.cqt-master-checkbox")
    .forEach((cb) => (cb.checked = false));
}

async function runBulkDelete(table) {
  if (deleteInProgress) return;
  const selected = getSelectedRows(table);
  if (!selected.length) return;

  // Snapshot stable identity (symphony ID) for each selected row NOW, before
  // anything mutates the DOM. We'll look rows up by ID each iteration so
  // we're immune to React reusing <tr> elements or shuffling content.
  const entries = selected
    .map((r) => ({ id: getRowSymphonyId(r), name: getRowName(r) }))
    .filter((e) => !!e.id);

  const dropped = selected.length - entries.length;
  if (dropped > 0) {
    log(
      `[draftsBulkDelete] ${dropped} selected row(s) had no symphony ID and were skipped`
    );
  }
  if (!entries.length) {
    setStatus("Could not identify selected drafts (no symphony IDs found).");
    return;
  }

  const confirmed = window.confirm(
    `Delete ${entries.length} draft${entries.length === 1 ? "" : "s"}? This cannot be undone.`
  );
  if (!confirmed) return;

  clearAllCheckboxes(table);
  updateDeleteButtonLabel();

  deleteInProgress = true;
  let done = 0;
  let failed = 0;
  for (const entry of entries) {
    done++;
    setStatus(
      `Deleting ${done} of ${entries.length}: ${entry.name.slice(0, 60)}`
    );
    const result = await deleteOneBySymphonyId(table, entry);
    if (!result.ok) {
      failed++;
      log(
        `[draftsBulkDelete] failed: id=${entry.id} "${entry.name}"  reason=${result.reason}`
      );
    }
  }

  deleteInProgress = false;
  setStatus(
    failed
      ? `Deleted ${done - failed} of ${entries.length} (${failed} failed — see console)`
      : `Deleted ${done} draft${done === 1 ? "" : "s"} ✔`
  );
  clearAllCheckboxes(table);
  updateDeleteButtonLabel();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function tick() {
  const table = getDraftsTable();
  if (!table) return;

  currentTable = table;
  ensureToolbar(table);
  ensureCheckboxColumn(table);
  updateDeleteButtonLabel();

  if (!observer) {
    // Re-inject checkboxes after React re-renders rows (e.g. after deletes)
    observer = new MutationObserver(() => {
      if (deleteInProgress) return;
      ensureCheckboxColumn(table);
      updateDeleteButtonLabel();
    });
    observer.observe(table.querySelector("tbody") || table, {
      childList: true,
      subtree: false,
    });
  }
}

export function initDraftsBulkDeleteModule() {
  log("[draftsBulkDelete] module init");
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(tick, 1000);
  window.addEventListener("unload", () => {
    if (pollInterval) clearInterval(pollInterval);
    if (observer) observer.disconnect();
  });
}
