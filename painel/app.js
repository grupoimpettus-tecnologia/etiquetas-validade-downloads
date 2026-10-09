// Painel de gestão (web, somente consulta).
import { NUVEM_PADRAO } from '../main/nuvem-config.js';
import { CONFIG_PADRAO, SITUACAO_INFO, conservacaoPorId } from '../shared/constants.js';
import { VERSAO_TERMOS } from '../shared/termos.js';
import { descreverRestante, formatarDataHora, formatarQuantidade } from '../shared/validade.js';
import { filtrar, montarPainel } from './dados.js';
import { SessaoPainel } from './sessao.js';

// Não roda dentro de outra página (evita sobreposição/clickjacking).
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Painel aberto dentro de outra página.');
}

const DIAS_AVISO = Number(CONFIG_PADRAO.alertas?.diasAviso) || 2;
const ATUALIZAR_MS = 60_000;
const POR_PAGINA = 60;
const PAPEIS = { master: 'Master', gestor: 'Gestor', operador: 'Operador' };

const $ = (id) => document.getElementById(id);
const sessao = new SessaoPainel(NUVEM_PADRAO);
const estado = { dados: null, painel: null, filtro: { marcaId: '', unidadeId: '', situacao: '', busca: '' }, limite: POR_PAGINA, carregando: false };
let relogio = null;

/** Cria elementos sem innerHTML (todo texto vindo da nuvem entra como texto). */
function el(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') for (const [p, val] of Object.entries(v)) n.style.setProperty(p, val);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) n.append(f instanceof Node ? f : String(f));
  return n;
}

const corSegura = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#ff6b2c');

function aviso(texto, tipo = 'erro') {
  const a = $('aviso');
  a.textContent = texto || '';
  a.className = `faixa-aviso ${tipo}`;
  a.hidden = !texto;
}

function mostrar(tela) {
  for (const id of ['tela-login', 'tela-primeiro', 'tela-painel']) $(id).hidden = id !== tela;
  $('topo').hidden = tela !== 'tela-painel';
  document.body.classList.toggle('na-entrada', tela !== 'tela-painel');
}

// ---------- Entrada ----------

$('form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const botao = $('btn-entrar');
  const erro = $('login-erro');
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  try {
    await sessao.entrar($('login-email').value, $('login-senha').value, $('login-manter').checked);
    $('login-senha').value = '';
    await carregar(true);
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

async function sair() {
  pararRelogio();
  await sessao.sair();
  estado.dados = null;
  estado.painel = null;
  aviso('');
  mostrar('tela-login');
}
$('btn-sair').addEventListener('click', sair);
$('btn-primeiro-sair').addEventListener('click', sair);
$('btn-atualizar').addEventListener('click', () => carregar(true));

// ---------- Carga ----------

async function carregar(manual = false) {
  if (!sessao.logado) return mostrar('tela-login');
  if (estado.carregando) return;
  estado.carregando = true;
  $('btn-atualizar').classList.add('girando');
  try {
    const dados = await sessao.painel(VERSAO_TERMOS);
    if (dados?.primeiroAcessoPendente) {
      pararRelogio();
      return mostrar('tela-primeiro');
    }
    estado.dados = dados;
    aviso('');
    mostrar('tela-painel');
    desenhar();
    iniciarRelogio();
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      pararRelogio();
      mostrar('tela-login');
      $('login-erro').textContent = e.message;
      $('login-erro').hidden = false;
    } else if (estado.dados) {
      aviso(`${e.message} Mostrando os dados de ${formatarDataHora(estado.dados.geradoEm)}.`, 'alerta');
    } else {
      mostrar('tela-login');
      $('login-erro').textContent = e.message;
      $('login-erro').hidden = false;
    }
    if (manual && estado.dados) desenhar();
  } finally {
    estado.carregando = false;
    $('btn-atualizar').classList.remove('girando');
  }
}

function iniciarRelogio() {
  if (relogio) return;
  relogio = setInterval(() => {
    if (document.visibilityState === 'visible') carregar();
  }, ATUALIZAR_MS);
}
function pararRelogio() {
  clearInterval(relogio);
  relogio = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estado.dados) carregar();
});

// ---------- Desenho ----------

