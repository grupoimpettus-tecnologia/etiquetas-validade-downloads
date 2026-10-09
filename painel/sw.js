// Painel de gestão e Contagem: permite instalar como app e abrir as telas sem internet.
// Arquivos do próprio painel: sempre busca a versão nova na rede e guarda uma
// cópia só para quando estiver sem conexão. Dados da nuvem nunca são guardados.
const CACHE = 'painel-v2'; // v2: tela de Contagem (contagem.html, leitor de QR)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== CACHE) await caches.delete(nome);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith((async () => {
    try {
      const resp = await fetch(req, { cache: 'no-cache' });
      if (resp.ok) (await caches.open(CACHE)).put(req, resp.clone());
      return resp;
    } catch (e) {
      const salvo = await caches.match(req);
      if (salvo) return salvo;
      throw e;
    }
  })());
});
