/* Portal TACS — service worker.
   Páginas: tenta a rede primeiro (pega versão nova) e cai no cache sem internet.
   Demais arquivos do site e a biblioteca do Supabase: cache primeiro, atualizando por trás.
   Chamadas à API do Supabase nunca passam pelo cache. */
const VERSAO = 'tacs-v2';
const SHELL = ['./', 'index.html', 'risco.html', 'paliativos.html', 'gestor.html',
               'offline.js', 'acesso.js', 'admin.html', 'pix.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const CDN = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, {cache: 'reload'}))));
    await Promise.allSettled(CDN.map(async u => c.put(u, await fetch(u, {mode: 'no-cors'}))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== VERSAO) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function paginaDoCache(url){
  const c = await caches.open(VERSAO);
  let r = await c.match(url.pathname) || await c.match(url.pathname + '.html');
  if(!r && (url.pathname.endsWith('/') || url.pathname === '')) r = await c.match('index.html');
  return r || await c.match('index.html');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(req.mode === 'navigate'){
    e.respondWith((async () => {
      try{
        const r = await fetch(req);
        if(r.ok && url.origin === location.origin){
          const c = await caches.open(VERSAO);
          c.put(url.pathname, r.clone());
        }
        return r;
      }catch(_){
        return paginaDoCache(url);
      }
    })());
    return;
  }

  const ehCDN = CDN.includes(req.url);
  if(url.origin !== location.origin && !ehCDN) return;   // inclui a API do Supabase

  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    const guardado = await c.match(req, {ignoreSearch: true});
    const rede = fetch(req).then(r => {
      if(r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
      return r;
    }).catch(() => null);
    return guardado || (await rede) || Response.error();
  })());
});
