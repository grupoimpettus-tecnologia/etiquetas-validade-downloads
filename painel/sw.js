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
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Na cópia do site na VPS, /api/* é o serviço de e-mail do Prazzo (mesma origem, com o token da
  // sessão): a resposta é dado, não arquivo do painel, e nunca vai para o cache (nem sai dele sem rede).
  if (url.pathname.startsWith('/api/') || req.headers.has('authorization')) return;
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
