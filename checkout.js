'use strict';
(() => {
  const config = window.SHAN_JIAO_ORDER_CONFIG || {};
  const configured = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(config.endpoint || '');
  const active = configured && ['test','live'].includes(config.mode);
  const mode = active ? config.mode : 'demo';
  const pendingKey = 'shanjiao-pending-request-v1';
  const validKey = value => typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
  const googleReplyOrigin = origin => {
    try { const url = new URL(origin); return url.protocol === 'https:' && (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com' || /^[a-z0-9-]+-script\.googleusercontent\.com$/.test(url.hostname)); } catch { return false; }
  };
  async function requestIdFor(payload) {
    const serialized = JSON.stringify(payload);
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized));
    const fingerprint = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
      if (saved && saved.fingerprint === fingerprint && validKey(saved.id) && Date.now()-saved.at < 86400000) return saved.id;
    } catch {}
    const id = crypto.randomUUID();
    try { sessionStorage.setItem(pendingKey,JSON.stringify({id:id,fingerprint:fingerprint,at:Date.now()})); }
    catch { throw new Error('瀏覽器無法保存重試識別碼，請開啟網站儲存權限後再送單。'); }
    return id;
  }
  function sendToGas(payload) {
    if (!active) return Promise.reject(new Error('尚未設定訂單服務，目前只能使用模擬結帳。'));
    return new Promise((resolve,reject) => {
      const nonce = crypto.randomUUID();
      const frame = document.createElement('iframe');
      frame.name = 'shan-jiao-order-'+nonce;
      frame.title = '訂單服務回覆'; frame.hidden = true; frame.setAttribute('aria-hidden','true');
      const form = document.createElement('form');
      form.method = 'POST'; form.action = config.endpoint; form.target = frame.name; form.hidden = true;
      const field = document.createElement('input'); field.type = 'hidden'; field.name = 'payload';
      field.value = JSON.stringify({...payload,nonce:nonce,replyOrigin:window.location.origin});
      form.appendChild(field);
      let timer;
      const cleanup = () => { clearTimeout(timer);window.removeEventListener('message',receive);form.remove();frame.remove(); };
      const receive = event => {
        const data = event.data;
        if (!googleReplyOrigin(event.origin) || !data || data.source !== 'shan-jiao-orders' || data.nonce !== nonce || data.requestId !== payload.requestId) return;
        const result = data.result;
        if (!result || typeof result.ok !== 'boolean') return;
        if (result.ok && (typeof result.orderId !== 'string' || !/^(TEST|SJ)-\d{8}-[A-F0-9]{12}$/.test(result.orderId) || !Number.isSafeInteger(result.total) || result.total !== payload.expectedTotal || result.mode !== payload.mode)) {
          cleanup();reject(new Error('訂單回覆無法驗證。請保留購物車，以相同內容重試。'));return;
        }
        cleanup();
        if (result.ok) resolve(result);
        else reject(new Error(typeof result.message === 'string' ? result.message : '送單失敗，請稍後以相同內容重試。'));
      };
      window.addEventListener('message',receive);
      timer = setTimeout(() => {cleanup();reject(new Error('尚未收到訂單確認，請勿另開新單。購物車已保留，請以相同資料重試；系統會避免重複寫入。'));}, Math.min(Math.max(Number(config.timeoutMs)||45000,1000),60000));
      document.body.appendChild(frame);document.body.appendChild(form);
      try { form.submit(); } catch { cleanup();reject(new Error('無法連線至訂單服務，請稍後再試。')); }
    });
  }
  window.ShanJiaoCheckout = Object.freeze({
    mode:mode,
    completeOrder() { try { sessionStorage.removeItem(pendingKey); } catch {} },
    async submitOrder(payload) {
      if (!active) throw new Error('訂單服務尚未設定。');
      if (!navigator.onLine) throw new Error('目前離線，無法送出訂單。請恢復連線後重試。');
      const body = {...payload,mode:mode};
      const requestId = await requestIdFor(body);
      // A timeout keeps the same identifier; the UI clears it only after consuming a verified receipt.
      return sendToGas({...body,requestId:requestId});
    }
  });
  const notice = document.getElementById('checkoutNotice');
  const consent = document.getElementById('orderConsent');
  const consentField = document.getElementById('orderConsentField');
  const submit = document.getElementById('orderSubmit');
  consentField.hidden = !active;consent.required = active;
  notice.textContent = mode === 'demo' ? '尚未連接訂單服務。目前僅供模擬，不傳送資料、不建立真實訂單。' : mode === 'test' ? '測試模式：資料會儲存至山餃的 Google 試算表，不收款、不安排出餐。請使用虛構姓名、電話與地址測試。' : '送出後會將必要聯絡資訊及商品明細儲存至山餃的 Google 試算表。訂單仍待門市確認，本網站不提供線上付款。';
  submit.textContent = mode === 'demo' ? '建立模擬訂單' : mode === 'test' ? '送出測試訂單' : '送出訂單（待確認）';
})();
