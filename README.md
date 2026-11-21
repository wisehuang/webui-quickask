# WebUI QuickAsk

WebUI QuickAsk 是 Chrome Manifest V3 extension。在 popup 輸入問題後，它會開啟新的 Open WebUI 分頁，填入問題並自動送出。

它不呼叫 Open WebUI API、不需要 API key，也不修改伺服器。

## 檔案結構

```text
webui-quickask/
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

## 安裝

1. 在 Chrome 網址列開啟 `chrome://extensions`。
2. 開啟右上角的 **Developer mode**。
3. 按 **Load unpacked**。
4. 選擇含有 `manifest.json` 的 `webui-quickask` 資料夾。
5. 將 WebUI QuickAsk 釘選到工具列（可選）。

需要 Chrome 116 或更新版本。

## 使用方式

1. 先在 Chrome 登入 Open WebUI，並確認已設定預設模型。
2. 點擊 extension 圖示。
3. 輸入 Open WebUI 網址，例如 `https://chat.example.com`。
4. 輸入問題，按 **Enter** 或 **Submit**。按 **Shift+Enter** 可換行。
5. 第一次使用某個網站時，請在 Chrome 對話框允許存取。

送出成功後，extension 會切換到新分頁並關閉 popup。失敗時，popup 會顯示原因並保留問題。若 popup 已關閉，工具列圖示會顯示紅色數字，重新開啟即可看到問題。

## 權限與隱私

| 權限 | 用途 |
| --- | --- |
| `scripting` | 在你指定的 WebUI 分頁填入並送出問題 |
| `storage` | 只儲存正規化後的 WebUI 網址 |
| optional host permission | 只在使用時請求你輸入的單一網站（含連接埠） |

- 問題只保留在 service worker 記憶體，不寫入 `chrome.storage`。
- 失敗的問題最多保留 10 分鐘，供你重試。
- Extension 不讀取或儲存登入憑證。
- 沒有遠端程式碼、第三方依賴或追蹤。
- 問題送出後，會依 Open WebUI 的設定保存在該伺服器的對話紀錄。

可在 `chrome://extensions` 的 extension 詳細資料中撤銷網站權限。

## 已知限制

- 整合依賴 Open WebUI 的 `#chat-input` 與 `#send-message-button`。已用 Open WebUI 0.13.4 測試，若未來版本改變，extension 會停止並顯示錯誤。
- 網址會正規化為 origin，因此不支援部署在子路徑的 Open WebUI。
- 必須已有可用的預設模型。未選模型時，Open WebUI 會拒絕送出，popup 會顯示其訊息。
- 富文字輸入框可能將連續空行合併成一個段落分隔。
- 若 Open WebUI 將長文字貼上轉為附件，extension 會視為填入失敗並停止。
- SSO 導向其他網域時，extension 會停止。請先登入後重試。
- 瀏覽器重新啟動、extension 重新載入，或失敗超過 10 分鐘後，保留的問題會消失。
- 同時有多個失敗請求時，popup 一次顯示一筆，清除後顯示下一筆。
- 若權限對話框使 popup 關閉，之後按「拒絕」時，錯誤最多會在 2 分鐘後才以紅色數字顯示。

## 手動測試

1. 載入 extension，確認 popup 的 Submit 在網址或問題為空時停用。
2. 輸入 `javascript:alert(1)`，確認顯示協定錯誤且無法送出。
3. 輸入 WebUI 網址與問題並按 Enter，確認出現權限對話框。
4. 按「拒絕」，確認沒有開啟分頁，問題仍保留。
5. 再次送出並允許，確認新分頁收到問題並只送出一次。
6. 重新開啟 popup，確認網址仍在。
7. 用 Shift+Enter 輸入多行問題，確認換行正確。
8. 用中文輸入法組字時按 Enter，確認只選字、不送出。
9. 快速開啟 popup 送出兩個不同問題，確認各分頁只收到自己的問題。
10. 登出 Open WebUI 後送出，確認顯示需要登入並保留問題。
11. 輸入無法連線的網址，確認顯示載入失敗。
12. 處理中關閉目標分頁，確認顯示分頁已關閉。
