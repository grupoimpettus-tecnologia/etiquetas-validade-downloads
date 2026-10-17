// Termos de uso pelo site. Quem usa só o Painel de Gestão, a Contagem ou o
// celular lê e aceita aqui, com o próprio login, sem depender do app do
// computador (a troca da senha provisória continua lá). A única escrita é
// aceitar_termos (aceite-api.js); o texto e a versão são os mesmos do app
// (shared/termos.js). Depois do aceite, volta para a página de origem
// (?volta=painel ou ?volta=contagem).
import { NUVEM_PADRAO } from '../main/nuvem-config.js';
import { TERMOS, VERSAO_TERMOS } from '../shared/termos.js';
import { ApiAceite } from './aceite-api.js';
import { usuarioDoToken } from './contagem-logica.js';
import { SessaoPainel } from './sessao.js';

// Não roda dentro de outra página (evita sobreposição/clickjacking: o aceite é um clique).
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Termos abertos dentro de outra página.');
}

/** Para onde voltar: lista fechada (nunca um endereço vindo do link). */
const VOLTAS = Object.freeze({ painel: './', contagem: 'contagem.html' });
const volta = VOLTAS[new URLSearchParams(location.search).get('volta')] || VOLTAS.painel;
const TELAS = ['tela-login', 'tela-termos', 'tela-senha'];

const $ = (id) => document.getElementById(id);
const sessao = new SessaoPainel(NUVEM_PADRAO);
const api = new ApiAceite(sessao);

/** Cria elementos sem innerHTML. */
function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f instanceof Node ? f : String(f));
  return n;
}

function mostrar(id) {
  for (const t of TELAS) $(t).hidden = t !== id;
  window.scrollTo(0, 0);
}

function erroEm(id, texto) {
  $(id).textContent = texto || '';
  $(id).hidden = !texto;
}

// ---------- Entrada ----------

function mostrarLogin(mensagem = '') {
  mostrar('tela-login');
  erroEm('login-erro', mensagem);
}

$('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const botao = $('btn-entrar');
  erroEm('login-erro', '');
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  try {
    await sessao.entrar($('login-email').value, $('login-senha').value, $('login-manter').checked);
    $('login-senha').value = '';
    abrirTermos();
  } catch (e) {
    erroEm('login-erro', e.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

// Computador ou celular compartilhado: o aceite fica no nome de quem está conectado.
$('btn-trocar').addEventListener('click', async () => {
  await sessao.sair();
  mostrarLogin();
});

// ---------- Leitura e aceite ----------

function liberar() {
  const texto = $('termos-texto');
  if (texto.scrollTop + texto.clientHeight >= texto.scrollHeight - 12) {
    $('termos-check').disabled = false;
    $('termos-rolagem').textContent = '✓ Leitura concluída.';
  }
}

function abrirTermos() {
  const quem = usuarioDoToken(sessao.atual?.token);
  $('termos-email').textContent = quem?.email || 'quem está conectado';
  $('termos-texto').scrollTop = 0;
  $('termos-check').checked = false;
  $('termos-check').disabled = true;
  $('btn-aceitar').disabled = true;
  $('termos-rolagem').textContent = '⬇️ Role até o fim para liberar o aceite.';
  erroEm('termos-erro', '');
  mostrar('tela-termos');
  setTimeout(liberar, 50);
}

$('termos-texto').addEventListener('scroll', liberar);
$('termos-check').addEventListener('change', () => ($('btn-aceitar').disabled = !$('termos-check').checked));

$('btn-aceitar').addEventListener('click', async () => {
  const botao = $('btn-aceitar');
  botao.disabled = true;
  botao.textContent = 'Registrando…';
  erroEm('termos-erro', '');
  try {
    const r = await api.aceitar(VERSAO_TERMOS);
    // A senha provisória continua sendo trocada no app do computador.
    if (r?.senhaPendente) return mostrar('tela-senha');
    location.replace(volta);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return mostrarLogin(e.message);
    erroEm('termos-erro', e.message);
    botao.disabled = !$('termos-check').checked;
  } finally {
    botao.textContent = 'Aceitar e continuar';
  }
});

// ---------- Início ----------

$('termos-versao').textContent = VERSAO_TERMOS;
$('termos-texto').replaceChildren(
  ...TERMOS.flatMap((t) => [el('h3', {}, t.titulo), el('p', {}, t.texto)]),
  el('p', { class: 'termos-fim' }, '— Fim dos termos —'),
);
for (const id of ['link-agora-nao', 'link-voltar']) $(id).href = volta;
$('copyright').textContent = `© ${new Date().getFullYear()} Prazzo. Todos os direitos reservados.`;

if (sessao.logado) abrirTermos();
else mostrarLogin();
