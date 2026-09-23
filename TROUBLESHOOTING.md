# 補色查詢無法讀取 record 分頁：排查步驟

網頁（`index.html`）不直接讀 Google Sheet，而是呼叫 `GAS_API_URL`（Apps Script 網頁應用程式），
由 Apps Script（`gas/Code.gs`）去讀 `record` 與 `Config` 分頁。

## 更新 Apps Script
1. 打開試算表 →「擴充功能」→「Apps Script」
2. 把 `Code.gs` 內容整份換成本專案的 `gas/Code.gs`，儲存
3. **「部署」→「管理部署作業」→ 編輯（鉛筆）→ 版本選「新版本」→ 部署**
   - 執行身分：我；具有存取權的使用者：所有人
   - 不要按「新增部署作業」，否則網址會變，要同步更新 `index.html` 的 `GAS_API_URL`

## 診斷
在瀏覽器打開 `GAS_API_URL` 後面加上 `?debug=1`（或在編輯器執行 `debugRecordSheet`），會顯示：
- `sheets`：所有分頁名稱；`recordSheet`：實際讀到的分頁
- `headerRowNumber` / `headers`：標題在第幾列、標題內容
- `missingColumns`：找不到的欄位
- `rowsWithUnreadableDate`：「上次預約日」無法辨識的筆數（這些客人會查不到）
- `priceRuleKeys`：Config 讀到的價格規則

診斷不會回傳任何客戶資料。

## 新版 Apps Script 的容錯
- 分頁名稱忽略大小寫與空白（`Record`、`record ` 都可）
- 標題忽略空白、接受常見別名（如「姓名」「手機」），標題不在第一列也能找到
- 日期支援日期格式、`2025/3/5`、`2025-03-05`、`2025.3.5`、`2025年3月5日`、民國年 `114/3/5`
- 電話忽略 `-`、空白、`+886` 與開頭 0
- 找到客人但日期無法辨識時，會顯示明確錯誤，而不是「查無資料」
