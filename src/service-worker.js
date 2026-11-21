import { automateOpenWebUI } from "./page-automation.js";
import { normalizeWebUiUrl } from "./url.js";

const PERMISSION_TIMEOUT_MS = 120_000;
const TAB_LOAD_TIMEOUT_MS = 45_000;
const UI_READY_TIMEOUT_MS = 30_000;
const SEND_CONFIRM_TIMEOUT_MS = 8_000;
const FAILED_JOB_TTL_MS = 10 * 60_000;
const KEEP_ALIVE_MS = 20_000;

const ERROR_MESSAGES = {
  permission_denied: "未取得此網站的存取權限，問題尚未送出。",
  permission_timeout: "等待網站權限逾時，問題尚未送出。",
  setup_failed: "無法準備此請求，問題尚未送出。",
  tab_create_failed: "無法開啟新分頁，問題尚未送出。",
  tab_closed: "Open WebUI 分頁已被關閉，問題尚未確認送出。",
  load_timeout: "頁面載入逾時，問題尚未送出。",
  load_failed: "無法載入 Open WebUI，請確認網址與伺服器狀態。",
  wrong_origin: "頁面被導向其他網站，可能需要登入。為了安全，問題尚未送出。",
  login_required: "尚未登入 Open WebUI。請在該分頁登入後重試。",
  input_not_found: "找不到可辨識的 Open WebUI 輸入框，問題尚未送出。",
  input_not_empty: "輸入框已有內容，為避免覆蓋，問題尚未送出。",
  fill_failed: "無法可靠地填入問題，問題尚未送出。",
  send_button_not_found: "找不到可辨識的送出按鈕，問題尚未送出。",
  send_unconfirmed: "已嘗試送出，但無法確認成功。重試前請先檢查分頁，避免重複送出。",
  page_lost: "頁面在處理中被重新載入，無法確認是否送出。重試前請先檢查分頁。",
  page_busy: "此分頁正在處理其他請求，問題尚未送出。",
  internal_error: "發生未預期的錯誤，無法確認是否送出。重試前請先檢查分頁。",
};

/** Questions live only in this in-memory map and are never persisted. */
const jobs = new Map();
const ports = new Set();
let keepAliveTimer = null;

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    question: job.state === "failed" ? job.question : undefined,
    url: job.url,
    code: job.code,
    error: job.error,
    detail: job.detail,
    hasTab: job.tabId != null,
  };
}

function inFlightCount() {
  return [...jobs.values()].filter((job) => job.state !== "failed" && job.state !== "succeeded")
    .length;
}

function postSnapshot(port) {
  const failed = [...jobs.values()].find((job) => job.state === "failed");
  port.postMessage({
    type: "snapshot",
    job: failed ? publicJob(failed) : null,
    inFlight: inFlightCount(),
  });
}

function broadcast(job) {
  for (const port of ports) {
    try {
      port.postMessage({ type: "job", job: publicJob(job), inFlight: inFlightCount() });
    } catch {
      ports.delete(port);
    }
  }
}

function refreshBadge() {
  const failed = [...jobs.values()].filter((job) => job.state === "failed").length;
  chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
  chrome.action.setBadgeText({ text: failed ? String(failed) : "" });
}

