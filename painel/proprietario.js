// Painel do Proprietário (site): os clientes do Prazzo, a assinatura de cada
// um e o suporte.
//
// Entrada: e-mail e senha → eh_dono (quem não é o Proprietário vê "Acesso
// restrito" e sai) → clientes. Sem verificação em duas etapas e sem saída por
// inatividade (decisão do dono, 16/10/2026): a sessão fica guardada neste
// navegador, numa chave só deste painel, até clicar em Sair; ao abrir de novo,
// entra direto. Toda chamada à nuvem passa por proprietario-api.js (lista
// fechada); o servidor confere tudo de novo. As do serviço de e-mail do Prazzo
// (aba E-mail, e o envio dos dados de acesso ao criar um cliente ou redefinir
// o acesso de um master) passam por proprietario-email-api.js (lista fechada,
// mesma origem). Nada de innerHTML: o que vem da nuvem entra sempre como texto.
import { NUVEM_PADRAO } from '../main/nuvem-config.js';
import { dataCompleta, dataHoraDeBrasilia, diaDeBrasilia } from './licenca-site.js';
import { ApiProprietario } from './proprietario-api.js';
import { ApiEmail } from './proprietario-email-api.js';
import {
  alertaLojas, CLIENTE_NUMERO_1, configEmailMudou, conexaoMudou, corpoConfigEmail, descreverEvento, descreverPrevia, emailValido,
  enderecoPermitido, estadoEmail, formatarValor, FORMAS_PAGAMENTO, FORMULARIO_JA_ENVIADO, gerarSenhaProvisoria, lerValor, novaOperacao,
  ofertaDeEnvio, PAPEIS, PORTAS_EMAIL, precisaAtencao, PROVEDORES_EMAIL, segurancaDaPorta, situacaoCliente, sugerirPagoAte,
  testeValeParaLigar, textoAcessoRedefinido, textoBloqueio, textoEnvioAcesso, textoParaCliente, textoPausa, textoUltimoTeste,
  ultimoAcesso, validarConfigEmail, voltaAData,
} from './proprietario-logica.js';
import { ErroPainel, SessaoPainel } from './sessao.js';

// Não roda dentro de outra página (evita sobreposição/clickjacking).
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Painel do Proprietário aberto dentro de outra página.');
}

/** Endereço próprio do painel (posto pelo gerar-painel.mjs, PRAZZO_URL_PROPRIETARIO): a URL inteira, ou ''. */
const ENDERECO_PROPRIO = (() => {
  const v = document.querySelector('meta[name="prazzo-endereco-proprietario"]')?.getAttribute('content') || '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !/\.github\.io$/i.test(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
})();

// Só no endereço próprio (na VPS por padrão; nunca no *.github.io, de origem
// dividida) ou num endereço local de testes. Fora dele: um botão leva até lá.
if (!enderecoPermitido(window.location, ENDERECO_PROPRIO ? new URL(ENDERECO_PROPRIO).origin : '')) {
  document.body.className = 'pagina-proprietario na-entrada';
  document.body.replaceChildren(el('section', { class: 'tela-login', id: 'tela-endereco' },
    el('div', { class: 'cartao-login' },
      el('img', { class: 'login-logo', src: 'prazzo-negativo.svg', alt: 'Prazzo' }),
      el('h1', {}, 'Endereço não liberado'),
      el('p', {}, `Por segurança, o Painel do Proprietário só abre no endereço dele. Este endereço (${window.location.host}${window.location.pathname}) não é o do painel.`),
      ENDERECO_PROPRIO && el('a', { class: 'botao-principal', href: ENDERECO_PROPRIO, rel: 'noopener' }, 'Abrir o Painel do Proprietário'),
      el('a', { class: 'botao-secundario botao-largo', href: './' }, 'Ir para o Painel de Gestão'))));
  throw new Error('Painel do Proprietário fora do endereço próprio.');
}

const $ = (id) => document.getElementById(id);
const DIA_MS = 864e5;
const TELAS = ['tela-login', 'tela-restrito', 'tela-clientes', 'tela-cliente', 'tela-novo', 'tela-criado', 'tela-email'];
const ENTRADA = new Set(['tela-login', 'tela-restrito']);

/** Chave da sessão deste painel (o Painel de Gestão, no mesmo endereço, usa a dele). */
const SESSAO_DO_PROPRIETARIO = 'proprietario-sessao';
const sessao = new SessaoPainel(NUVEM_PADRAO, { nomeGuardado: SESSAO_DO_PROPRIETARIO });
const api = new ApiProprietario(sessao);
// Serviço de e-mail no mesmo endereço do painel (caminho relativo: a CSP continua connect-src 'self').
const apiEmail = new ApiEmail(sessao);
/** Link do instalador do app (posto no HTML pelo gerar-painel.mjs). */
const INSTALADOR = (() => {
  const v = document.querySelector('meta[name="prazzo-instalador"]')?.getAttribute('content') || '';
  return /^https:\/\/\S+$/.test(v) ? v : '';
})();

const tela = { atual: '', clientes: [], filtro: '', clienteId: null, criadoId: null };

/** Cria elementos sem innerHTML (todo texto vindo da nuvem entra como texto). */
function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = Boolean(v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f instanceof Node ? f : String(f));
  return n;
}

const n = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;

function novoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function erroEm(id, texto) {
  $(id).textContent = texto || '';
  $(id).hidden = !texto;
}

function aviso(texto) {
  erroEm('aviso', texto);
}

function mensagem(texto) {
  erroEm('mensagem', texto);
}

