/**
 * 補色查詢系統：record 分頁連線診斷
 *
 * 使用方式：
 * 1. 打開 Apps Script 專案（查詢 API 所在的專案）
 * 2. 新增一個檔案，貼上本段程式碼
 * 3. 上方函式選單選 debugRecordSheet → 按「執行」
 * 4. 查看「執行記錄」的輸出
 */
const DEBUG_SHEET_ID = '1bxILfBgaC7Flebo-TGLQKx8iZ5CtuKJ5V_w1BRzh-lM';
const DEBUG_SHEET_NAME = 'record';

function debugRecordSheet() {
  // 1. 用 ID 開啟試算表（獨立專案用 getActiveSpreadsheet() 會拿到 null）
  const ss = SpreadsheetApp.openById(DEBUG_SHEET_ID);
  Logger.log('試算表名稱：' + ss.getName());

  // 2. 列出所有分頁名稱（用 [] 包起來，方便看出前後空白）
  const names = ss.getSheets().map(s => '[' + s.getName() + ']');
  Logger.log('所有分頁：' + names.join(', '));

  // 3. 嘗試取得 record 分頁
  let sheet = ss.getSheetByName(DEBUG_SHEET_NAME);
  if (!sheet) {
    // 容錯：忽略大小寫與前後空白
    sheet = ss.getSheets().find(s => s.getName().trim().toLowerCase() === DEBUG_SHEET_NAME);
    if (sheet) {
      Logger.log('⚠️ 找不到完全符合的「' + DEBUG_SHEET_NAME + '」，但找到相近的分頁 [' + sheet.getName() +
                 ']：請把分頁名稱或程式裡的名稱改成完全一致');
    } else {
      Logger.log('❌ 找不到 record 分頁，請確認分頁名稱');
      return;
    }
  } else {
    Logger.log('✅ 成功取得 record 分頁');
  }

  // 4. 顯示資料概況
  const values = sheet.getDataRange().getDisplayValues();
  Logger.log('資料列數（含標題）：' + values.length);
  Logger.log('標題列：' + JSON.stringify(values[0]));
  if (values.length > 1) Logger.log('第一筆資料：' + JSON.stringify(values[1]));
}