function desenhar() {
  const d = estado.dados;
  estado.painel = montarPainel(d, { diasAviso: DIAS_AVISO });
  const { lojas, totais, acoes } = estado.painel;
  const u = d.usuario || {};

  $('topo-sub').textContent = `${u.nome || ''} · ${PAPEIS[u.papel] || u.papel || ''}`;
  $('status-linha').textContent = `Atualizado às ${formatarDataHora(d.geradoEm).slice(-5)} · atualiza sozinho a cada minuto · ${lojas.length} ${lojas.length === 1 ? 'loja' : 'lojas'}`;
  $('cartao-prox-sub').textContent = `próximos ${DIAS_AVISO} dias`;
  for (const n of document.querySelectorAll('[data-n]')) n.textContent = totais[n.dataset.n] ?? 0;

  // Ações pendentes
  const lista = $('acoes');
  lista.replaceChildren(
    ...(acoes.length
      ? acoes.map((a) => el('li', { class: `acao ${a.nivel}` },
        el('div', { class: 'acao-textos' }, el('strong', {}, a.titulo), el('span', {}, a.detalhe)),
        a.filtro ? el('button', { type: 'button', class: 'botao-secundario', onclick: () => aplicarFiltro({ ...a.filtro, unidadeId: '' }, true) }, 'Ver') : null))
      : [el('li', { class: 'acao ok' }, el('div', { class: 'acao-textos' }, el('strong', {}, 'Tudo em dia'), el('span', {}, 'Nenhuma etiqueta vencida ou vencendo hoje.')))]),
  );

  // Marcas (só aparece com mais de uma)
  const marcas = [...new Map(lojas.map((l) => [l.marcaId, l.marca])).entries()];
  const selMarca = $('filtro-marca');
  selMarca.hidden = marcas.length < 2;
  if (!marcas.some(([id]) => id === estado.filtro.marcaId)) estado.filtro.marcaId = '';
  selMarca.replaceChildren(el('option', { value: '' }, 'Todas as marcas'), ...marcas.map(([id, nome]) => el('option', { value: id }, nome)));
  selMarca.value = estado.filtro.marcaId;

  desenharLojas();
  desenharLista();
}

function lojasVisiveis() {
  return estado.painel.lojas.filter((l) => !estado.filtro.marcaId || l.marcaId === estado.filtro.marcaId);
}

function desenharLojas() {
  const lojas = lojasVisiveis();
  const ordem = { critico: 0, aviso: 1, atencao: 2, ok: 3 };
  const ordenadas = [...lojas].sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  $('lojas').replaceChildren(...ordenadas.map((l) => {
    const c = l.contagem;
    const ultima = l.ultimaEtiqueta
      ? (l.diasSemEtiqueta === 0 ? 'Última etiqueta hoje' : `Última etiqueta há ${l.diasSemEtiqueta} ${l.diasSemEtiqueta === 1 ? 'dia' : 'dias'}`)
      : 'Ainda sem etiquetas';
    return el('button', {
      type: 'button',
      class: `loja ${l.nivel}${estado.filtro.unidadeId === l.id ? ' escolhida' : ''}`,
      style: { '--cor': corSegura(l.cor) },
      onclick: () => aplicarFiltro({ unidadeId: estado.filtro.unidadeId === l.id ? '' : l.id }, true),
    },
    el('span', { class: 'loja-nome' }, l.nome),
    el('span', { class: 'loja-contas' },
      el('span', { class: `conta critico${c.vencido ? '' : ' zero'}`, title: 'Vencidas' }, `${c.vencido} vencid${c.vencido === 1 ? 'a' : 'as'}`),
      el('span', { class: `conta aviso${c.hoje ? '' : ' zero'}`, title: 'Vencem hoje' }, `${c.hoje} hoje`),
      el('span', { class: `conta atencao${c.proximo ? '' : ' zero'}`, title: 'A vencer' }, `${c.proximo} a vencer`),
      el('span', { class: `conta ok${c.ok ? '' : ' zero'}`, title: 'No prazo' }, `${c.ok} no prazo`)),
    el('small', { class: `loja-ultima${l.diasSemEtiqueta > 2 ? ' parada' : ''}` }, ultima,
      l.descartadas7d ? ` · ${l.descartadas7d} descartada${l.descartadas7d === 1 ? '' : 's'} em 7 dias` : ''));
  }));
  if (!ordenadas.length) $('lojas').append(el('p', { class: 'vazio' }, 'Nenhuma loja liberada para o seu acesso.'));

  const sel = $('filtro-loja');
  if (estado.filtro.unidadeId && !lojas.some((l) => l.id === estado.filtro.unidadeId)) estado.filtro.unidadeId = '';
  sel.replaceChildren(el('option', { value: '' }, 'Todas as lojas'), ...lojas.map((l) => el('option', { value: l.id }, l.nome)));
  sel.value = estado.filtro.unidadeId;
  // A Contagem já abre na loja escolhida no filtro.
  $('link-contagem').href = estado.filtro.unidadeId ? `contagem.html#unidade=${encodeURIComponent(estado.filtro.unidadeId)}` : 'contagem.html';
}

