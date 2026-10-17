// Contagem: lê o QR da imagem da câmera em segundo plano (worker), para a tela
// não travar em celulares mais fracos. Usado quando o navegador não tem leitor
// de QR próprio (BarcodeDetector), como no iPhone. Script clássico de worker.
/* global jsQR */
importScripts('jsQR.js');

self.addEventListener('message', (ev) => {
  const { id, largura, altura, dados } = ev.data || {};
  let texto = null;
  try {
    // Etiqueta impressa: QR preto no fundo branco, não precisa testar invertido.
    const r = jsQR(new Uint8ClampedArray(dados), largura, altura, { inversionAttempts: 'dontInvert' });
    texto = r?.data || null;
  } catch {
    texto = null;
  }
  self.postMessage({ id, texto });
});
