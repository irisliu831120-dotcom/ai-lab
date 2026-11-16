/** 山餃訂單接收端。部署設定：執行身分「我」、存取權「所有人」。 */
const ORDER_HEADERS = ['訂單編號','建立時間（台北）','請求識別碼','內容指紋','模式','處理狀態','姓名','電話','電子郵件','取餐方式','門市','宅配地址','商品明細','商品小計','運費','總額','付款狀態','備註'];
const STORE_NAMES = ['旗艦店','信義店'];
const FULFILLMENT_LABELS = {dine:'內用',takeout:'外帶',delivery:'冷凍宅配'};
const PUBLIC_ORIGIN = 'https://irisliu831120-dotcom.github.io';
// 訂單採後端價格；調價時須同時更新首頁及此清單並重新部署 GAS。
const CATALOG = [{"id": "p1", "name": "經典原味鍋貼", "price": 85, "cat": 0}, {"id": "p2", "name": "香辣爆汁鍋貼", "price": 95, "cat": 0}, {"id": "p3", "name": "韭菜鮮肉鍋貼", "price": 90, "cat": 0}, {"id": "p4", "name": "高麗菜鮮肉水餃", "price": 90, "cat": 1}, {"id": "p5", "name": "韭菜水餃", "price": 95, "cat": 1}, {"id": "p6", "name": "鮮蝦水餃", "price": 130, "cat": 1}, {"id": "p7", "name": "家常酸辣湯", "price": 45, "cat": 2}, {"id": "p8", "name": "每日暖湯", "price": 40, "cat": 2}, {"id": "p9", "name": "無糖豆漿", "price": 30, "cat": 2}, {"id": "p10", "name": "爽脆小黃瓜", "price": 40, "cat": 3}, {"id": "p11", "name": "胡麻時蔬", "price": 55, "cat": 3}, {"id": "p12", "name": "家常涼拌菜", "price": 45, "cat": 3}, {"id": "g1", "name": "招牌招財鍋貼禮盒 50 入", "price": 450, "cat": 4}];

