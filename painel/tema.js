// Tema claro e escuro do site (Painel de Gestão, Contagem, Termos de uso e
// Painel do Proprietário).
//
// Script clássico (não é módulo) carregado no <head>, antes do CSS: põe
// data-tema="claro" | "escuro" no <html> antes de a página ser pintada, então
// nada pisca. Padrão: o tema do sistema (prefers-color-scheme) até a pessoa
// escolher no botão ☀️/🌙; a escolha fica neste aparelho (localStorage, chave
// 'prazzo-tema') e vale na hora, sem recarregar, também nas outras abas abertas.
// Arquivo próprio por causa da CSP (script-src 'self', sem 'unsafe-inline').
// Só grava quando a pessoa clica no botão, e nada aqui fala com a nuvem.
//
// O botão é qualquer elemento com data-tema-botao (o clique é ouvido no
// documento, então vale também para botões criados depois). Ele oferece o
// outro tema: no escuro mostra ☀️ "Tema claro"; no claro, 🌙 "Tema escuro" (o
// ícone sai do CSS, pelo data-tema; o title e o aria-label, daqui).
(() => {
  'use strict';

  const janela = globalThis;
  const doc = janela.document;
  const CHAVE = 'prazzo-tema';
  const TEMAS = Object.freeze(['claro', 'escuro']);
  const CONSULTA_CLARO = '(prefers-color-scheme: light)';
  /** Cor da barra do navegador no celular (meta theme-color): o fundo de cada tema. */
  const COR_DA_BARRA = Object.freeze({ escuro: '#0e0e10', claro: '#f4f4f6' });
  /** O botão leva ao outro tema. */
  const ROTULO_DO_BOTAO = Object.freeze({ escuro: 'Tema claro', claro: 'Tema escuro' });

  /** Escolha feita nesta página quando o aparelho não deixa guardar (aba anônima, armazenamento bloqueado). */
  let escolhaDaPagina = null;

  /** O armazenamento do aparelho, ou null (o simples acesso pode lançar erro com o armazenamento bloqueado). */
  function armazenamento() {
    try {
      return janela.localStorage || null;
    } catch {
      return null;
    }
  }

  /** A escolha guardada; null sem escolha, com valor estranho ou com o armazenamento bloqueado. */
  function escolhaGuardada(guarda = armazenamento()) {
    try {
      const v = guarda ? guarda.getItem(CHAVE) : null;
      return TEMAS.includes(v) ? v : null;
    } catch {
      return null;
    }
  }

  /** O tema do sistema: claro só quando o sistema pede claro; sem resposta, o escuro (o de sempre). */
  function temaDoSistema(origem = janela) {
    try {
      return typeof origem.matchMedia === 'function' && origem.matchMedia(CONSULTA_CLARO).matches ? 'claro' : 'escuro';
    } catch {
      return 'escuro';
    }
  }

  /** O tema que vale agora: a escolha guardada, a desta página ou o do sistema. */
  function temaAtual() {
    return escolhaGuardada() || escolhaDaPagina || temaDoSistema();
  }

  function aplicar(tema = temaAtual()) {
    if (!doc || !doc.documentElement) return tema;
    const raiz = doc.documentElement;
    if (raiz.getAttribute('data-tema') !== tema) raiz.setAttribute('data-tema', tema);
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta && meta.getAttribute('content') !== COR_DA_BARRA[tema]) meta.setAttribute('content', COR_DA_BARRA[tema]);
    for (const botao of doc.querySelectorAll('[data-tema-botao]')) {
      botao.setAttribute('title', ROTULO_DO_BOTAO[tema]);
      botao.setAttribute('aria-label', ROTULO_DO_BOTAO[tema]);
    }
    return tema;
  }

  /** Guarda a escolha neste aparelho (se der) e aplica na hora. Valor estranho não muda nada. */
  function escolher(tema) {
    if (!TEMAS.includes(tema)) return aplicar();
    escolhaDaPagina = tema;
    try {
      const guarda = armazenamento();
      if (guarda) guarda.setItem(CHAVE, tema);
    } catch {
      // Armazenamento cheio ou bloqueado: a escolha vale só enquanto esta página estiver aberta.
    }
    return aplicar(tema);
  }

  function alternar() {
    const agora = doc && doc.documentElement ? doc.documentElement.getAttribute('data-tema') : null;
    return escolher((TEMAS.includes(agora) ? agora : temaAtual()) === 'claro' ? 'escuro' : 'claro');
  }

  // Antes de pintar: o atributo no <html> (o CSS escolhe as cores por ele).
  aplicar();

  if (doc) {
    // Os botões ainda não existem no <head>: os rótulos entram quando o resto da página chega.
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => aplicar());
    doc.addEventListener('click', (ev) => {
      const alvo = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('[data-tema-botao]') : null;
      if (alvo) alternar();
    });
  }
  // Sem escolha, acompanha o sistema quando ele troca de tema (ex.: modo escuro automático à noite).
  try {
    const consulta = typeof janela.matchMedia === 'function' ? janela.matchMedia(CONSULTA_CLARO) : null;
    if (consulta && typeof consulta.addEventListener === 'function') consulta.addEventListener('change', () => aplicar());
    else if (consulta && typeof consulta.addListener === 'function') consulta.addListener(() => aplicar());
  } catch {
    // Navegador sem a consulta: fica o tema do início.
  }
  // Escolha feita em outra aba deste aparelho: vale aqui também, na hora.
  if (typeof janela.addEventListener === 'function') {
    janela.addEventListener('storage', (ev) => {
      if (ev.key === CHAVE || ev.key === null) aplicar();
    });
  }

  janela.prazzoTema = Object.freeze({ CHAVE, TEMAS, escolhaGuardada, temaDoSistema, temaAtual, escolher, alternar });
})();
