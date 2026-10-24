const CACHE='simplesciplot-1.9.12';
const ASSETS=['./','./index.html','./styles.css?v=1.9.12','./boot-guard-v0154.js?v=1.9.12','./app.js?v=1.9.12','./chart-fixes.js?v=1.9.12','./template-fixes.js?v=1.9.12'];
const same=q=>new URL(q.url).origin===self.location.origin;
async function put(q,r){if(!r||!r.ok||r.type==='opaque')return;try{await(await caches.open(CACHE)).put(q,r.clone())}catch(e){}}
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(CACHE);await Promise.allSettled(ASSETS.map(a=>c.add(a)));await self.skipWaiting()})())});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const ks=await caches.keys();await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})())});
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET'||!same(q))return;e.respondWith((async()=>{try{const r=await fetch(q,{cache:'no-store'});await put(q,r);return r}catch(_){const c=await caches.match(q)||await caches.match(q,{ignoreSearch:true});if(c)return c;if(q.mode==='navigate'){const sh=await caches.match('./index.html')||await caches.match('./');if(sh)return sh}throw _}})())});