/** 在 GAS 編輯器執行一次；預設建立私人試算表，不公開分享。 */
function setup() {
  const properties = PropertiesService.getScriptProperties();
  let id = properties.getProperty('SPREADSHEET_ID');
  let spreadsheet;
  if (id) spreadsheet = SpreadsheetApp.openById(id);
  else {
    spreadsheet = SpreadsheetApp.create('山餃訂單管理');
    id = spreadsheet.getId();
    properties.setProperty('SPREADSHEET_ID', id);
  }
  spreadsheet.setSpreadsheetTimeZone('Asia/Taipei');
  const sheet = ensureSheet_(spreadsheet);
  if (!properties.getProperty('ALLOWED_ORIGIN')) properties.setProperty('ALLOWED_ORIGIN', PUBLIC_ORIGIN);
  if (!properties.getProperty('ACCEPT_LIVE_ORDERS')) properties.setProperty('ACCEPT_LIVE_ORDERS', 'false');
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,ORDER_HEADERS.length).setFontWeight('bold').setBackground('#e8d9c5');
  sheet.getRange('N:P').setNumberFormat('#,##0');
  console.log('試算表：' + spreadsheet.getUrl());
  return spreadsheet.getUrl();
}
function ensureSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('訂單') || spreadsheet.insertSheet('訂單');
  if (sheet.getLastRow() === 0) sheet.appendRow(ORDER_HEADERS);
  const headers = sheet.getRange(1,1,1,ORDER_HEADERS.length).getValues()[0];
  if (JSON.stringify(headers) !== JSON.stringify(ORDER_HEADERS)) throw new Error('SCHEMA_MISMATCH');
  return sheet;
}
/** 健康檢查不回傳訂單、試算表位置或任何個資。 */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({service:'shan-jiao-orders',ok:true,version:1})).setMimeType(ContentService.MimeType.JSON);
}
function doPost(event) {
  const properties = PropertiesService.getScriptProperties();
  const origin = properties.getProperty('ALLOWED_ORIGIN') || PUBLIC_ORIGIN;
  let request = {}, result;
  try {
    const raw = event && event.parameter && event.parameter.payload;
    if (typeof raw !== 'string' || raw.length > 16000) throw new Error('INVALID_REQUEST');
    try { request = JSON.parse(raw); } catch (_) { throw new Error('INVALID_REQUEST'); }
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('INVALID_REQUEST');
    if (request.replyOrigin !== origin || !validKey_(request.nonce)) throw new Error('INVALID_REQUEST');
    result = saveOrder_(request, properties);
  } catch (error) {
    const messages = {
      INVALID_REQUEST:'送單資料格式不正確，請重新確認。',
      INVALID_CUSTOMER:'請檢查姓名、電話、電子郵件或地址。',
      INVALID_ITEMS:'商品或數量不正確，請重新整理菜單。',
      INVALID_FULFILLMENT:'商品與取餐方式不相容，請重新選擇。',
      PRICE_CHANGED:'商品金額已變動，請重新整理菜單後確認。',
      LIVE_DISABLED:'目前僅接受測試訂單，不接受正式訂單。',
      NOT_CONFIGURED:'訂單服務尚未完成設定，請稍後再試。',
      SCHEMA_MISMATCH:'訂單欄位設定需要管理員檢查。',
      IDEMPOTENCY_CONFLICT:'此筆送單的資料已變更，請勿重複建立；請重新確認原訂單。',
      TOO_MANY_REQUESTS:'送單過於頻繁，請一分鐘後再試。',
      BUSY:'訂單服務忙碌，請使用相同內容重試。'
    };
    result = {ok:false,code:messages[error.message] ? error.message : 'SERVICE_ERROR',message:messages[error.message] || '暫時無法確認訂單是否儲存，請以相同內容重試，勿另開新單。'};
    // Do not log customer input or exception stacks containing spreadsheet details.
  }
  const safeRequestId = request && validKey_(request.requestId) ? request.requestId : '';
  const safeNonce = request && validKey_(request.nonce) ? request.nonce : '';
  return reply_({source:'shan-jiao-orders',requestId:safeRequestId,nonce:safeNonce,result:result}, origin);
}
function validKey_(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value); }
function cleanText_(value, max, required) {
  if (typeof value !== 'string') throw new Error('INVALID_CUSTOMER');
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('INVALID_CUSTOMER');
  return text;
}
function normalizeOrder_(input) {
  if (!validKey_(input.requestId) || !['test','live'].includes(input.mode) || input.consent !== true) throw new Error('INVALID_REQUEST');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > CATALOG.length) throw new Error('INVALID_ITEMS');
  const seen = new Set();
  const items = input.items.map(item => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new Error('INVALID_ITEMS');
    seen.add(item.id);
    const product = CATALOG.find(product => product.id === item.id);
    if (!product) throw new Error('INVALID_ITEMS');
    return {id:product.id,name:product.name,quantity:item.quantity,unitPrice:product.price,category:product.cat};
  }).sort((a,b) => a.id.localeCompare(b.id));
  const hasFrozen = items.some(item => item.category === 4), hasHot = items.some(item => item.category !== 4);
  const fulfillment = input.fulfillment;
  if (!Object.prototype.hasOwnProperty.call(FULFILLMENT_LABELS,fulfillment) || (fulfillment === 'delivery' && hasHot) || (fulfillment === 'dine' && hasFrozen)) throw new Error('INVALID_FULFILLMENT');
  const customer = input.customer;
  if (!customer || typeof customer !== 'object') throw new Error('INVALID_CUSTOMER');
  const name = cleanText_(customer.name,60,true);
  const phone = cleanText_(customer.phone,20,true);
  const email = cleanText_(customer.email || '',254,false);
  if (!/^[0-9+() -]{8,20}$/.test(phone) || phone.replace(/\D/g,'').length < 8 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('INVALID_CUSTOMER');
  const address = fulfillment === 'delivery' ? cleanText_(customer.address,200,true) : '';
  const store = fulfillment === 'delivery' ? '' : input.store;
  if (fulfillment !== 'delivery' && !STORE_NAMES.includes(store)) throw new Error('INVALID_FULFILLMENT');
  const subtotal = items.reduce((sum,item) => sum + item.unitPrice * item.quantity,0);
  const shipping = fulfillment === 'delivery' ? 160 : 0;
  if (input.expectedTotal !== subtotal + shipping) throw new Error('PRICE_CHANGED');
  return {requestId:input.requestId,mode:input.mode,customer:{name:name,phone:phone,email:email,address:address},fulfillment:fulfillment,store:store,items:items,subtotal:subtotal,shipping:shipping,total:subtotal+shipping};
}
function fingerprint_(order) {
  const copy = Object.assign({},order); delete copy.requestId;
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(copy),Utilities.Charset.UTF_8).map(byte => ('0'+((byte+256)%256).toString(16)).slice(-2)).join('');
}
/** Prefix user-controlled cells so Sheets never interprets formulas. */
function sheetText_(text) { return text ? "'" + text : ''; }
function saveOrder_(input, properties) {
  const order = normalizeOrder_(input);
  if (order.mode === 'live' && properties.getProperty('ACCEPT_LIVE_ORDERS') !== 'true') throw new Error('LIVE_DISABLED');
  const id = properties.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('NOT_CONFIGURED');
  const fingerprint = fingerprint_(order);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('BUSY');
  try {
    const sheet = ensureSheet_(SpreadsheetApp.openById(id));
    const count = sheet.getLastRow();
    const existing = count > 1 ? sheet.getRange(2,3,count-1,1).createTextFinder(order.requestId).matchEntireCell(true).findNext() : null;
    if (existing) {
      const row = sheet.getRange(existing.getRow(),1,1,ORDER_HEADERS.length).getValues()[0];
      if (row[3] !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT');
      return {ok:true,orderId:row[0],mode:row[4],subtotal:row[13],shipping:row[14],total:row[15],duplicate:true};
    }
    // Best-effort throttle; this public endpoint does not authenticate buyers.
    const cache = CacheService.getScriptCache();
    const rateKey = 'phone-'+Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,order.customer.phone.replace(/\D/g,''),Utilities.Charset.UTF_8).map(byte => ('0'+((byte+256)%256).toString(16)).slice(-2)).join('');
    const rateCount = Number(cache.get(rateKey) || 0);
    if (rateCount >= 3) throw new Error('TOO_MANY_REQUESTS');
    const now = new Date();
    const orderId = (order.mode === 'test' ? 'TEST-' : 'SJ-') + Utilities.formatDate(now,'Asia/Taipei','yyyyMMdd')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();
    const summary = order.items.map(item => item.name+' × '+item.quantity+' @ '+item.unitPrice).join('；');
    const row = [orderId,Utilities.formatDate(now,'Asia/Taipei','yyyy-MM-dd HH:mm:ss'),order.requestId,fingerprint,order.mode,order.mode==='test'?'測試／不履約':'待確認',sheetText_(order.customer.name),sheetText_(order.customer.phone),sheetText_(order.customer.email),FULFILLMENT_LABELS[order.fulfillment],order.store,sheetText_(order.customer.address),summary,order.subtotal,order.shipping,order.total,'未付款',''];
    // One row is the transaction boundary; retries use the persisted request ID.
    sheet.getRange(count+1,1,1,row.length).setValues([row]);
    SpreadsheetApp.flush();
    cache.put(rateKey,String(rateCount+1),60);
    return {ok:true,orderId:orderId,mode:order.mode,subtotal:order.subtotal,shipping:order.shipping,total:order.total,duplicate:false};
  } finally { lock.releaseLock(); }
}
function reply_(data, origin) {
  const json = JSON.stringify(data).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const target = JSON.stringify(origin).replace(/</g,'\\u003c');
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><title>山餃訂單回覆</title><script>window.top.postMessage('+json+','+target+');</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
