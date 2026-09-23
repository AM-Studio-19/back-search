// ❗❗❗ 設定區塊 ❗❗❗
// 試算表 ID（網址 /d/ 與 /edit 之間那一段）
const SPREADSHEET_ID = "1bxILfBgaC7Flebo-TGLQKx8iZ5CtuKJ5V_w1BRzh-lM";

// 工作表名稱（大小寫、前後空白不同也找得到）
const RECORD_SHEET_NAME = "record";
const CONFIG_SHEET_NAME = "Config";

// 欄位名稱：左邊是程式用的名稱，右邊是可接受的標題寫法（空白會自動忽略）
const COLUMN_ALIASES = {
  "客戶姓名": ["客戶姓名", "姓名", "客人姓名", "名字"],
  "電話": ["電話", "手機", "電話號碼", "手機號碼", "聯絡電話"],
  "服務項目": ["服務項目", "項目"],
  "上次預約日": ["上次預約日", "預約日", "上次日期", "上次施作日", "施作日期", "日期"],
  "客戶類型": ["客戶類型", "類型"],
  "特別提醒": ["特別提醒", "備註"],
  "免費補色到期日": ["免費補色到期日"]
};

let PRICE_CONFIG_RULES = {};

// ==========================================
// 1. 核心 API 入口 (給 GitHub 呼叫用的)
// ==========================================
function doGet(e) {
  const params = (e && e.parameter) || {};

  // 診斷模式：網址加 ?debug=1 可檢查分頁與欄位是否讀得到（不回傳客戶資料）
  const result = params.debug ? diagnose() : searchCustomer(params.q);

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 在 Apps Script 編輯器直接執行此函式，結果會顯示在「執行記錄」
function debugRecordSheet() {
  Logger.log(JSON.stringify(diagnose(), null, 2));
}

// ==========================================
// 2. 輔助工具函數
// ==========================================
function addMonths(date, months) {
  const newDate = new Date(date.getTime());
  const currentDay = date.getDate();
  newDate.setMonth(date.getMonth() + months);
  if (newDate.getDate() !== currentDay) newDate.setDate(0);
  return newDate;
}

function getMonthDifference(d1, d2) {
  let months = (d2.getFullYear() - d1.getFullYear()) * 12;
  months += (d2.getMonth() - d1.getMonth());
  if (d2.getDate() < d1.getDate()) months -= 1;
  return months <= 0 ? 0 : months;
}

function getDaysRemainingText(endDate) {
  if (!endDate) return "";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(endDate);
  target.setHours(0, 0, 0, 0);
  const diffTime = target - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "(已過期)";
  if (diffDays === 0) return "(最後一天)";
  return `(剩餘 ${diffDays} 天)`;
}

function normalizeHeader(h) {
  return String(h).replace(/\s+/g, "");
}

// 分頁名稱容錯：先找完全相同，再忽略大小寫與空白
function getSheetLoose(ss, name) {
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const target = normalizeHeader(name).toLowerCase();
  return ss.getSheets().find(s => normalizeHeader(s.getName()).toLowerCase() === target) || null;
}

// 在前幾列中找出標題列（第一列若是大標題也能找到）
function findHeaderRow(values) {
  const nameAliases = COLUMN_ALIASES["客戶姓名"];
  const limit = Math.min(values.length, 5);
  for (let r = 0; r < limit; r++) {
    const headers = values[r].map(normalizeHeader);
    if (nameAliases.some(a => headers.indexOf(a) !== -1)) return r;
  }
  return -1;
}

function mapColumns(headerRow) {
  const headers = headerRow.map(normalizeHeader);
  const indices = {};
  Object.keys(COLUMN_ALIASES).forEach(key => {
    indices[key] = -1;
    for (const alias of COLUMN_ALIASES[key]) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) { indices[key] = idx; break; }
    }
  });
  return indices;
}

function cell(row, idx) {
  return idx === -1 ? "" : row[idx];
}

