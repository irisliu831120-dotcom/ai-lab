/** Public configuration only. Never put Google tokens or spreadsheet credentials here. */
window.SHAN_JIAO_ORDER_CONFIG = Object.freeze({
  // GAS「網頁應用程式」的 /exec 網址；部署後才填入。
  endpoint: '',
  // demo: no data is sent; test: write TEST orders to Sheets; live: requires GAS opt-in too.
  mode: 'test',
  timeoutMs: 45000
});