function mostrar(id) {
  // A senha provisória do cliente novo aparece só na tela "Cliente criado".
  if (tela.atual === 'tela-criado' && id !== 'tela-criado') limparCriado();
  // A senha do servidor de e-mail é só de escrita: digitada e não salva, some ao sair da aba.
  if (tela.atual === 'tela-email' && id !== 'tela-email') $('email-senha').value = '';
  if (tela.atual !== id) {
    aviso('');
    if (!['tela-clientes', 'tela-cliente'].includes(id) || ENTRADA.has(tela.atual)) mensagem('');
  }
  tela.atual = id;
  for (const t of TELAS) $(t).hidden = t !== id;
  const entrada = ENTRADA.has(id);
  $('topo').hidden = entrada;
  document.body.classList.toggle('na-entrada', entrada);
  const abaNovo = id === 'tela-novo' || id === 'tela-criado';
  const abaEmail = id === 'tela-email';
  for (const [aba, atual] of [['aba-clientes', !entrada && !abaNovo && !abaEmail], ['aba-novo', abaNovo], ['aba-email', abaEmail]]) {
    if (atual) $(aba).setAttribute('aria-current', 'page');
    else $(aba).removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}

/** Relógio da nuvem (da última lista de clientes), para "hoje" não depender do relógio do aparelho. */
function agoraServidor() {
  const ms = Date.parse(tela.clientes.find((c) => c?.licenca?.agora)?.licenca?.agora || '');
  return Number.isFinite(ms) ? ms : Date.now();
}

function limparDados() {
  tela.clientes = [];
  tela.clienteId = null;
  tela.criadoId = null;
  $('clientes-corpo').replaceChildren();
  $('historico-corpo').replaceChildren();
  $('cliente-ficha').replaceChildren();
  $('cliente-acoes').replaceChildren();
  limparCriado();
  novo.op = null;
  $('form-novo').reset();
  limparEmail();
}

async function sair(motivo = '') {
  fecharDialogo();
  limparDados();
  // A sessão some daqui na hora; a nuvem é avisada em seguida.
  const saida = sessao.sair();
  mostrar('tela-login');
  erroEm('login-erro', motivo);
  mensagem('');
  await saida;
}
$('btn-sair').addEventListener('click', () => sair());
for (const b of document.querySelectorAll('[data-sair]')) b.addEventListener('click', () => sair());
$('btn-restrito-voltar').addEventListener('click', () => sair());

/**
 * Erros que mudam de tela. Devolve true se tratou:
 * sessão expirada ou desativada → entrada; quem não é o Proprietário → acesso restrito.
 */
function tratarErro(e) {
  if (e?.status === 401 || e?.status === 403) {
    fecharDialogo();
    limparDados();
    mostrar('tela-login');
    erroEm('login-erro', e.message);
    return true;
  }
  if (e?.restrito) {
    fecharDialogo();
    limparDados();
    sessao.sair().catch(() => {});
    mostrar('tela-restrito');
    return true;
  }
  return false;
}

// ---------- Entrada ----------

$('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const botao = $('btn-entrar');
  erroEm('login-erro', '');
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  try {
    // Fica guardada neste navegador até Sair (sem "manter conectado" para escolher).
    await sessao.entrar($('login-email').value, $('login-senha').value, true);
    $('login-senha').value = '';
    await aposEntrar();
  } catch (e) {
    erroEm('login-erro', e.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

async function aposEntrar() {
  let dono;
  try {
    dono = await api.ehDono();
  } catch (e) {
    if (tratarErro(e)) return;
    mostrar('tela-login');
    erroEm('login-erro', e.message);
    return;
  }
  if (!dono) {
    // Nada fica aberto com a conta de quem não é o Proprietário.
    await sessao.sair();
    mostrar('tela-restrito');
    return;
  }
  await abrirClientes();
}

// ---------- Clientes ----------

async function abrirClientes() {
  $('topo-sub').textContent = api.email();
  mostrar('tela-clientes');
  desenharClientes();
  await carregarClientes();
}

$('aba-clientes').addEventListener('click', () => {
  mostrar('tela-clientes');
  desenharClientes();
  carregarClientes();
});
$('btn-atualizar').addEventListener('click', () => carregarClientes());
$('btn-voltar-clientes').addEventListener('click', () => {
  mostrar('tela-clientes');
  desenharClientes();
});

async function carregarClientes() {
  $('clientes-status').textContent = 'Carregando os clientes…';
  try {
    const lista = await api.listarClientes();
    tela.clientes = Array.isArray(lista) ? lista : [];
    const hora = dataHoraDeBrasilia(agoraServidor()).slice(-5);
    $('clientes-status').textContent = `${n(tela.clientes.length, 'cliente', 'clientes')} · atualizado às ${hora}`;
    desenharClientes();
    if (tela.atual === 'tela-cliente') desenharCliente();
    return true;
  } catch (e) {
    if (tratarErro(e)) return false;
    $('clientes-status').textContent = e.message;
    return false;
  }
}

for (const b of document.querySelectorAll('#tela-clientes .chip')) {
  b.addEventListener('click', () => {
    tela.filtro = b.dataset.filtro;
    desenharClientes();
  });
}

/** Célula com rótulo (no celular, a tabela vira cartões e o rótulo aparece ao lado). */
const td = (rotulo, conteudo, classe = '') => el('td', { 'data-rotulo': rotulo, class: classe || null }, conteudo);

function celulaBloqueio(l) {
  if (l.estado === 'consulta') {
    return l.motivo === 'suspensa' ? `suspenso desde ${dataCompleta(l.suspensaEm)}` : l.bloqueadoDesde ? `bloqueado desde ${dataCompleta(l.bloqueadoDesde)}` : 'bloqueado';
  }
  if (l.semVencimento) return '—';
  return textoBloqueio(l.bloqueiaEm) || '—';
}

function desenharClientes() {
  const atencao = tela.clientes.filter(precisaAtencao);
  $('conta-atencao').textContent = atencao.length ? String(atencao.length) : '';
  for (const b of document.querySelectorAll('#tela-clientes .chip')) {
    const ativo = b.dataset.filtro === tela.filtro;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  }
  const lista = tela.filtro === 'atencao' ? atencao : tela.clientes;
  $('clientes-corpo').replaceChildren(...lista.map((c) => {
    const l = c.licenca || {};
    const s = situacaoCliente(l);
    const alerta = alertaLojas(c);
    return el('tr', { dataset: { cliente: c.id } },
      td('Cliente', [
        el('button', { type: 'button', class: 'link-cliente', onclick: () => abrirCliente(c.id) }, c.nome),
        c.documento ? el('small', {}, `CNPJ ${c.documento}`) : null,
      ], 'principal'),
      td('Situação', el('span', { class: `chip-situacao ${s.classe}` }, s.texto)),
      td('Pago até', l.semVencimento ? '—' : dataCompleta(l.pagoAte) || '—', 'num'),
      td('Bloqueia em', celulaBloqueio(l), 'num'),
      td('Valor mensal', formatarValor(l.valorMensal), 'num'),
      el('td', { 'data-rotulo': 'Lojas', class: `num${alerta ? ' alerta-celula' : ''}`, title: alerta || 'ativas / com etiqueta nos últimos 30 dias / contratadas' },
        el('span', {}, `${c.lojasAtivas ?? 0} / ${c.lojasComEtiqueta30d ?? 0} / ${l.lojasContratadas ?? '—'}`,
          alerta ? el('span', { 'aria-hidden': 'true' }, ' ⚠') : null,
          alerta ? el('span', { class: 'so-leitor' }, ` ${alerta}`) : null)),
      td('Usuários', String(c.usuariosAtivos ?? 0), 'num'),
      td('Última etiqueta', c.ultimaEtiqueta ? dataHoraDeBrasilia(c.ultimaEtiqueta) : 'nenhuma', 'num'),
      td('Números em aberto', [String(c.numerosEmAberto ?? 0), c.reservasAntigas ? el('small', {}, `+ ${c.reservasAntigas} de reserva antigos`) : null], 'num'));
  }));
  if (!lista.length && tela.clientes.length) {
    $('clientes-corpo').append(el('tr', {}, el('td', { colspan: '9', class: 'vazio-tabela' }, 'Nenhum cliente precisa de atenção agora.')));
  }
}

// ---------- Um cliente ----------

const clienteAtual = () => tela.clientes.find((c) => c.id === tela.clienteId) || null;

function abrirCliente(id) {
  tela.clienteId = id;
  mostrar('tela-cliente');
  desenharCliente();
  $('historico-corpo').replaceChildren();
  carregarHistorico();
}

function item(rotulo, valor) {
  return el('div', {}, el('dt', {}, rotulo), el('dd', {}, valor || '—'));
}

function desenharCliente() {
  const c = clienteAtual();
  if (!c) {
    mostrar('tela-clientes');
    desenharClientes();
    return;
  }
  const l = c.licenca || {};
  const s = situacaoCliente(l);
  const numero1 = c.id === CLIENTE_NUMERO_1;
  $('cliente-nome').textContent = c.nome;
  $('cliente-chip').className = `chip-situacao ${s.classe}`;
  $('cliente-chip').textContent = s.texto;
  const alerta = alertaLojas(c);
  $('cliente-alerta').textContent = alerta ? `⚠ ${alerta} Confira com o cliente e, se for o caso, ajuste as lojas contratadas em "Configurar".` : '';
  $('cliente-alerta').hidden = !alerta;
  const contato = [c.contato?.nome, c.contato?.email, c.contato?.telefone].filter(Boolean).join(' · ');
  $('cliente-ficha').replaceChildren(...[
    item('Pago até', l.semVencimento ? 'sem vencimento' : dataCompleta(l.pagoAte)),
    item('Bloqueia em', celulaBloqueio(l)),
    l.semVencimento ? null : item('Dias extras até', l.liberadoAte ? dataCompleta(l.liberadoAte) : 'nenhum'),
    l.semVencimento ? null : item('Aviso e tolerância', `${n(l.diasAviso ?? 0, 'dia', 'dias')} antes · ${n(l.diasTolerancia ?? 0, 'dia', 'dias')} depois`),
    item('Valor mensal', formatarValor(l.valorMensal)),
    item('Lojas', `${c.lojasAtivas ?? 0} ativas · ${c.lojasComEtiqueta30d ?? 0} com etiqueta em 30 dias · ${c.lojasCriadas30d ?? 0} cadastradas em 30 dias · ${l.lojasContratadas ?? '—'} contratadas`),
    item('Usuários ativos', String(c.usuariosAtivos ?? 0)),
    item('Última etiqueta', c.ultimaEtiqueta ? dataHoraDeBrasilia(c.ultimaEtiqueta) : 'nenhuma'),
    item('Números em aberto', `${c.numerosEmAberto ?? 0} nos últimos 30 dias${c.reservasAntigas ? ` · ${c.reservasAntigas} de reserva mais antigos` : ''}`),
    item('Contato', contato),
    item('CNPJ', c.documento),
    item('Termos de uso', c.versaoTermos ? `versão ${c.versaoTermos}` : 'a versão do app'),
    item('Cliente desde', c.criadoEm ? dataCompleta(c.criadoEm) : ''),
  ].filter(Boolean));
  const botao = (texto, acao, classe = '') => el('button', { type: 'button', class: `botao-secundario ${classe}`.trim(), onclick: acao }, texto);
  $('cliente-acoes').replaceChildren(...[
    numero1 ? null : botao('Registrar pagamento', () => formPagamento(c)),
    l.semVencimento ? null : botao('Dar dias extras', () => formDias(c)),
    l.liberadoAte ? botao('Zerar dias extras', () => formZerar(c)) : null,
    numero1 ? null : l.suspensa ? botao('Reativar', () => formReativar(c)) : botao('Suspender agora', () => formSuspender(c), 'botao-perigo-contorno'),
    botao('Configurar', () => formConfigurar(c)),
    botao('Suporte', () => abrirSuporte(c)),
  ].filter(Boolean));
}

async function carregarHistorico() {
  const id = tela.clienteId;
  if (!id) return;
  $('historico-status').textContent = 'Carregando o histórico…';
  try {
    const eventos = await api.historico(id, 200);
    if (id !== tela.clienteId) return;
    const lista = Array.isArray(eventos) ? eventos : [];
    $('historico-corpo').replaceChildren(...lista.map((ev) => {
      const d = descreverEvento(ev);
      return el('tr', {},
        td('Quando', d.quando, 'num'), td('Quem', d.quem), td('O quê', d.oque), td('Antes → depois', d.mudanca),
        td('Dias', d.dias, 'num'), td('Valor', d.valor, 'num'), td('Forma', d.forma), td('Referência', d.referencia), td('Observação', d.observacao));
    }));
    if (!lista.length) $('historico-corpo').append(el('tr', {}, el('td', { colspan: '9', class: 'vazio-tabela' }, 'Nada registrado ainda.')));
    $('historico-status').textContent = lista.length >= 200 ? 'Mostrando os 200 registros mais recentes.' : '';
  } catch (e) {
    if (tratarErro(e)) return;
    $('historico-status').textContent = e.message;
  }
}

// ---------- Diálogo das ações (um formulário de cada vez) ----------

const dialogo = { op: null, valores: null, aoEnviar: null, aoMudar: null, podeEnviar: null, rotulo: '', ocupado: false, voltarFoco: null };
/** Resposta de um envio que só mostrou a prévia (nada gravado). */
const PREVIA = Symbol('previa');

/** Enviando: nada no formulário muda nem fecha até a nuvem responder (ou o tempo acabar). */
function ocupar(sim) {
  dialogo.ocupado = sim;
  $('dialogo-fechar').disabled = sim;
  $('dialogo-corpo').inert = sim;
  const b = $('dialogo-enviar');
  if (sim) {
    b.disabled = true;
    b.textContent = 'Enviando…';
  } else if (dialogo.aoEnviar) {
    b.textContent = dialogo.rotulo;
    b.disabled = Boolean(dialogo.podeEnviar && !dialogo.podeEnviar(dialogo.valores()));
  }
}

/**
 * Abre um formulário. Cada abertura é uma operação nova (operacao_id); outro
 * conteúdo dos campos, outra operação; o mesmo conteúdo (reenviar sem mudar
 * nada, ou mudar e desfazer) repete a mesma, e a nuvem só confirma o que já
 * gravou.
 */
function abrirDialogo({ titulo, corpo, enviar = '', perigo = false, valores = () => ({}), aoEnviar = null, aoMudar = null, podeEnviar = null }) {
  if (!sessao.logado) return;
  if (!$('dialogo').open) dialogo.voltarFoco = document.activeElement;
  mensagem('');
  $('dialogo-titulo').textContent = titulo;
  $('dialogo-corpo').replaceChildren(...corpo.filter(Boolean));
  erroEm('dialogo-erro', '');
  Object.assign(dialogo, { valores, aoEnviar, aoMudar, podeEnviar, rotulo: enviar, op: novaOperacao(novoId) });
  dialogo.op.campos(valores());
  ocupar(false);
  const b = $('dialogo-enviar');
  b.hidden = !aoEnviar;
  b.textContent = enviar;
  b.classList.toggle('perigo', perigo);
  b.disabled = Boolean(podeEnviar && !podeEnviar(valores()));
  $('dialogo-fechar').textContent = aoEnviar ? 'Cancelar' : 'Fechar';
  if (!$('dialogo').open) $('dialogo').showModal();
  const primeiro = $('dialogo-corpo').querySelector('input:not([disabled]):not([type="hidden"]), select, textarea');
  (primeiro || $('dialogo-fechar')).focus();
}

/** Some tudo o que estava no diálogo (inclusive uma senha provisória mostrada). */
function limparDialogo() {
  $('dialogo-corpo').replaceChildren();
  $('dialogo-corpo').inert = false;
  $('dialogo-fechar').disabled = false;
  erroEm('dialogo-erro', '');
  Object.assign(dialogo, { op: null, valores: null, aoEnviar: null, aoMudar: null, podeEnviar: null, ocupado: false });
}

function fecharDialogo() {
  if ($('dialogo').open) $('dialogo').close();
  limparDialogo();
}

// Enviando, o Esc não fecha (e o "Cancelar" fica desabilitado): a resposta tem
// de cair no formulário que a pediu.
$('dialogo').addEventListener('cancel', (ev) => {
  if (dialogo.ocupado) ev.preventDefault();
});
// Fechado também pelo Esc: limpa (se não abriu outro nesse meio-tempo) e devolve o foco.
$('dialogo').addEventListener('close', () => {
  if (!$('dialogo').open) limparDialogo();
  const volta = dialogo.voltarFoco;
  dialogo.voltarFoco = null;
  if (volta && document.contains(volta)) volta.focus();
});
$('dialogo-fechar').addEventListener('click', () => {
  if (!dialogo.ocupado) fecharDialogo();
});

function aoMudarDialogo() {
  if (!dialogo.op || dialogo.ocupado) return;
  const v = dialogo.valores();
  dialogo.op.campos(v);
  dialogo.aoMudar?.(v);
  if (dialogo.podeEnviar) $('dialogo-enviar').disabled = !dialogo.podeEnviar(v);
}
$('dialogo-form').addEventListener('input', aoMudarDialogo);
$('dialogo-form').addEventListener('change', aoMudarDialogo);

$('dialogo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!dialogo.aoEnviar || dialogo.ocupado) return;
  const v = dialogo.valores();
  // Esta instância do formulário: a resposta só vale para ela, mesmo que outro abra no meio-tempo.
  const meu = dialogo.op;
  const operacao = meu.campos(v);
  if (meu.divergente) {
    erroEm('dialogo-erro', FORMULARIO_JA_ENVIADO);
    return;
  }
  const enviar = dialogo.aoEnviar;
  const titulo = $('dialogo-titulo').textContent;
  const rotulo = dialogo.rotulo;
  const vigente = () => dialogo.op === meu && $('dialogo').open;
  const ctx = {
    vigente,
    // Reenvio depois de um envio sem resposta certa (o anterior pode ter sido gravado).
    reenvio: meu.incerto,
    // Concluído: fecha ESTE formulário; se ele já saiu da tela, só avisa (sem fechar outro aberto agora).
    concluir: (textoFinal) => concluir(textoFinal, { fechar: vigente() || !$('dialogo').open }),
  };
  ocupar(true);
  erroEm('dialogo-erro', '');
  try {
    // A prévia não grava nem diz se um envio anterior foi gravado: não libera o formulário.
    if ((await enviar(v, operacao, ctx)) !== PREVIA) meu.respondida();
  } catch (e) {
    // Só a resposta da nuvem libera o formulário (uma conferência daqui não diz nada sobre o envio anterior).
    if (e.incerto) meu.marcarIncerto();
    else if (e.status) meu.respondida();
    if (tratarErro(e)) return;
    if (!vigente()) {
      // A resposta chegou depois que este formulário saiu da tela: aviso geral, com o cliente e a ação.
      aviso(`${titulo}: ${e.message}${e.incerto ? ' Pode já ter sido gravado: confira o histórico do cliente antes de repetir (um formulário novo é outra operação).' : ''}`);
      return;
    }
    erroEm('dialogo-erro', e.incerto
      ? `${e.message} Pode já ter sido gravado: toque em “${rotulo}” de novo sem mudar nada (se já foi, a nuvem só confirma).`
      : e.message);
  } finally {
    if (dialogo.op === meu) {
      ocupar(false);
      // O botão desabilitado (e os campos travados) perderam o foco: volta para o formulário.
      if ($('dialogo').open && !$('dialogo').contains(document.activeElement)) {
        ($('dialogo-enviar').disabled ? $('dialogo-fechar') : $('dialogo-enviar')).focus();
      }
    }
  }
});

/**
 * Avisa e recarrega o cliente e o histórico. Fecha o diálogo, a não ser que a
 * resposta seja de um formulário que já saiu da tela (outro aberto agora).
 */
async function concluir(textoFinal, { fechar = true } = {}) {
  if (fechar) fecharDialogo();
  mensagem(textoFinal);
  await carregarClientes();
  if (tela.atual === 'tela-cliente') carregarHistorico();
}

/** Campo com rótulo (e ajuda). */
function campo(id, rotulo, entrada, ajuda = '') {
  entrada.id = id;
  return el('div', { class: 'campo-dialogo' },
    el('label', { class: 'rotulo', for: id }, rotulo),
    entrada,
    ajuda ? el('p', { class: 'ajuda-campo', id: `${id}-ajuda` }, ajuda) : null);
}
const texto = (props = {}) => el('input', { class: 'campo', type: 'text', autocomplete: 'off', ...props });
const areaObservacao = (obrigatoria) => el('textarea', { class: 'campo', maxlength: '500', rows: '2', required: obrigatoria || null });
const valorDe = (id) => $(id)?.value ?? '';

/** Valor em reais digitado: null (vazio) ou o número; recusa o resto. */
function valorDigitado(textoValor) {
  const v = lerValor(textoValor);
  if (Number.isNaN(v) || (v !== null && v < 0)) throw new ErroPainel('Valor inválido. Use só números, por exemplo 199,90.');
  return v;
}
const valorParaCampo = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));

// ---------- Registrar pagamento ----------

function formPagamento(c) {
  const l = c.licenca || {};
  const atual = l.pagoAte || null;
  abrirDialogo({
    titulo: `Registrar pagamento · ${c.nome}`,
    corpo: [
      el('p', {}, atual ? `Hoje está pago até ${dataCompleta(atual)}. A data sugerida é a de agora + 1 mês.` : 'Ainda sem "pago até". A data sugerida é hoje + 1 mês.'),
      campo('pg-pago-ate', 'Pago até *', el('input', { class: 'campo', type: 'date', required: true, value: sugerirPagoAte(atual, agoraServidor()) }), ''),
      campo('pg-valor', 'Valor (R$)', texto({ inputmode: 'decimal', placeholder: '0,00', value: valorParaCampo(l.valorMensal) })),
      campo('pg-forma', 'Forma', el('select', { class: 'campo' }, ...FORMAS_PAGAMENTO.map(([v, nome]) => el('option', { value: v }, nome)))),
      campo('pg-referencia', 'Referência (ex.: comprovante, nº do boleto)', texto({ maxlength: '120' })),
      campo('pg-observacao', 'Observação', areaObservacao(false)),
    ],
    enviar: 'Registrar pagamento',
    valores: () => ({ pagoAte: valorDe('pg-pago-ate'), valor: valorDe('pg-valor'), forma: valorDe('pg-forma'), referencia: valorDe('pg-referencia'), observacao: valorDe('pg-observacao') }),
    aoMudar: (v) => {
      // Voltar a data exige motivo (a nuvem grava como ajuste).
      const volta = voltaAData(atual, v.pagoAte);
      $('pg-observacao').required = volta;
      $('pg-observacao').previousElementSibling.textContent = volta ? 'Observação * (obrigatória: a data volta para trás)' : 'Observação';
    },
    aoEnviar: async (v, operacao, ctx) => {
      const r = await api.registrarPagamento({
        operacao, cliente: c.id, pagoAte: v.pagoAte, valor: valorDigitado(v.valor), forma: v.forma, referencia: v.referencia.trim(), observacao: v.observacao.trim(),
      });
      await ctx.concluir(`${r?.tipo === 'ajuste' ? 'Ajuste registrado' : 'Pagamento registrado'}: ${c.nome} pago até ${dataCompleta(r?.pagoAteDepois)}.${r?.suspensa ? ' O cliente continua suspenso: para liberar, use "Reativar".' : ''}`);
    },
  });
  $('pg-forma').value = 'manual';
}

// ---------- Dias extras ----------

function formDias(c) {
  let previa = null;
  const caixa = el('p', { class: 'previa', id: 'dias-previa', role: 'status', hidden: true });
  const limparPrevia = () => {
    previa = null;
    caixa.hidden = true;
    caixa.textContent = '';
    dialogo.rotulo = 'Ver prévia';
    if (!dialogo.ocupado) $('dialogo-enviar').textContent = 'Ver prévia';
  };
  abrirDialogo({
    titulo: `Dar dias extras · ${c.nome}`,
    corpo: [
      el('p', {}, 'Os dias extras adiam o BLOQUEIO sem mexer no "pago até". Bloqueado: N dias a partir de hoje. Ainda liberado: N dias depois do bloqueio previsto.'),
      campo('dias-quantidade', 'Dias extras (1 a 90) *', el('input', { class: 'campo', type: 'number', required: true, min: '1', max: '90', step: '1', inputmode: 'numeric' })),
      campo('dias-observacao', 'Observação * (o motivo)', areaObservacao(true)),
      caixa,
    ],
    enviar: 'Ver prévia',
    valores: () => ({ dias: valorDe('dias-quantidade'), observacao: valorDe('dias-observacao') }),
    aoMudar: limparPrevia,
    aoEnviar: async (v, operacao, ctx) => {
      const dias = Number(v.dias);
      if (!previa) {
        // Prévia: nada é gravado (se o formulário saiu da tela no meio-tempo, ela não vale para nenhum outro).
        const resposta = await api.concederDias({ operacao, cliente: c.id, dias, observacao: v.observacao.trim(), previa: true });
        if (!ctx.vigente()) return PREVIA;
        previa = resposta;
        caixa.textContent = descreverPrevia(previa) + (ctx.reenvio
          ? ' Se o envio anterior (sem resposta) já tinha sido gravado, confirmar só repete aquele: nada é somado de novo.'
          : '');
        caixa.hidden = false;
        dialogo.rotulo = `Confirmar ${n(dias, 'dia extra', 'dias extras')}`;
        return PREVIA;
      }
      const r = await api.concederDias({ operacao, cliente: c.id, dias, observacao: v.observacao.trim(), previa: false });
      await ctx.concluir(`${c.nome}: ${n(dias, 'dia extra', 'dias extras')}. ${descreverPrevia(r)}`);
    },
  });
}

function formZerar(c) {
  const l = c.licenca || {};
  abrirDialogo({
    titulo: `Zerar dias extras · ${c.nome}`,
    corpo: [
      el('p', {}, `Os dias extras (liberado até ${dataCompleta(l.liberadoAte)}) são retirados: o bloqueio volta a seguir só o "pago até" + tolerância. Se esse prazo já passou, o cliente entra em modo consulta na hora.`),
      campo('zerar-observacao', 'Observação * (o motivo, ex.: pagamento estornado)', areaObservacao(true)),
    ],
    enviar: 'Zerar dias extras',
    perigo: true,
    valores: () => ({ observacao: valorDe('zerar-observacao') }),
    aoEnviar: async (v, operacao, ctx) => {
      const r = await api.zerarDiasExtras({ operacao, cliente: c.id, observacao: v.observacao.trim() });
      const depois = r?.licenca?.estado === 'consulta' ? 'O cliente está em modo consulta.' : `O bloqueio agora é em ${textoBloqueio(r?.licenca?.bloqueiaEm) || '—'}.`;
      await ctx.concluir(`Dias extras de ${c.nome} zerados. ${depois}`);
    },
  });
}

// ---------- Suspender / reativar (nunca o cliente nº 1) ----------

function formSuspender(c) {
  const confere = (v) => v.nome.trim().toLowerCase() === c.nome.trim().toLowerCase();
  abrirDialogo({
    titulo: `Suspender agora · ${c.nome}`,
    corpo: [
      el('p', {}, 'Modo consulta na hora: em até 1 minuto, os computadores do cliente param de imprimir etiquetas e de cadastrar. Consultar validades, rastrear e dar baixa continuam. Registrar pagamento NÃO tira a suspensão: só "Reativar".'),
      campo('susp-nome', `Para confirmar, digite o nome do cliente: ${c.nome}`, texto({ required: true, spellcheck: 'false' })),
      campo('susp-observacao', 'Observação', areaObservacao(false)),
    ],
    enviar: 'Suspender agora',
    perigo: true,
    valores: () => ({ nome: valorDe('susp-nome'), observacao: valorDe('susp-observacao') }),
    podeEnviar: confere,
    aoEnviar: async (v, operacao, ctx) => {
      await api.suspender({ operacao, cliente: c.id, confirmacaoNome: v.nome.trim(), observacao: v.observacao.trim() });
      await ctx.concluir(`${c.nome} suspenso: modo consulta a partir de agora.`);
    },
  });
}

function formReativar(c) {
  abrirDialogo({
    titulo: `Reativar · ${c.nome}`,
    corpo: [
      el('p', {}, 'Tira a suspensão. Se o "pago até" + tolerância (ou os dias extras) ainda valem, a impressão e o cadastro voltam em até 1 minuto; senão, o cliente continua em modo consulta por atraso.'),
      campo('reat-observacao', 'Observação', areaObservacao(false)),
    ],
    enviar: 'Reativar',
    valores: () => ({ observacao: valorDe('reat-observacao') }),
    aoEnviar: async (v, operacao, ctx) => {
      const r = await api.reativar({ operacao, cliente: c.id, observacao: v.observacao.trim() });
      await ctx.concluir(`${c.nome} reativado. Situação agora: ${situacaoCliente(r?.licenca).texto}.`);
    },
  });
}

// ---------- Configurar ----------

function formConfigurar(c) {
  const l = c.licenca || {};
  const numero1 = c.id === CLIENTE_NUMERO_1;
  const numero = (props) => el('input', { class: 'campo', type: 'number', step: '1', inputmode: 'numeric', required: true, ...props });
  abrirDialogo({
    titulo: `Configurar · ${c.nome}`,
    corpo: [
      el('div', { class: 'linha-campos' },
        campo('cfg-aviso', 'Aviso (dias antes)', numero({ min: '0', max: '60', value: String(l.diasAviso ?? 7) })),
        campo('cfg-tolerancia', 'Tolerância (dias depois)', numero({ min: '0', max: '60', value: String(l.diasTolerancia ?? 5) }))),
      el('div', { class: 'linha-campos' },
        campo('cfg-valor', 'Valor mensal (R$)', texto({ inputmode: 'decimal', placeholder: '0,00', value: valorParaCampo(l.valorMensal) }), 'Vazio: mantém o atual.'),
        campo('cfg-lojas', 'Lojas contratadas', numero({ min: '1', max: '1000', value: String(l.lojasContratadas ?? 1) }), 'Máximo de lojas que conta no teto de números sem internet.')),
      el('label', { class: 'marcar-campo' },
        el('input', { type: 'checkbox', id: 'cfg-sem-vencimento', checked: Boolean(l.semVencimento), disabled: numero1 || null }),
        el('span', {}, numero1 ? 'Sem vencimento (o cliente nº 1 fica sempre sem vencimento)' : 'Sem vencimento (nunca entra em aviso, atraso ou consulta por data)')),
      campo('cfg-observacao', 'Observação', areaObservacao(false)),
    ],
    enviar: 'Salvar configuração',
    valores: () => ({
      aviso: valorDe('cfg-aviso'), tolerancia: valorDe('cfg-tolerancia'), valor: valorDe('cfg-valor'), lojas: valorDe('cfg-lojas'),
      semVencimento: Boolean($('cfg-sem-vencimento')?.checked), observacao: valorDe('cfg-observacao'),
    }),
    aoEnviar: async (v, operacao, ctx) => {
      // Só o que mudou (o resto vai como "mantém").
      const mud = {};
      if (Number(v.aviso) !== l.diasAviso) mud.diasAviso = Number(v.aviso);
      if (Number(v.tolerancia) !== l.diasTolerancia) mud.diasTolerancia = Number(v.tolerancia);
      const valor = valorDigitado(v.valor);
      if (valor !== null && valor !== Number(l.valorMensal ?? Number.NaN)) mud.valorMensal = valor;
      if (Number(v.lojas) !== l.lojasContratadas) mud.lojasContratadas = Number(v.lojas);
      if (!numero1 && v.semVencimento !== Boolean(l.semVencimento)) mud.semVencimento = v.semVencimento;
      if (!Object.keys(mud).length) throw new ErroPainel('Nada mudou.');
      await api.configurar({ operacao, cliente: c.id, ...mud, observacao: v.observacao.trim() });
      await ctx.concluir(`Configuração de ${c.nome} salva.`);
    },
  });
}

// ---------- Suporte: usuários, acesso de master e reservas antigas ----------

async function abrirSuporte(c) {
  const lista = el('ul', { class: 'lista-usuarios', id: 'suporte-usuarios', 'aria-live': 'polite' });
  const status = el('p', { role: 'status' }, 'Carregando os usuários…');
  abrirDialogo({
    titulo: `Suporte · ${c.nome}`,
    corpo: [
      el('p', {}, 'Os acessos de gestores e operadores o master do cliente redefine no app. Por aqui, só o de um master (por exemplo, o único master perdeu a senha).'),
      status,
      lista,
      el('section', { class: 'secao-dialogo' },
        el('h3', {}, 'Reservas antigas'),
        el('p', {}, c.reservasAntigas
          ? `${n(c.reservasAntigas, 'número de reserva emitido', 'números de reserva emitidos')} há mais de 30 dias e nunca usado (computador formatado?). Descartar tira esses números do teto; uma etiqueta impressa com eles continua subindo.`
          : 'Nenhum número de reserva com mais de 30 dias sem uso.'),
        el('button', { type: 'button', class: 'botao-secundario', onclick: () => formDescartar(c) }, 'Descartar reservas antigas')),
    ],
  });
  try {
    const usuarios = await api.listarUsuarios(c.id);
    if (!lista.isConnected) return;
    status.textContent = Array.isArray(usuarios) && usuarios.length ? '' : 'Nenhum usuário neste cliente.';
    lista.replaceChildren(...(Array.isArray(usuarios) ? usuarios : []).map((u) => el('li', { class: u.ativo ? '' : 'inativo' },
      el('div', { class: 'usuario-textos' },
        el('strong', {}, u.nome),
        el('span', {}, [u.email, PAPEIS[u.papel] || u.papel, u.ativo ? 'ativo' : 'desativado', u.trocarSenha ? 'troca de senha pendente' : null].filter(Boolean).join(' · ')),
        el('span', {}, `Último acesso: ${ultimoAcesso(u.ultimoAcesso, agoraServidor())}`)),
      u.proprietario
        ? el('small', {}, 'Proprietário do Prazzo (a senha desta conta é trocada por ela mesma, em "Trocar senha")')
        : u.papel === 'master'
          ? el('button', { type: 'button', class: 'botao-secundario', onclick: () => formRedefinir(c, u) }, 'Redefinir acesso')
          : null)));
  } catch (e) {
    if (tratarErro(e)) return;
    status.textContent = e.message;
  }
}

function formRedefinir(c, u) {
  // Uma senha por operação: o reenvio (mesma operação) manda a mesma senha, que é a que a nuvem guardou.
  const senhas = new Map();
  // Fora dos valores do formulário: marcar ou desmarcar não vira outra operação na nuvem.
  const caixa = caixaDeEnvio('redef-enviar-email');
  const ajuda = el('p', { class: 'ajuda-campo', id: 'redef-email-ajuda' }, 'Conferindo o envio de e-mails…');
  abrirDialogo({
    titulo: `Redefinir acesso · ${u.nome}`,
    corpo: [
      el('p', {}, `Uma senha provisória nova é criada para ${u.nome} (${u.email}), master de ${c.nome}. Ela aparece uma vez só, aqui, para você mandar; no próximo acesso o app pede uma senha nova.`),
      campo('redef-observacao', 'Observação * (o motivo, ex.: pedido do cliente por telefone)', areaObservacao(true)),
      el('label', { class: 'marcar-campo', for: 'redef-enviar-email' }, caixa, el('span', {}, `Mandar a senha provisória por e-mail para ${u.email}`)),
      ajuda,
    ],
    enviar: 'Redefinir acesso',
    perigo: true,
    valores: () => ({ observacao: valorDe('redef-observacao') }),
    aoEnviar: async (v, operacao, ctx) => {
      if (!senhas.has(operacao)) senhas.set(operacao, gerarSenhaProvisoria());
      const senha = senhas.get(operacao);
      // Lido antes de chamar a nuvem (enquanto envia, o formulário fica travado).
      const mandar = caixa.checked && !caixa.disabled;
      const r = await api.redefinirAcessoMaster({ operacao, cliente: c.id, usuario: u.id, senha, observacao: v.observacao.trim() });
      // O e-mail sai só depois que a nuvem confirmou a senha nova (a mesma desta operação).
      const destino = { usuarioId: r?.usuarioId || u.id, senha, tipo: 'nova-senha' };
      // A senha só aparece se nada tomou o lugar deste formulário (nem outro formulário, nem a saída).
      if (!ctx.vigente() && ($('dialogo').open || !sessao.logado)) {
        if (mandar && sessao.logado) {
          // Ela não aparece, mas o e-mail marcado ainda leva a senha a quem precisa.
          aviso(`O acesso de ${u.nome} (${c.nome}) foi redefinido, mas a senha provisória não pôde ser mostrada porque este formulário saiu da tela. Mandando a senha por e-mail…`);
          mandarAcesso(destino).then(({ texto, ok }) => {
            if (texto && sessao.logado) aviso(`Acesso de ${u.nome} (${c.nome}) redefinido. ${texto}${ok ? '' : ' Redefina de novo para gerar outra senha.'}`);
          });
        } else {
          aviso(`O acesso de ${u.nome} (${c.nome}) foi redefinido, mas a senha provisória não pôde ser mostrada porque este formulário saiu da tela. Redefina de novo para gerar outra senha.`);
        }
        return;
      }
      const para = r?.email || u.email;
      const linha = mostrarSenhaUmaVez(r?.nome || u.nome, para, senha);
      if (mandar) {
        resultadoEmail(linha, `Mandando a senha provisória por e-mail para ${para}…`, null);
        mandarAcesso(destino).then(({ texto, ok }) => {
          if (!texto) return;
          if (linha.isConnected) resultadoEmail(linha, texto, ok);
          else if (sessao.logado) (ok ? mensagem : aviso)(`${u.nome} (${c.nome}): ${texto}`);
        });
      }
      carregarHistorico();
    },
  });
  prepararCaixaDeEnvio(caixa, ajuda);
}

// ---------- A senha da conta do Proprietário ----------

/**
 * Troca a senha da própria conta (a mesma do app e do Painel de Gestão; no app,
 * "Trocar senha" também serve).
 */
function formTrocarSenha() {
  let semResposta = false;
  const senha = () => el('input', { class: 'campo', type: 'password', autocomplete: 'new-password', required: true, minlength: '8', spellcheck: 'false' });
  abrirDialogo({
    titulo: 'Trocar a minha senha',
    corpo: [
      el('p', {}, `Troca a senha da sua conta (${api.email()}), a mesma do app e do Painel de Gestão. Os outros computadores e celulares conectados com ela pedem a senha nova (em até 1 hora); esta sessão continua.`),
      campo('senha-nova', 'Senha nova * (pelo menos 8 caracteres)', senha()),
      campo('senha-repetir', 'Repita a senha nova *', senha()),
    ],
    enviar: 'Trocar senha',
    // As senhas não entram no conteúdo do formulário (não há operacao_id nesta ação).
    valores: () => ({}),
    aoEnviar: async (_v, _operacao, ctx) => {
      const nova = valorDe('senha-nova');
      if (nova !== valorDe('senha-repetir')) throw new ErroPainel('As duas senhas não são iguais.');
      try {
        await api.trocarSenha(nova);
      } catch (e) {
        // Depois de uma resposta perdida, "igual à atual" quer dizer que a troca já tinha valido.
        if (!(semResposta && e.codigo === 'same_password')) {
          if (!e.incerto) throw e;
          semResposta = true;
          throw new ErroPainel(`${e.message} A senha pode já ter sido trocada: toque em "Trocar senha" de novo com a mesma senha para conferir.`);
        }
      }
      await ctx.concluir('Senha trocada. Use a senha nova no app, no Painel de Gestão e aqui.');
    },
  });
}
$('btn-trocar-senha').addEventListener('click', () => {
  formTrocarSenha();
});

/**
 * A senha provisória aparece só aqui; ao fechar o diálogo ela some da tela.
 * Devolve a linha onde aparece o resultado do e-mail (quando foi pedido).
 */
function mostrarSenhaUmaVez(nome, email, senha) {
  const pronto = textoAcessoRedefinido({ nome, email, senha });
  const area = el('textarea', { class: 'campo texto-pronto', id: 'redef-texto', readonly: true, rows: '6' });
  area.value = pronto;
  const copia = el('p', { class: 'ajuda-campo', role: 'status' });
  const linhaEmail = el('p', { class: 'resultado-email', id: 'redef-email', role: 'status', hidden: true });
  abrirDialogo({
    titulo: 'Acesso redefinido',
    corpo: [
      el('p', {}, `Senha provisória de ${nome} (${email}). Ela aparece só agora: copie antes de fechar.`),
      el('div', { class: 'senha-uma-vez', id: 'redef-senha' }, senha),
      linhaEmail,
      el('label', { class: 'rotulo', for: 'redef-texto' }, 'Texto para mandar'),
      area,
      el('button', { type: 'button', class: 'botao-secundario', onclick: () => copiar(pronto, copia, area) }, 'Copiar texto'),
      copia,
    ],
  });
  return linhaEmail;
}

function formDescartar(c) {
  const antes = diaDeBrasilia(agoraServidor() - 30 * DIA_MS);
  abrirDialogo({
    titulo: `Descartar reservas antigas · ${c.nome}`,
    corpo: [
      el('p', {}, 'Os números emitidos antes do dia escolhido e nunca usados saem do teto de números sem internet (ex.: computador formatado). Eles continuam ACEITOS: uma etiqueta impressa com eles ainda sobe.'),
      campo('desc-antes', 'Emitidos antes de *', el('input', { class: 'campo', type: 'date', required: true, value: antes })),
      campo('desc-observacao', 'Observação * (o motivo, ex.: computador formatado)', areaObservacao(true)),
    ],
    enviar: 'Descartar reservas',
    perigo: true,
    valores: () => ({ antesDe: valorDe('desc-antes'), observacao: valorDe('desc-observacao') }),
    aoEnviar: async (v, operacao, ctx) => {
      // Meia-noite de Brasília do dia escolhido.
      const r = await api.descartarReservas({ operacao, cliente: c.id, emitidasAntesDe: `${v.antesDe}T00:00:00-03:00`, observacao: v.observacao.trim() });
      await ctx.concluir(`${c.nome}: ${n(Number(r?.descartados) || 0, 'número descartado', 'números descartados')} (emitidos antes de ${dataCompleta(v.antesDe)}).`);
    },
  });
}

// ---------- Novo cliente ----------

const novo = { op: null };

function valoresNovo() {
  return Object.fromEntries(new FormData($('form-novo')));
}

function abrirNovo() {
  mostrar('tela-novo');
  if (!novo.op) {
    $('form-novo').reset();
    $('novo-senha').value = gerarSenhaProvisoria();
    $('novo-pago-ate').value = diaDeBrasilia(agoraServidor() + 30 * DIA_MS);
    // Formulário novo: a caixa do e-mail volta a seguir o estado do envio.
    delete $('novo-enviar-email').dataset.escolha;
    novo.op = novaOperacao(novoId);
    novo.op.campos(valoresNovo());
  }
  erroEm('novo-erro', '');
  $('novo-nome').focus();
  prepararCaixaDeEnvio($('novo-enviar-email'), $('novo-email-ajuda'));
}
$('aba-novo').addEventListener('click', abrirNovo);
lembrarEscolha($('novo-enviar-email'));

for (const tipo of ['input', 'change']) {
  $('form-novo').addEventListener(tipo, () => novo.op?.campos(valoresNovo()));
}
$('btn-gerar-senha').addEventListener('click', () => {
  $('novo-senha').value = gerarSenhaProvisoria();
  novo.op?.campos(valoresNovo());
});

$('form-novo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!novo.op) return;
  const botao = $('btn-criar');
  if (botao.disabled) return;
  const v = valoresNovo();
  const operacao = novo.op.campos(v);
  // Lido antes de chamar a nuvem; fica fora do conteúdo do formulário (sem "name").
  const caixaEmail = $('novo-enviar-email');
  const mandarEmail = caixaEmail.checked && !caixaEmail.disabled;
  erroEm('novo-erro', '');
  botao.disabled = true;
  botao.textContent = 'Criando…';
  try {
    const r = await api.criarCliente({
      operacao,
      nome: v.nome.trim(),
      documento: v.documento.trim(),
      contatoNome: v.contatoNome.trim(),
      contatoEmail: v.contatoEmail.trim(),
      contatoTelefone: v.contatoTelefone.trim(),
      marcaNome: v.marcaNome.trim(),
      marcaCor: v.marcaCor,
      masterNome: v.masterNome.trim(),
      masterEmail: v.masterEmail.trim().toLowerCase(),
      masterSenha: v.masterSenha,
      pagoAte: v.pagoAte,
      valorMensal: valorDigitado(v.valorMensal),
      diasAviso: Number(v.diasAviso),
      diasTolerancia: Number(v.diasTolerancia),
      lojasContratadas: Number(v.lojasContratadas),
      observacao: v.observacao.trim(),
    });
    mostrarCriado(r, v, mandarEmail);
  } catch (e) {
    if (tratarErro(e)) return;
    erroEm('novo-erro', e.incerto ? `${e.message} O cliente pode já ter sido criado: toque em “Criar cliente” de novo sem mudar nada (se já foi, a nuvem só confirma).` : e.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Criar cliente';
  }
});

function mostrarCriado(r, v, mandarEmail = false) {
  tela.criadoId = r?.clienteId || null;
  const nome = r?.nome || v.nome.trim();
  const email = r?.masterEmail || v.masterEmail.trim().toLowerCase();
  $('criado-resumo').textContent = `${nome}: assinatura paga até ${dataCompleta(v.pagoAte)}, marca ${v.marcaNome.trim()} e o master ${v.masterNome.trim()} (${email}).`;
  $('criado-texto').value = textoParaCliente({
    cliente: nome, masterNome: v.masterNome.trim(), email, senha: v.masterSenha, instalador: INSTALADOR || '(link do instalador do Prazzo)',
  });
  $('criado-copia').textContent = '';
  resultadoEmail($('criado-email'), '');
  // O próximo cliente começa com um formulário novo (outra operação, outra senha).
  novo.op = null;
  $('form-novo').reset();
  mostrar('tela-criado');
  $('criado-texto').focus();
  carregarClientes();
  if (mandarEmail) mandarBoasVindas(r, { nome, email, senha: v.masterSenha });
}

/**
 * Os dados de acesso por e-mail ao 1º master, depois que a nuvem criou o
 * cliente (uma vez: um reenvio do formulário só confirma o que já foi
 * gravado e chega aqui como o primeiro). O texto pronto continua na tela.
 */
function mandarBoasVindas(r, { nome, email, senha }) {
  const id = tela.criadoId;
  const linha = $('criado-email');
  if (!r?.masterId) {
    resultadoEmail(linha, textoEnvioAcesso({ enviado: false, motivo: 'a nuvem não devolveu o usuário do master' }), false);
    return;
  }
  resultadoEmail(linha, `Mandando os dados de acesso por e-mail para ${email}…`, null);
  mandarAcesso({ usuarioId: r.masterId, senha, tipo: 'boas-vindas' }).then(({ texto, ok }) => {
    if (!texto) return;
    // Ainda na tela deste cliente: o resultado fica junto do texto pronto; senão, uma faixa com o nome.
    if (tela.atual === 'tela-criado' && tela.criadoId === id) resultadoEmail(linha, texto, ok);
    else if (sessao.logado) (ok ? mensagem : aviso)(`${nome}: ${texto}`);
  });
}

function limparCriado() {
  $('criado-texto').value = '';
  $('criado-resumo').textContent = '';
  $('criado-copia').textContent = '';
  resultadoEmail($('criado-email'), '');
}

async function copiar(conteudo, status, area) {
  try {
    await navigator.clipboard.writeText(conteudo);
    status.textContent = 'Texto copiado.';
  } catch {
    area.focus();
    area.select();
    status.textContent = 'Não deu para copiar sozinho: o texto está selecionado, use Ctrl+C.';
  }
}
$('btn-copiar-criado').addEventListener('click', () => copiar($('criado-texto').value, $('criado-copia'), $('criado-texto')));
$('btn-abrir-criado').addEventListener('click', async () => {
  const id = tela.criadoId;
  mostrar('tela-clientes');
  await carregarClientes();
  if (id && tela.clientes.some((c) => c.id === id)) abrirCliente(id);
});

// ---------- E-mail: o envio dos dados de acesso ----------
//
// A configuração fica no serviço do Prazzo (deploy/vps/email), como em
// Administração › E-mail do ERP: servidor, porta, segurança, usuário, senha
// (só de escrita: vai cifrada para lá e nunca volta), remetente e
// liga/desliga. Mudar a conexão desliga o envio até um e-mail de teste
// passar; o serviço confere tudo de novo e é ele quem decide.

/** A configuração salva (GET config, sem a senha), se o envio deve ficar ligado e se há um pedido em andamento. */
const telaEmail = { config: null, querLigado: false, ocupado: false };

const CAMPOS_EMAIL = {
  servidor: 'email-servidor', porta: 'email-porta', seguranca: 'email-seguranca', usuario: 'email-usuario', senha: 'email-senha',
  remetenteNome: 'email-remetente-nome', remetenteEmail: 'email-remetente-email', responderPara: 'email-responder-para',
};

function valoresEmail() {
  const v = Object.fromEntries(Object.entries(CAMPOS_EMAIL).map(([k, id]) => [k, $(id).value]));
  v.ligado = $('email-ligado').checked;
  return v;
}

/** Uma linha de resultado (e-mail enviado ou não): ok = verde, false = vermelho, null = andamento. */
function resultadoEmail(linha, texto, ok = null) {
  linha.textContent = texto || '';
  linha.hidden = !texto;
  linha.classList.toggle('ok', ok === true);
  linha.classList.toggle('erro', ok === false);
}

/**
 * O serviço de e-mail recusou a sessão (401) ou disse que esta conta não é a
 * do Proprietário (403). Quem decide é a nuvem: confere com ela (eh_dono) e
 * só então sai, como nas outras telas. Devolve true se mudou de tela.
 */
async function conferirComANuvem(e) {
  if (!e?.sessao && !e?.recusado) return false;
  let dono;
  try {
    dono = await api.ehDono();
  } catch (x) {
    return tratarErro(x);
  }
  if (dono) return false;
  fecharDialogo();
  limparDados();
  await sessao.sair();
  mostrar('tela-restrito');
  return true;
}

/** Erros das telas do e-mail que mudam de tela (sessão vencida, não é o Proprietário). */
async function errosDoEmail(e) {
  return tratarErro(e) || conferirComANuvem(e);
}

function desenharEstadoEmail() {
  const c = telaEmail.config;
  const s = estadoEmail(c);
  $('email-chip').className = `chip-situacao ${s.classe}`;
  $('email-chip').textContent = s.texto;
  // Parado (o motivo inteiro, com a resposta do servidor de e-mail) ou o servidor do Prazzo sem a chave dos segredos.
  const pausa = textoPausa(c) || (c?.chaveConfigurada === false && c.motivo ? c.motivo : '');
  $('email-parado').textContent = pausa;
  $('email-parado').hidden = !pausa;
  $('email-ultimo-teste').textContent = c ? textoUltimoTeste(c.teste) : '';
  atualizarLigado();
}

/**
 * A caixa "Envio ligado" mostra o que vai acontecer ao salvar: com a conexão
 * mudada, desligado (até um teste passar); sem um teste que passou, não liga.
 */
function atualizarLigado() {
  const c = telaEmail.config;
  const caixa = $('email-ligado');
  const mudou = conexaoMudou(c, valoresEmail());
  const pode = Boolean(c) && !mudou && (testeValeParaLigar(c) || Boolean(c.ligado));
  caixa.disabled = !pode || telaEmail.ocupado;
  caixa.checked = pode && telaEmail.querLigado;
  let ajuda = '';
  if (!c) ajuda = '';
  else if (mudou) ajuda = 'Você mudou a conexão: ao salvar, o envio fica desligado até um e-mail de teste passar.';
  else if (!pode) ajuda = 'Para ligar, salve a conexão e mande antes um e-mail de teste que passe.';
  else if (caixa.checked) ajuda = 'Ligado: os dados de acesso saem por e-mail na hora (o texto pronto continua aparecendo).';
  else ajuda = 'Desligado: ninguém recebe e-mail; o app e este painel mostram só o texto pronto.';
  $('email-ligado-ajuda').textContent = ajuda;
}

function preencherEmail(c) {
  telaEmail.config = c && typeof c === 'object' ? c : null;
  const porta = PORTAS_EMAIL.includes(Number(c?.porta)) ? Number(c.porta) : 587;
  $('email-servidor').value = c?.servidor || '';
  $('email-porta').value = String(porta);
  $('email-seguranca').value = ['starttls', 'ssl'].includes(c?.seguranca) ? c.seguranca : segurancaDaPorta(porta);
  $('email-usuario').value = c?.usuario || '';
  $('email-senha').value = '';
  $('email-senha').placeholder = c?.senhaGuardada ? 'guardada — deixe em branco para manter' : '';
  $('email-remetente-nome').value = c?.remetenteNome || '';
  $('email-remetente-email').value = c?.remetenteEmail || '';
  $('email-responder-para').value = c?.responderPara || '';
  telaEmail.querLigado = Boolean(c?.ligado);
  // Padrão do teste: o e-mail desta conta (o do Proprietário).
  if (!$('email-teste-para').value) $('email-teste-para').value = api.email() || c?.remetenteEmail || '';
  desenharEstadoEmail();
}

/** Enviando: nada no formulário muda até o serviço responder. */
function ocuparEmail(sim) {
  telaEmail.ocupado = sim;
  $('form-email').inert = sim;
  for (const b of ['btn-salvar-email', 'btn-teste-email', 'btn-atualizar-email']) $(b).disabled = sim;
  atualizarLigado();
}

function limparEmail() {
  telaEmail.config = null;
  telaEmail.querLigado = false;
  $('form-email').reset();
  $('form-teste-email').reset();
  $('email-senha').placeholder = '';
  $('email-dica-provedor').hidden = true;
  $('email-dica-provedor').textContent = '';
  $('email-status').textContent = '';
  for (const id of ['email-salvo', 'email-teste-resultado']) resultadoEmail($(id), '');
  erroEm('email-erro', '');
  desenharEstadoEmail();
}

async function abrirEmail() {
  mostrar('tela-email');
  // Resultados de uma visita anterior já não valem (o envio pode ter parado ou voltado); o "Último teste" fica.
  if (!telaEmail.ocupado) for (const id of ['email-salvo', 'email-teste-resultado']) resultadoEmail($(id), '');
  await carregarEmail();
}
$('aba-email').addEventListener('click', abrirEmail);
$('btn-atualizar-email').addEventListener('click', () => carregarEmail());

/** Lê a configuração salva no serviço (sem a senha) e preenche o formulário. */
async function carregarEmail({ silencioso = false } = {}) {
  if (telaEmail.ocupado) return false;
  if (!silencioso) $('email-status').textContent = 'Carregando a configuração do envio…';
  $('form-email').inert = true;
  try {
    const c = await apiEmail.config();
    // Saiu enquanto carregava: nada da configuração volta para a tela.
    if (!sessao.logado) return false;
    preencherEmail(c);
    $('email-status').textContent = '';
    return true;
  } catch (e) {
    if (await errosDoEmail(e)) return false;
    $('email-status').textContent = e.message;
    return false;
  } finally {
    $('form-email').inert = telaEmail.ocupado;
  }
}

// A porta escolhe a segurança (465 = SSL/TLS; as outras, STARTTLS) e vice-versa.
$('email-porta').addEventListener('change', () => {
  $('email-seguranca').value = segurancaDaPorta($('email-porta').value);
});
$('email-seguranca').addEventListener('change', () => {
  const s = $('email-seguranca').value;
  if (segurancaDaPorta($('email-porta').value) !== s) $('email-porta').value = s === 'ssl' ? '465' : '587';
});

function aoMudarEmail(ev) {
  if (ev?.target?.id === 'email-ligado') telaEmail.querLigado = $('email-ligado').checked;
  erroEm('email-erro', '');
  resultadoEmail($('email-salvo'), '');
  atualizarLigado();
}
$('form-email').addEventListener('input', aoMudarEmail);
$('form-email').addEventListener('change', aoMudarEmail);

// Dicas prontas: servidor, porta e segurança do provedor (usuário e senha são da conta de cada um).
for (const b of document.querySelectorAll('[data-provedor]')) {
  b.addEventListener('click', () => {
    const p = PROVEDORES_EMAIL[b.dataset.provedor];
    if (!p || telaEmail.ocupado) return;
    $('email-servidor').value = p.servidor;
    $('email-porta').value = String(p.porta);
    $('email-seguranca').value = p.seguranca;
    $('email-dica-provedor').textContent = `${p.nome}: ${p.dica}`;
    $('email-dica-provedor').hidden = false;
    aoMudarEmail();
    $('email-usuario').focus();
  });
}

$('form-email').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (telaEmail.ocupado) return;
  if (!telaEmail.config) {
    erroEm('email-erro', 'A configuração do envio não carregou: toque em “Atualizar” e tente de novo.');
    return;
  }
  const v = valoresEmail();
  const problema = validarConfigEmail(v, telaEmail.config);
  if (problema) {
    erroEm('email-erro', problema);
    return;
  }
  const mudou = conexaoMudou(telaEmail.config, v);
  erroEm('email-erro', '');
  resultadoEmail($('email-salvo'), '');
  const botao = $('btn-salvar-email');
  ocuparEmail(true);
  botao.textContent = 'Salvando…';
  let salva = null;
  try {
    salva = await apiEmail.salvarConfig(corpoConfigEmail(v));
  } catch (e) {
    ocuparEmail(false);
    botao.textContent = 'Salvar';
    if (await errosDoEmail(e)) return;
    erroEm('email-erro', e.incerto ? `${e.message} A configuração pode ter sido salva ou não: toque em “Atualizar” para conferir.` : e.message);
    return;
  }
  ocuparEmail(false);
  botao.textContent = 'Salvar';
  if (!sessao.logado) return;
  preencherEmail(salva);
  // O resultado do teste (com a dica "para ligar, marque…") fica velho depois de salvar; o "Último teste" continua.
  resultadoEmail($('email-teste-resultado'), '');
  resultadoEmail($('email-salvo'), mudou && !salva?.ligado
    ? 'Configuração salva. Agora mande um e-mail de teste: o envio só liga depois de um teste que passe.'
    : `Configuração salva. Envio ${salva?.ligado ? 'ligado' : 'desligado'}.`, true);
});