// 日期容錯：支援日期格式、2025/3/5、2025-03-05、2025.3.5、2025年3月5日、民國 114/3/5
function parseDateLoose(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // 試算表日期序號
    return new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
  }
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{2,4})\s*[\/\-\.年]\s*(\d{1,2})\s*[\/\-\.月]\s*(\d{1,2})/);
  if (m) {
    let y = parseInt(m[1], 10);
    if (y < 1000) y += 1911; // 民國年
    const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// 電話只留數字，並去掉 +886 與開頭的 0，讓 0912… / 912… / +886912… 都能互相比對
function normalizePhone(v) {
  let s = String(v || "").replace(/[^0-9]/g, "");
  if (s.indexOf("886") === 0 && s.length > 9) s = s.substring(3);
  return s.replace(/^0+/, "");
}

// ==========================================
// 3. 讀取設定檔 (Config)
// ==========================================
function loadConfig(ss) {
  try {
    const sheet = getSheetLoose(ss, CONFIG_SHEET_NAME);
    if (!sheet) return; // 沒設定表就算了

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return;

    const headers = values[0].map(h => String(h).trim());
    const dataRows = values.slice(1);
    const config = {};

    const typeIndex = headers.indexOf("客戶類型");
    const serviceIndex = headers.indexOf("服務項目");

    if (typeIndex === -1 || serviceIndex === -1) return;

    const ruleIndices = [];
    for (let r = 1; r <= 4; r++) {
      const s = headers.indexOf(`Rule${r}_StartM`);
      const e = headers.indexOf(`Rule${r}_EndM`);
      const p = headers.indexOf(`Rule${r}_Price`);
      if (s !== -1 && e !== -1 && p !== -1) ruleIndices.push({ start: s, end: e, price: p });
    }

    dataRows.forEach(row => {
      const cType = String(row[typeIndex] || "").trim();
      const sItem = String(row[serviceIndex] || "").trim();
      if (!cType || !sItem) return;
      const key = `${cType}-${sItem}`;
      const rules = [];
      ruleIndices.forEach(idx => {
        const start = parseInt(row[idx.start]);
        const end = parseInt(row[idx.end]);
        const price = parseInt(row[idx.price]);
        if (!isNaN(start) && !isNaN(end) && !isNaN(price)) rules.push({ startM: start, endM: end, price: price });
      });
      config[key] = rules;
    });
    PRICE_CONFIG_RULES = config;
  } catch (e) {
    console.log("Config Error: " + e.message);
  }
}

// ==========================================
// 4. 診斷
// ==========================================
function diagnose() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const info = {
      spreadsheet: ss.getName(),
      sheets: ss.getSheets().map(s => s.getName())
    };
    const sheet = getSheetLoose(ss, RECORD_SHEET_NAME);
    if (!sheet) return Object.assign(info, { error: `找不到「${RECORD_SHEET_NAME}」分頁` });
    info.recordSheet = sheet.getName();

    const values = sheet.getDataRange().getValues();
    info.totalRows = values.length;
    const headerRow = findHeaderRow(values);
    if (headerRow === -1) return Object.assign(info, { error: "前 5 列找不到姓名欄位標題", firstRow: (values[0] || []).map(String) });

    const indices = mapColumns(values[headerRow]);
    info.headerRowNumber = headerRow + 1;
    info.headers = values[headerRow].map(String);
    info.missingColumns = Object.keys(indices).filter(k => indices[k] === -1);

    const rows = values.slice(headerRow + 1).filter(r => String(cell(r, indices["客戶姓名"])).trim());
    info.customerRows = rows.length;
    info.rowsWithUnreadableDate = rows.filter(r => !parseDateLoose(cell(r, indices["上次預約日"]))).length;

    loadConfig(ss);
    info.priceRuleKeys = Object.keys(PRICE_CONFIG_RULES);
    return info;
  } catch (e) {
    return { error: "診斷錯誤: " + e.message };
  }
}

