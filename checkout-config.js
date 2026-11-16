/** Public configuration only. Never put Google tokens or spreadsheet credentials here. */
window.SHAN_JIAO_ORDER_CONFIG = Object.freeze({
  // GAS「網頁應用程式」的 /exec 網址；部署後才填入。
  endpoint: 'https://script.google.com/macros/s/AKfycbz3sGxEi8GHU9_o9ZlhzQzN6NVFYPxzZCnFhphmnKlTkpIc40XFT0OrAUh6xLfDXRsS/exec',
  // demo: no data is sent; test: write TEST orders to Sheets; live: requires GAS opt-in too.
  mode: 'test',
  timeoutMs: 45000
});
