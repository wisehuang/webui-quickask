import { normalizeWebUiUrl } from "../src/url.js";

const form = document.getElementById("form");
const urlInput = document.getElementById("url");
const questionInput = document.getElementById("question");
const statusLine = document.getElementById("status");
const submitButton = document.getElementById("submit");
const openTabButton = document.getElementById("open-tab");
const dismissButton = document.getElementById("dismiss");

const PROGRESS_TEXT = {
  awaiting_permission: "等待網站存取權限…",
  opening: "正在開啟 Open WebUI…",
  loading: "正在載入頁面…",
  sending: "正在填入並送出問題…",
};

const port = chrome.runtime.connect({ name: "popup" });
let activeJobId = null;
let failedJob = null;
let busy = false;
let inFlight = 0;
const touched = new Set();

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

function validate() {
  const url = normalizeWebUiUrl(urlInput.value);
  const hasQuestion = questionInput.value.trim().length > 0;
  let message = "";
  if (!url.ok) message = url.error;
  else if (!hasQuestion) message = "請輸入問題。";

  urlInput.setAttribute(
    "aria-invalid",
    String(!url.ok && urlInput.value.trim().length > 0),
  );
  submitButton.disabled = busy || !url.ok || !hasQuestion;
  return { url, message };
}

function refresh() {
  const { url, message } = validate();
  if (busy) return;
  const badUrl = !url.ok && urlInput.value.trim().length > 0;
  if (failedJob && !badUrl) return;
  if (!badUrl && inFlight > 0) {
    setStatus(`另有 ${inFlight} 個請求處理中，請勿重複送出。`);
    return;
  }
  const field = url.ok ? questionInput : urlInput;
  setStatus(message, message && (badUrl || touched.has(field)) ? "error" : "");
}

function setBusy(value) {
  busy = value;
  urlInput.disabled = value;
  questionInput.disabled = value;
  validate();
}

function showFailure(job) {
  failedJob = job;
  activeJobId = job.id;
  setBusy(false);
  if (job.question && !questionInput.value) questionInput.value = job.question;
  if (job.url) urlInput.value = job.url;
  setStatus(job.detail ? `${job.error}（${job.detail}）` : job.error, "error");
  openTabButton.hidden = !job.hasTab;
  dismissButton.hidden = false;
  validate();
}

function clearFailure() {
  if (failedJob) port.postMessage({ type: "dismiss", jobId: failedJob.id });
  failedJob = null;
  openTabButton.hidden = true;
  dismissButton.hidden = true;
}

function handleJob(job) {
  if (job.id !== activeJobId) {
    // Adopt a background failure only when it cannot replace the user's draft.
    if (job.state === "failed" && !busy && !failedJob && !questionInput.value) showFailure(job);
    else if (!busy && !failedJob) refresh();
    return;
  }
  if (job.state === "failed") {
    showFailure(job);
  } else if (job.state === "succeeded") {
    setStatus("已送出。", "ok");
    setTimeout(() => window.close(), 300);
  } else {
    setStatus(PROGRESS_TEXT[job.state] ?? "處理中…");
  }
}

port.onMessage.addListener((message) => {
  if (typeof message.inFlight === "number") inFlight = message.inFlight;
  if (message.type === "snapshot") {
    if (message.job && !busy) showFailure(message.job);
    else refresh();
  }
  if (message.type === "job") handleJob(message.job);
});

port.onDisconnect.addListener(() => {
  if (!busy) return;
  setBusy(false);
  setStatus("背景服務已中斷，無法確認是否送出。重試前請先檢查分頁。", "error");
});

function submit() {
  const { url } = validate();
  const question = questionInput.value;
  if (busy || !url.ok || !question.trim()) return;

  clearFailure();
  const jobId = crypto.randomUUID();
  activeJobId = jobId;
  setBusy(true);
  setStatus(PROGRESS_TEXT.awaiting_permission);
  port.postMessage({ type: "submit", jobId, url: url.url, question });

  // Must run in this click/keydown task to keep Chrome's user gesture.
  chrome.permissions
    .request({ origins: [url.permissionPattern] })
    .then((granted) => port.postMessage({ type: "permission-result", jobId, granted }))
    .catch(() => port.postMessage({ type: "permission-result", jobId, granted: false }));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit();
});

for (const field of [urlInput, questionInput]) {
  field.addEventListener("input", () => {
    touched.add(field);
    refresh();
  });
  field.addEventListener("keydown", (event) => {
    // IME users press Enter to commit composition, which must not submit.
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    submit();
  });
}

openTabButton.addEventListener("click", () => {
  if (failedJob) port.postMessage({ type: "focus-tab", jobId: failedJob.id });
});

dismissButton.addEventListener("click", () => {
  clearFailure();
  activeJobId = null;
  questionInput.value = "";
  refresh();
  questionInput.focus();
});

const { webUiUrl } = await chrome.storage.local.get("webUiUrl");
if (webUiUrl && !urlInput.value) urlInput.value = webUiUrl;
refresh();
if (urlInput.value) questionInput.focus();
else urlInput.focus();