$('form-teste-email').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (telaEmail.ocupado) return;
  const linha = $('email-teste-resultado');
  const c = telaEmail.config;
  const para = $('email-teste-para').value.trim();
  // O teste usa a configuração SALVA no serviço: o que está só na tela não conta.
  let antes = '';
  if (!c) antes = 'A configuração do envio não carregou: toque em “Atualizar” e tente de novo.';
  else if (!c.senhaGuardada || !c.servidor) antes = 'Salve a configuração antes do teste (o teste usa a configuração salva).';
  else if (configEmailMudou(c, valoresEmail())) antes = 'Salve antes de testar: o teste usa a configuração salva, e a da tela mudou.';
  else if (!emailValido(para)) antes = 'Digite um e-mail válido para o teste.';
  if (antes) {
    resultadoEmail(linha, antes, false);
    return;
  }
  const botao = $('btn-teste-email');
  ocuparEmail(true);
  botao.textContent = 'Enviando…';
  resultadoEmail(linha, `Mandando o e-mail de teste para ${para}…`, null);
  let texto;
  let ok = false;
  // O teste muda o estado no serviço (teste guardado, saída da pausa): a resposta traz a configuração depois dele.
  let depois = null;
  try {
    depois = (await apiEmail.testar(para))?.config || null;
    ok = true;
    texto = `E-mail de teste enviado para ${para}. Confira a caixa de entrada (e o spam).`;
  } catch (e) {
    ocuparEmail(false);
    botao.textContent = 'Enviar e-mail de teste';
    if (await errosDoEmail(e)) return;
    depois = e.config || null;
    texto = e.incerto ? `${e.message} O teste pode ter saído ou não: confira a caixa de entrada antes de repetir.` : `O teste falhou: ${e.message}`;
  }
  ocuparEmail(false);
  botao.textContent = 'Enviar e-mail de teste';
  if (!sessao.logado) return;
  // Sem a configuração na resposta (sem resposta, recusa antes do envio): relê.
  if (depois && typeof depois === 'object') preencherEmail(depois);
  else await carregarEmail({ silencioso: true });
  if (ok && !telaEmail.config?.ligado) texto += ' Para ligar o envio, marque “Envio ligado” e toque em “Salvar”.';
  resultadoEmail(linha, texto, ok);
});

