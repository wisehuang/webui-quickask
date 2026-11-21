/**
 * Runs inside the target tab through chrome.scripting.executeScript.
 * Chrome serializes this function, so it must not reference outer scope.
 *
 * @param {{jobId: string, question: string, expectedOrigin: string,
 *   readyTimeoutMs: number, confirmTimeoutMs: number}} options
 * @returns {Promise<{ok: true} | {ok: false, code: string, detail?: string}>}
 */
export async function automateOpenWebUI({
  jobId,
  question,
  expectedOrigin,
  readyTimeoutMs,
  confirmTimeoutMs,
}) {
  const INPUT_ID = "chat-input";
  const SEND_BUTTON_ID = "send-message-button";

  const fail = (code, detail) => ({ ok: false, code, detail });
  const comparable = (text) => String(text ?? "").replace(/\s+/g, "");
  const isVisible = (element) =>
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden";

  if (location.origin !== expectedOrigin) return fail("wrong_origin");

  // The isolated world survives for the document, so this blocks a second run.
  if (window.__webUiQuickAskJobId) return fail("page_busy");
  window.__webUiQuickAskJobId = jobId;

  const waitFor = (probe, timeoutMs) =>
    new Promise((resolve) => {
      let settled = false;
      let observer;
      let interval;
      let timeout;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        clearInterval(interval);
        clearTimeout(timeout);
        resolve(value);
      };
      const check = () => {
        const value = probe();
        if (value) finish(value);
      };
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      // Background tabs can delay observer-driven UI work, so also poll.
      interval = setInterval(check, 200);
      timeout = setTimeout(() => finish(null), timeoutMs);
      check();
    });

  const isLoginPage = () =>
    location.pathname === "/auth" ||
    location.pathname.startsWith("/auth/") ||
    [...document.querySelectorAll('input[type="password"]')].some(isVisible);

  const findInput = () => {
    const matches = document.querySelectorAll(`[id="${INPUT_ID}"]`);
    if (matches.length !== 1) return null;
    const element = matches[0];
    const editable =
      (element instanceof HTMLTextAreaElement &&
        !element.disabled &&
        !element.readOnly) ||
      element.isContentEditable;
    return editable && isVisible(element) && element.closest("form")
      ? element
      : null;
  };

  const readInput = (element) =>
    element instanceof HTMLTextAreaElement
      ? element.value
      : element.innerText ?? element.textContent;

  const findSendButton = (input) => {
    const matches = document.querySelectorAll(`[id="${SEND_BUTTON_ID}"]`);
    if (matches.length !== 1) return null;
    const button = matches[0];
    return button instanceof HTMLButtonElement &&
      button.type === "submit" &&
      !button.disabled &&
      isVisible(button) &&
      button.form === input.closest("form")
      ? button
      : null;
  };

  const fillInput = (element) => {
    element.focus();
    if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(element, question);
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: question,
          inputType: "insertText",
        }),
      );
    } else {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      const data = new DataTransfer();
      data.setData("text/plain", question);
      const pasteHandled = !element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
      // An editor may consume paste without preventDefault; never insert twice.
      if (!pasteHandled && !comparable(readInput(element))) {
        document.execCommand("insertText", false, question);
      }
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const ready = await waitFor(() => {
    if (isLoginPage()) return { login: true };
    const input = findInput();
    return input ? { input } : null;
  }, readyTimeoutMs);

  if (!ready) return fail("input_not_found");
  if (ready.login) return fail("login_required");

  const { input } = ready;
  if (comparable(readInput(input))) return fail("input_not_empty");

  fillInput(input);
  const filled = await waitFor(
    () => comparable(readInput(input)) === comparable(question),
    3000,
  );
  if (!filled) return fail("fill_failed");

  const button = await waitFor(() => findSendButton(input), 5000);
  if (!button) return fail("send_button_not_found");

  const earlierToasts = new Set(document.querySelectorAll("[data-sonner-toast]"));
  button.click();

  // Toasts disappear after a few seconds, so remember the latest new one.
  let toastText = "";
  const accepted = await waitFor(() => {
    const toast = [...document.querySelectorAll("[data-sonner-toast]")].find(
      (element) => !earlierToasts.has(element),
    );
    toastText = toast?.textContent?.trim().slice(0, 160) || toastText;
    if (toastText || isLoginPage()) return false;
    // A missing input can mean an error screen, so it never counts as success.
    const current = document.getElementById(INPUT_ID);
    return Boolean(current) && !comparable(readInput(current));
  }, confirmTimeoutMs);
  if (accepted) return { ok: true };

  return fail("send_unconfirmed", toastText || undefined);
}
