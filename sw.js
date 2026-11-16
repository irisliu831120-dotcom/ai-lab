'use strict';
const PREFIX = 'shan-jiao-pwa-';
const CACHE = PREFIX + 'v2';
const ROOT = new URL('./', self.location.href).href;
const HOME = new URL('index.html', ROOT).href;
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'pwa.js', 'checkout-config.js', 'checkout.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const CDN = ['https://cdn.tailwindcss.com/', 'https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js'];
const MEDIA_HOSTS = new Set(['images.unsplash.com', 'i.postimg.cc', 'fonts.googleapis.com', 'fonts.gstatic.com']);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(path => new Request(new URL(path, ROOT), {cache: 'reload'})));
    await Promise.allSettled(CDN.map(async url => {
      const response = await fetch(new Request(url, {mode: 'no-cors'}));
      if (response.ok || response.type === 'opaque') await cache.put(url, response);
    }));
    // Activate on the next navigation; do not interrupt an open cart or order form.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    // Warm visible photos and fonts for a later offline visit, within a bounded cache.
    const cache = await caches.open(CACHE);
    const responses = await Promise.all([cache.match(HOME), cache.match(ROOT)]);
    const page = responses.find(Boolean);
    if (!page) return;
    const html = await page.text();
    const urls = [...new Set((html.match(/https:\/\/[^\s'"<>`]+/g) || []).filter(url => {
      try { return MEDIA_HOSTS.has(new URL(url).hostname); } catch { return false; }
    }))].slice(0, 12);
    await Promise.allSettled(urls.map(async url => {
      const response = await fetch(new Request(url, {mode: 'no-cors'}));
      if (response.ok || response.type === 'opaque') await cache.put(url, response);
    }));
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const inScope = url.origin === self.location.origin && request.url.startsWith(ROOT);
  if (request.mode === 'navigate' && inScope) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request, {signal: AbortSignal.timeout(5000)});
        if (response.ok) {
          // Only the homepage is cached; never save submitted personal information.
          if (url.pathname === new URL(ROOT).pathname || url.pathname === new URL(HOME).pathname) await cache.put(HOME, response.clone());
          return response;
        }
      } catch {}
      return (await cache.match(HOME)) || (await cache.match(ROOT)) || Response.error();
    })());
    return;
  }
  if (!inScope && !MEDIA_HOSTS.has(url.hostname) && !CDN.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        const keys = await cache.keys();
        if (keys.length < 70) await cache.put(request, response.clone());
      }
      return response;
    } catch {
      // Existing image fallback supplies a local illustration when a photo is unavailable.
      return Response.error();
    }
  })());
});