// ==========================================
// 5. 主要搜尋邏輯
// ==========================================
function searchCustomer(query) {
  if (!query) return { error: "請輸入查詢內容" };
  query = String(query).trim().toLowerCase();

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    loadConfig(ss);
    const sheet = getSheetLoose(ss, RECORD_SHEET_NAME);
    if (!sheet) return { error: "系統維護中 (找不到 record 表)" };

    const values = sheet.getDataRange().getValues();
    const headerRow = findHeaderRow(values);
    if (headerRow === -1) return { error: "資料表格式錯誤 (缺少姓名欄位)" };
    if (values.length <= headerRow + 1) return { message: "目前無客戶資料" };

    const indices = mapColumns(values[headerRow]);
    if (indices["上次預約日"] === -1) return { error: "資料表格式錯誤 (缺少上次預約日欄位)" };

    const dataRows = values.slice(headerRow + 1);
    const results = [];
    const phoneQuery = normalizePhone(query);
    const tz = Session.getScriptTimeZone();
    let matchedWithBadDate = 0;

    dataRows.forEach(row => {
      const rawName = String(cell(row, indices["客戶姓名"]) || "").trim();
      if (!rawName) return; // 空白列
      const name = rawName.toLowerCase();
      const phone = normalizePhone(cell(row, indices["電話"]));

      // 搜尋比對 (姓名包含 或 電話包含)
      if (!(name.includes(query) || (phoneQuery && phone.includes(phoneQuery)))) return;

      // 日期驗證
      const lastDate = parseDateLoose(cell(row, indices["上次預約日"]));
      if (!lastDate) { matchedWithBadDate++; return; }

      const lastDateStr = Utilities.formatDate(lastDate, tz, "yyyy/MM/dd");
      const customerType = String(cell(row, indices["客戶類型"]) || "首次").trim();
      const serviceItem = String(cell(row, indices["服務項目"]) || "").trim();
      const specialReminder = String(cell(row, indices["特別提醒"]) || "").trim();

      // 免費補色到期日
      let customFreeDate = null;
      const parsedCustomFreeDate = parseDateLoose(cell(row, indices["免費補色到期日"]));
      const hasCustomFreeDate = !!parsedCustomFreeDate;
      if (hasCustomFreeDate) customFreeDate = Utilities.formatDate(parsedCustomFreeDate, tz, "yyyy/MM/dd");

      // 霧眉優惠
      let eyebrowDiscountDate = null;
      if (serviceItem.includes("霧眉") && customerType === "首次") {
        eyebrowDiscountDate = Utilities.formatDate(addMonths(lastDate, 6), tz, "yyyy/MM/dd");
      }

      // 價格計算
      const compositeKey = `${customerType}-${serviceItem}`;
      const defaultKey = `首次-${serviceItem}`;
      const rules = PRICE_CONFIG_RULES[compositeKey] || PRICE_CONFIG_RULES[defaultKey] || [];

      const baseDate = lastDate;
      const now = new Date();
      const monthsElapsed = getMonthDifference(baseDate, now);

      const touchUpRanges = [];
      let currentPriceInfo = null;

      if (hasCustomFreeDate) {
        const daysMsg = getDaysRemainingText(parsedCustomFreeDate);
        touchUpRanges.push({ dateRange: `免費補色到期日: ${customFreeDate}`, price: 0 });
        if (now <= parsedCustomFreeDate) {
          currentPriceInfo = { dateRange: `【目前】免費補色到期日: ${customFreeDate}`, price: 0, daysRemainingText: daysMsg };
        }
      }

      rules.forEach(rule => {
        if (hasCustomFreeDate && rule.price === 0) return;
        if (rule.startM === rule.endM) return;

        const startDate = addMonths(baseDate, rule.startM);
        const startDateStr = Utilities.formatDate(startDate, tz, "yyyy/MM/dd");
        let endDate = null;
        let dateStr = "";

        if (rule.endM >= 999) dateStr = `${startDateStr} ~ 以上`;
        else {
          endDate = addMonths(baseDate, rule.endM);
          const endDateStr = Utilities.formatDate(endDate, tz, "yyyy/MM/dd");
          dateStr = `${startDateStr} ~ ${endDateStr}`;
        }
        if (rule.price === 0) dateStr += " (免費補色)";

        const isMatch = (monthsElapsed >= rule.startM) && (monthsElapsed < rule.endM || rule.endM >= 999);
        if (isMatch && !currentPriceInfo) {
          let daysMsg = "";
          if (rule.endM < 999 && endDate) daysMsg = getDaysRemainingText(endDate);
          currentPriceInfo = { dateRange: `【目前價位】${dateStr}`, price: rule.price, daysRemainingText: daysMsg };
        }
        touchUpRanges.push({ dateRange: dateStr, price: rule.price });
      });

      if (!currentPriceInfo) {
        const firstStart = rules.length > 0 ? rules[0].startM : 0;
        if (monthsElapsed < firstStart) currentPriceInfo = { dateRange: "【目前】尚未進入優惠區間", price: null };
        else currentPriceInfo = { dateRange: "【目前】無符合區間", price: null };
      }

      results.push({
        name: rawName,
        phone: cell(row, indices["電話"]),
        service: serviceItem,
        lastDate: lastDateStr,
        rawLastDate: lastDate,
        customerType: customerType,
        specialReminder: specialReminder,
        customFreeDate: customFreeDate,
        eyebrowDiscountDate: eyebrowDiscountDate,
        currentPriceInfo: currentPriceInfo,
        touchUpRanges: touchUpRanges
      });
    });

    if (results.length === 0) {
      if (matchedWithBadDate > 0) {
        return { error: `找到 ${matchedWithBadDate} 筆資料，但「上次預約日」格式無法辨識，請改成日期格式 (例如 2025/03/05)` };
      }
      return { message: "找不到資料，請確認輸入正確" };
    }

    // 排序：最新的日期在上面
    results.sort((a, b) => b.rawLastDate.getTime() - a.rawLastDate.getTime());

    // 移除重複 (同姓名+同電話+同項目，只留最新的)
    const uniqueResults = [];
    const seenKeys = new Set();
    results.forEach(r => {
      const uniqueKey = `${r.name}-${r.phone}-${r.service}`;
      if (!seenKeys.has(uniqueKey)) {
        uniqueResults.push(r);
        seenKeys.add(uniqueKey);
      }
    });

    // 整理回傳資料
    const finalData = uniqueResults.map(r => {
      const { rawLastDate, ...rest } = r;
      return rest;
    });

    return { data: finalData };

  } catch (e) {
    return { error: "系統錯誤: " + e.message };
  }
}