/** Extension API calls reset the worker idle timer while a job is in memory. */
function refreshKeepAlive() {
  if (jobs.size && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(), KEEP_ALIVE_MS);
  } else if (!jobs.size && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function removeJob(job) {
  clearTimeout(job.timer);
  jobs.delete(job.id);
  refreshBadge();
  refreshKeepAlive();
}

function setState(job, state) {
  job.state = state;
  broadcast(job);
}

function failJob(job, code, detail) {
  if (!jobs.has(job.id) || job.state === "failed" || job.state === "succeeded") return;
  clearTimeout(job.timer);
  job.code = code;
  job.error = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error;
  job.detail = detail;
  job.timer = setTimeout(() => removeJob(job), FAILED_JOB_TTL_MS);
  setState(job, "failed");
  refreshBadge();
}

async function succeedJob(job) {
  clearTimeout(job.timer);
  job.question = "";
  setState(job, "succeeded");
  removeJob(job);
  try {
    const tab = await chrome.tabs.update(job.tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // The question was sent; losing focus on a closed tab is not a failure.
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const done = (tab) => {
      cleanup();
      resolve(tab);
    };
    const onUpdated = (id, change, tab) => {
      if (id === tabId && change.status === "complete" && tab.url !== "about:blank") done(tab);
    };
    const onRemoved = (id) => {
      if (id !== tabId) return;
      cleanup();
      reject(new JobError("tab_closed"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new JobError("load_timeout"));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete" && tab.url && tab.url !== "about:blank") done(tab);
      })
      .catch(() => {
        cleanup();
        reject(new JobError("tab_closed"));
      });
  });
}

class JobError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function tabOrigin(tab) {
  try {
    return new URL(tab.url).origin;
  } catch {
    return null;
  }
}

function classifyInjectionError(error) {
  const message = String(error?.message ?? error);
  if (/error page/i.test(message)) return "load_failed";
  if (/no tab with id/i.test(message)) return "tab_closed";
  if (/cannot access|must request permission/i.test(message)) return "wrong_origin";
  return "page_lost";
}

async function runJob(job) {
  if (job.state !== "awaiting_permission") return;
  clearTimeout(job.timer);
  setState(job, "opening");

  try {
    let tab;
    try {
      // An active tab would close the popup before it can show progress.
      tab = await chrome.tabs.create({ url: job.url, active: false });
    } catch {
      throw new JobError("tab_create_failed");
    }
    job.tabId = tab.id;
    setState(job, "loading");

    const loaded = await waitForTabComplete(tab.id, TAB_LOAD_TIMEOUT_MS);
    if (tabOrigin(loaded) !== job.origin) throw new JobError("wrong_origin");

    setState(job, "sending");
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: "ISOLATED",
        func: automateOpenWebUI,
        args: [
          {
            jobId: job.id,
            question: job.question,
            expectedOrigin: job.origin,
            readyTimeoutMs: UI_READY_TIMEOUT_MS,
            confirmTimeoutMs: SEND_CONFIRM_TIMEOUT_MS,
          },
        ],
      });
    } catch (error) {
      throw new JobError(classifyInjectionError(error));
    }

    const result = results?.[0]?.result;
    if (!result) throw new JobError("page_lost");
    if (!result.ok) throw new JobError(result.code, result.detail);
    await succeedJob(job);
  } catch (error) {
    failJob(job, error instanceof JobError ? error.code : "internal_error", error?.detail);
  }
}

async function handleSubmit(message) {
  if (jobs.has(message.jobId)) return;
  const normalized = normalizeWebUiUrl(message.url);
  const question = String(message.question ?? "");
  if (!normalized.ok || !question.trim()) return;

  const job = {
    id: message.jobId,
    question,
    url: normalized.url,
    origin: normalized.origin,
    permissionPattern: normalized.permissionPattern,
    state: "awaiting_permission",
    tabId: null,
    timer: null,
  };
  jobs.set(job.id, job);
  refreshKeepAlive();
  broadcast(job);
  job.timer = setTimeout(() => failJob(job, "permission_timeout"), PERMISSION_TIMEOUT_MS);

  let granted;
  try {
    await chrome.storage.local.set({ webUiUrl: normalized.url });
    granted = await chrome.permissions.contains({ origins: [job.permissionPattern] });
  } catch {
    failJob(job, "setup_failed");
    return;
  }
  if (granted) await runJob(job);
}

chrome.permissions.onAdded.addListener(async () => {
  for (const job of [...jobs.values()]) {
    if (
      job.state === "awaiting_permission" &&
      (await chrome.permissions.contains({ origins: [job.permissionPattern] }))
    ) {
      runJob(job);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const job of jobs.values()) {
    if (job.tabId !== tabId) continue;
    if (job.state === "failed") {
      job.tabId = null;
      broadcast(job);
    } else {
      failJob(job, "tab_closed");
    }
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup" || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));

  postSnapshot(port);

  port.onMessage.addListener(async (message) => {
    const job = jobs.get(message.jobId);
    switch (message.type) {
      case "submit":
        await handleSubmit(message);
        break;
      case "permission-result":
        if (job?.state === "awaiting_permission") {
          if (message.granted) await runJob(job);
          else failJob(job, "permission_denied");
        }
        break;
      case "dismiss":
        if (job?.state === "failed") {
          removeJob(job);
          postSnapshot(port);
        }
        break;
      case "focus-tab":
        if (job?.tabId != null) {
          try {
            const tab = await chrome.tabs.update(job.tabId, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });
          } catch {
            job.tabId = null;
            broadcast(job);
          }
        }
        break;
    }
  });
});

// The badge outlives the worker, while the in-memory job list does not.
refreshBadge();
