# 補色查詢無法讀取 record 分頁：排查步驟

網頁（`index.html`）本身不直接讀 Google Sheet，而是呼叫 `GAS_API_URL`（Apps Script 網頁應用程式），
由 Apps Script 去讀 `record` 分頁。所以問題幾乎都出在 Apps Script 端，請依序檢查：

## 1. 先看網頁顯示的錯誤訊息
網頁現在會顯示實際原因：
- **「API 未回傳 JSON…」**：跳到第 2 點（部署權限）。
- **「系統連線失敗」＋其他錯誤文字**：Apps Script 執行出錯，跳到第 3 點。
- **「查無資料…」**：API 通了，但比對不到，跳到第 4 點。

## 2. 部署設定（最常見）
Apps Script →「部署」→「管理部署作業」→ 編輯：
- 執行身分：**我**
- 具有存取權的使用者：**所有人**
- **每次改程式碼後都要按「部署」選「新版本」**，否則網址仍跑舊程式碼。
- 若建立的是「新部署」，網址會變，要把新網址更新到 `index.html` 的 `GAS_API_URL`。

## 3. 分頁連結
執行 `gas/debug.gs` 的 `debugRecordSheet()`，在「執行記錄」確認：
- 分頁名稱需與程式中**完全相同**（`record` ≠ `Record` ≠ `record `）。
- 若 Apps Script 不是從該試算表「擴充功能 → Apps Script」建立的（獨立專案），
  `SpreadsheetApp.getActiveSpreadsheet()` 會是 `null`，必須改用：
  ```js
  SpreadsheetApp.openById('1bxILfBgaC7Flebo-TGLQKx8iZ5CtuKJ5V_w1BRzh-lM').getSheetByName('record')
  ```
- 若試算表換過（複製成新檔），ID 也會變，需更新程式裡的 ID。

## 4. 電話比對
網頁會把電話開頭的 `0` 去掉再送出（`0912345678` → `912345678`）。
若表格中的電話存成文字 `0912345678`，Apps Script 比對時要一併去掉開頭 0 或用「包含」比對，否則會查無資料。