function desenharLista() {
  const f = estado.filtro;
  for (const b of document.querySelectorAll('#chips .chip')) b.classList.toggle('ativo', b.dataset.situacao === f.situacao);
  const itens = filtrar(estado.painel.etiquetas, f);
  const agora = new Date();
  const visiveis = itens.slice(0, estado.limite);
  $('lista').replaceChildren(...visiveis.map((e) => {
    const info = SITUACAO_INFO[e.situacao];
    const cons = conservacaoPorId(e.conservacao);
    const qtd = e.quantidade !== null && e.quantidade !== undefined ? `${formatarQuantidade(e.quantidade)} ${e.medida || ''}`.trim() : '';
    return el('article', { class: `item ${e.situacao}` },
      el('div', { class: 'item-principal' },
        el('strong', { class: 'item-produto' }, e.produto),
        el('span', { class: 'item-situacao' }, `${info?.icone || ''} ${descreverRestante(e.venceEm, agora)}`)),
      el('div', { class: 'item-detalhes' },
        el('span', {}, `🏪 ${e.loja.nome}`),
        el('span', {}, `Nº ${e.numero}`),
        cons ? el('span', {}, `${cons.icone} ${cons.nome}`) : null,
        qtd ? el('span', {}, qtd) : null,
        Number.isFinite(e.unidadesTotal) && e.unidadesTotal > 0 ? el('span', {}, `${e.unidadesAtivas ?? 0} de ${e.unidadesTotal} un. ativas`) : null,
        e.setor ? el('span', {}, e.setor) : null,
        el('span', {}, `👤 ${e.responsavel}`),
        el('span', {}, `Vence ${formatarDataHora(e.venceEm)}`)));
  }));
  if (!itens.length) {
    const algum = f.situacao || f.unidadeId || f.busca || f.marcaId;
    $('lista').append(el('p', { class: 'vazio' }, algum ? 'Nenhuma etiqueta com esses filtros.' : 'Nenhuma etiqueta ativa no momento.'));
  }
  const mais = $('btn-mais');
  mais.hidden = itens.length <= visiveis.length;
  mais.textContent = `Mostrar mais (${itens.length - visiveis.length})`;
}

function aplicarFiltro(parcial, rolar = false) {
  Object.assign(estado.filtro, parcial);
  estado.limite = POR_PAGINA;
  desenharLojas();
  desenharLista();
  if (rolar) $('bloco-etiquetas').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

for (const b of document.querySelectorAll('#cartoes .cartao')) {
  b.addEventListener('click', () => aplicarFiltro({ situacao: b.dataset.situacao }, true));
}
for (const b of document.querySelectorAll('#chips .chip')) {
  b.addEventListener('click', () => aplicarFiltro({ situacao: b.dataset.situacao }));
}
$('filtro-marca').addEventListener('change', (e) => aplicarFiltro({ marcaId: e.target.value, unidadeId: '' }));
$('filtro-loja').addEventListener('change', (e) => aplicarFiltro({ unidadeId: e.target.value }));
let espera = null;
$('filtro-busca').addEventListener('input', (e) => {
  clearTimeout(espera);
  espera = setTimeout(() => aplicarFiltro({ busca: e.target.value }), 150);
});
$('btn-mais').addEventListener('click', () => {
  estado.limite += POR_PAGINA;
  desenharLista();
});

// ---------- Início ----------

$('copyright').textContent = `© ${new Date().getFullYear()} Grupo Impettus. Todos os direitos reservados.`;

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (sessao.logado) {
  mostrar('tela-painel');
  $('status-linha').textContent = 'Carregando…';
  carregar(true);
} else {
  mostrar('tela-login');
}
