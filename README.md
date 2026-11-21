# WebUI QuickAsk

WebUI QuickAsk is a Chrome Manifest V3 extension. Enter a question in its popup, and it opens a new Open WebUI tab, fills in the question, and sends it.

It does not call the Open WebUI API, require an API key, or modify the server. The popup and its messages are in Traditional Chinese.

## File structure

```text
webui-quickask/
├── .gitignore
├── manifest.json
├── README.md
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── src/
    ├── page-automation.js
    ├── service-worker.js
    └── url.js
```

## Installation

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `webui-quickask` folder that contains `manifest.json`.
5. Optionally, pin WebUI QuickAsk to the toolbar.

Requires Chrome 116 or later.

## Usage

1. Sign in to Open WebUI in Chrome and make sure a default model is configured.
2. Click the extension icon.
3. Enter your Open WebUI URL, such as `https://chat.example.com`.
4. Enter a question and press **Enter** or click **Submit**. Press **Shift+Enter** for a new line.
5. The first time you use a site, allow access in Chrome's permission dialog.

After a successful send, the extension switches to the new tab and closes the popup. If something fails, the popup shows the reason and keeps your question. If the popup has already closed, the toolbar icon shows a red count. Reopen the popup to see the question.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `scripting` | Fill in and send the question in the WebUI tab you specified |
| `storage` | Store only the normalized WebUI URL |
| Optional host permission | Request access, when needed, to the single site you entered, including its port |

- Questions stay in service worker memory and are never written to `chrome.storage`.
- Failed questions are kept for up to 10 minutes so you can retry.
- The extension does not read or store login credentials.
- There is no remote code, third-party dependency, or tracking.
- Once sent, a question is saved in the server's chat history according to your Open WebUI settings.

You can revoke site access from the extension's details page in `chrome://extensions`.

## Known limitations

- The integration depends on Open WebUI's `#chat-input` and `#send-message-button`. It was tested with Open WebUI 0.13.4. If a future version changes them, the extension stops and shows an error.
- URLs are normalized to their origin, so Open WebUI deployments under a subpath are not supported.
- A usable default model is required. If no model is selected, Open WebUI rejects the send and the popup shows its message.
- The rich text input may collapse consecutive blank lines into a single paragraph break.
- If Open WebUI converts long pasted text into an attachment, the extension treats it as a failed fill and stops.
- The extension stops if SSO redirects to another domain. Sign in first, then retry.
- Kept questions are lost when the browser restarts, when the extension reloads, or 10 minutes after the failure.
- When several requests fail, the popup shows one at a time and moves to the next after you clear it.
- If the permission dialog closes the popup and you then deny access, the red count can take up to 2 minutes to appear.

## Manual testing

1. Load the extension and confirm that Submit is disabled when the URL or question is empty.
2. Enter `javascript:alert(1)` and confirm that a protocol error appears and the question cannot be submitted.
3. Enter a WebUI URL and a question, press Enter, and confirm that the permission dialog appears.
4. Click **Deny** and confirm that no tab opens and the question is kept.
5. Submit again, allow access, and confirm that the new tab receives the question and sends it exactly once.
6. Reopen the popup and confirm that the URL is still there.
7. Enter a multi-line question with Shift+Enter and confirm that the line breaks are correct.
8. Press Enter during Chinese IME composition and confirm that it selects the candidate without submitting.
9. Quickly submit two different questions from the popup and confirm that each tab receives only its own question.
10. Sign out of Open WebUI, submit a question, and confirm that a sign-in error appears and the question is kept.
11. Enter an unreachable URL and confirm that a load failure appears.
12. Close the target tab during processing and confirm that a closed-tab error appears.