/** A caixa "Mandar por e-mail" lembra o que a pessoa marcou (senão, segue o estado do envio). */
function lembrarEscolha(caixa) {
  caixa.addEventListener('change', () => {
    caixa.dataset.escolha = caixa.checked ? 'sim' : 'nao';
  });
}

/** Caixa "Mandar por e-mail" de um diálogo (começa travada até o serviço dizer se dá). */
function caixaDeEnvio(id) {
  const caixa = el('input', { type: 'checkbox', id, disabled: true });
  lembrarEscolha(caixa);
  return caixa;
}

/**
 * Pergunta ao serviço se dá para mandar e-mail agora e prepara a caixa:
 * marcada quando o envio está ligado (a não ser que a pessoa tenha
 * desmarcado), travada e com o motivo quando não está.
 */
async function prepararCaixaDeEnvio(caixa, ajuda) {
  caixa.disabled = true;
  ajuda.hidden = false;
  ajuda.textContent = 'Conferindo o envio de e-mails…';
  let oferta;
  try {
    oferta = ofertaDeEnvio(await apiEmail.estado());
  } catch (e) {
    if (tratarErro(e)) return;
    oferta = { pode: false, dica: `${e.message} Mande o texto pronto.` };
  }
  if (!caixa.isConnected) return;
  caixa.disabled = !oferta.pode;
  caixa.checked = oferta.pode && (caixa.dataset.escolha ? caixa.dataset.escolha === 'sim' : true);
  ajuda.textContent = oferta.dica;
  ajuda.hidden = !oferta.dica;
}

/**
 * Manda os dados de acesso (com a senha provisória) pelo serviço, NA HORA.
 * Nunca lança: devolve o texto do resultado (vazio se a tela mudou porque a
 * sessão acabou) e se foi enviado. A senha não fica guardada em lugar nenhum.
 * @param {{ usuarioId: string, senha: string, tipo: 'boas-vindas' | 'nova-senha' }} d
 */
async function mandarAcesso(d) {
  let r;
  try {
    r = await apiEmail.enviarAcesso(d);
  } catch (e) {
    // Recusa da nuvem (403) é a resposta para ESTE usuário: só a sessão recusada pede conferência.
    if (tratarErro(e) || (e?.sessao && (await conferirComANuvem(e)))) return { texto: '', ok: false };
    r = { enviado: false, motivo: e.message, incerto: Boolean(e?.incerto) };
  }
  return { texto: textoEnvioAcesso(r), ok: r.enviado };
}

// ---------- Início ----------

$('copyright').textContent = `© ${new Date().getFullYear()} Prazzo. Todos os direitos reservados.`;
// Com a sessão guardada, entra direto (eh_dono confere de novo); sem ela, a entrada.
if (sessao.logado) aposEntrar();
else mostrar('tela-login');
