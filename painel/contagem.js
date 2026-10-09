// Contagem por QR code (site, pensado para o celular na câmara fria).
//
// Fluxo: entrar (mesma sessão do Painel de Gestão) → escolher a loja e o que
// contar → INICIAR (a nuvem devolve as unidades ativas e o horário de início)
// → bipar com a câmera ou digitar o código → FINALIZAR mostra o que será
// baixado e só grava depois de confirmado. Toda escrita passa por
// contagem-api.js; a contagem não gravada fica salva neste aparelho.
import { NUVEM_PADRAO } from '../main/nuvem-config.js';
import { VERSAO_TERMOS } from '../shared/termos.js';
import { formatarDataHora, formatarHora, formatarQuantidade } from '../shared/validade.js';
import { ApiContagem } from './contagem-api.js';
import {
  andamentoValido, chave, classificarBipe, conferirResposta, dadosFinalizar, desmarcar, faixas, formatarNumero, gruposDoEscopo, indexar,
  lerHash, lerResultado, linkVolta, listarProdutos, montarResumo, noEscopo, novoEstado, outraPessoa, produtosParaReimprimir, registrarBipe,
  resultadoDescarte, textoCancelar, usuarioDoToken,
} from './contagem-logica.js';
import { normalizar } from './dados.js';
import { SessaoPainel } from './sessao.js';

// Não roda dentro de outra página (evita sobreposição/clickjacking).
if (window.top !== window.self) {
  document.documentElement.textContent = '';
  throw new Error('Contagem aberta dentro de outra página.');
}

const CHAVE_ANDAMENTO = 'contagem-andamento';
const CHAVE_LINK = 'contagem-link';
const INTERVALO_LEITURA_MS = 125; // ~8 leituras por segundo
const LADO_MAX = 640; // a imagem lida é reduzida para no máximo 640 x 640
const FRACAO_MIRA = 0.7; // lado da mira em relação à imagem visível
const ESPERA_MESMO_CODIGO_MS = 2500;
const ESPERA_AVISO_MS = 8000;
const MOTIVO_DESCARTE = 'Vencida (encontrada na contagem)';
const PAPEIS = { master: 'Master', gestor: 'Gestor', operador: 'Operador' };
const TELAS = ['tela-login', 'tela-primeiro', 'tela-escolha', 'tela-contagem', 'tela-resumo', 'tela-resultado'];

const $ = (id) => document.getElementById(id);
const sessao = new SessaoPainel(NUVEM_PADRAO);
const api = new ApiContagem(sessao, VERSAO_TERMOS);
let link = lerLink();

/**
 * Link do celular (#unidade=…&produto=…&volta=…): lido do endereço e guardado
 * nesta aba. O # sai do endereço, então recarregar ou voltar para a página
 * (ex.: depois de imprimir a nova no celular) não conta como link novo e não
 * apaga a contagem gravada nem o botão Desfazer.
 */
function lerLink() {
  let hash = location.hash;
  if (lerHash(hash).chave) {
    try {
      sessionStorage.setItem(CHAVE_LINK, hash);
    } catch {
      // sem armazenamento: o link vale enquanto a página estiver aberta
    }
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    } catch {
      // endereço fica como está
    }
  } else {
    try {
      hash = sessionStorage.getItem(CHAVE_LINK) || '';
    } catch {
      hash = '';
    }
  }
  return lerHash(hash);
}

/** Quem está conectado agora (do token, sem chamar a nuvem). */
const conectado = () => usuarioDoToken(sessao.atual?.token);

const tela = { atual: '', dados: null, lojas: [], usuario: null, escopoLoja: null, produtos: [], escolhida: null, busca: '', pedido: 0 };
let estado = null; // contagem em andamento (salva no aparelho)
let indice = null;
let filtroLista = '';

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

const n = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;

function aviso(texto, tipo = 'erro') {
  const a = $('aviso');
  a.textContent = texto || '';
  a.className = `faixa-aviso ${tipo}`;
  a.hidden = !texto;
}

function mostrar(id) {
  if (tela.atual === 'tela-contagem' && id !== 'tela-contagem') pararCamera(true);
  if (tela.atual !== id) aviso('');
  tela.atual = id;
  for (const t of TELAS) $(t).hidden = t !== id;
  const entrada = id === 'tela-login' || id === 'tela-primeiro';
  $('topo').hidden = entrada;
  document.body.classList.toggle('na-entrada', entrada);
  window.scrollTo(0, 0);
}

/** Topo: quem está conectado agora (é no nome dela que a baixa fica gravada). */
function atualizarTopo() {
  const agora = conectado();
  let u = tela.usuario;
  // Retomada sem ler a nuvem: o nome de quem começou só vale se for a mesma pessoa.
  if (!u && estado?.usuario && !outraPessoa(estado, agora)) u = estado.usuario;
  $('topo-sub').textContent = u ? `${u.nome || ''} · ${PAPEIS[u.papel] || u.papel || ''}` : agora?.email || '';
}

/** Aviso quando quem está conectado não é quem começou a contagem. */
function textoOutraPessoa() {
  const o = estado ? outraPessoa(estado, conectado()) : null;
  return o ? `Contagem iniciada por ${o.iniciou}. Ao gravar, as baixas ficam no nome de quem está conectado agora${o.agora ? ` (${o.agora})` : ''}.` : '';
}

// ---------- Contagem salva no aparelho ----------

function salvar() {
  if (!estado) return;
  try {
    localStorage.setItem(CHAVE_ANDAMENTO, JSON.stringify(estado));
  } catch {
    // Sem armazenamento (aba anônima, sem espaço): a contagem fica só nesta página.
  }
}
function lerAndamento() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ANDAMENTO) || 'null');
  } catch {
    return null;
  }
}
function encerrarContagem() {
  pararCamera();
  estado = null;
  indice = null;
  filtroLista = '';
  try {
    localStorage.removeItem(CHAVE_ANDAMENTO);
  } catch {
    // nada a apagar
  }
}

function novoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- Confirmações ----------

let respostaModal = null;
function perguntar({ titulo, texto, sim = 'Confirmar', nao = 'Voltar', perigo = false }) {
  $('modal-titulo').textContent = titulo;
  $('modal-texto').textContent = texto;
  $('modal-sim').textContent = sim;
  $('modal-nao').textContent = nao;
  $('modal-sim').classList.toggle('perigo', perigo);
  $('modal').hidden = false;
  $('modal-nao').focus();
  return new Promise((ok) => {
    respostaModal = ok;
  });
}
function fecharModal(valor) {
  $('modal').hidden = true;
  const r = respostaModal;
  respostaModal = null;
  r?.(valor);
}
$('modal-sim').addEventListener('click', () => fecharModal(true));
$('modal-nao').addEventListener('click', () => fecharModal(false));
$('modal').addEventListener('click', (ev) => {
  if (ev.target === $('modal')) fecharModal(false);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('modal').hidden) fecharModal(false);
});

/** Sessão expirada ou acesso desativado: volta para a entrada (a contagem fica salva). */
function tratarErroSessao(e) {
  if (e?.status !== 401 && e?.status !== 403) return false;
  pararCamera(true);
  mostrar('tela-login');
  $('login-erro').textContent = estado && !estado.finalizada ? `${e.message} A contagem continua salva neste aparelho.` : e.message;
  $('login-erro').hidden = false;
  return true;
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
    // Pode ser outra pessoa (sessão expirada no meio, celular passado adiante).
    tela.usuario = null;
    tela.dados = null;
    await iniciar();
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
});

async function sair() {
  if (estado?.envio) {
    // Pode já estar gravada na nuvem: não some do aparelho; fica travada para quem entrar.
    const ok = await perguntar({
      titulo: 'Sair agora?',
      texto: 'Esta contagem pode já ter sido gravada na nuvem (a resposta não chegou). Ela continua travada neste aparelho: entre de novo para tentar gravar ou para cancelar.',
      sim: 'Sair',
    });
    if (!ok) return;
    pararCamera();
  } else if (estado && !estado.finalizada) {
    const ok = await perguntar({ titulo: 'Sair agora?', texto: 'A contagem ainda não foi gravada e será descartada deste aparelho.', sim: 'Sair e descartar', perigo: true });
    if (!ok) return;
    encerrarContagem();
  } else {
    encerrarContagem();
  }
  await sessao.sair();
  tela.dados = null;
  tela.usuario = null;
  aviso('');
  mostrar('tela-login');
}
$('btn-sair').addEventListener('click', sair);
$('btn-primeiro-sair').addEventListener('click', sair);

// ---------- Início ----------

async function iniciar() {
  if (!sessao.logado) return mostrar('tela-login');
  const salvo = lerAndamento();
  if (salvo && !andamentoValido(salvo)) {
    encerrarContagem();
    await carregarLojas();
    if (salvo.iniciadaEm && !salvo.finalizada && tela.atual === 'tela-escolha') {
      aviso(`A contagem iniciada em ${formatarDataHora(salvo.iniciadaEm)} passou de 12 horas sem ser gravada e foi descartada.`, 'alerta');
    }
    return;
  } else if (salvo && salvo.finalizada && link.chave && link.chave !== salvo.linkChave) {
    // Link novo do celular (outro toque em Contagem): a contagem anterior já foi gravada.
    // Recarregar a página ou voltar para ela repete o mesmo link: aí o resultado continua.
    encerrarContagem();
  } else if (salvo) {
    estado = salvo;
    estado.descartando ||= {};
    indice = indexar(estado);
    if (link.volta) estado.volta = link.volta;
    atualizarTopo();
    if (estado.finalizada) return mostrarResultado();
    if (estado.envio) {
      abrirResumo();
      aviso('A gravação desta contagem ficou sem resposta da nuvem. Toque em “Tentar gravar de novo” ou cancele.', 'alerta');
      return;
    }
    abrirContagem(true);
    const outra = (link.unidade && link.unidade !== estado.unidadeId) || (link.produto && link.produto !== estado.produtoId);
    const pessoa = textoOutraPessoa();
    aviso([outra
      ? `Há uma contagem em andamento (${tituloEscopo()} · ${estado.unidadeNome}). Finalize ou cancele antes de começar outra.`
      : `Contagem retomada: iniciada às ${formatarHora(estado.iniciadaEm)}.`, pessoa].filter(Boolean).join(' '), 'alerta');
    return;
  }
  await carregarLojas();
}

async function carregarLojas() {
  mostrar('tela-escolha');
  $('bloco-escopo').hidden = true;
  $('btn-iniciar').disabled = true;
  $('escolha-loja').replaceChildren();
  $('escolha-status').textContent = 'Carregando as lojas…';
  let dados;
  try {
    dados = await sessao.painel(VERSAO_TERMOS);
  } catch (e) {
    if (!tratarErroSessao(e)) $('escolha-status').replaceChildren(e.message, ' ', el('button', { type: 'button', class: 'botao-secundario', onclick: carregarLojas }, 'Tentar de novo'));
    return;
  }
  if (dados?.primeiroAcessoPendente) return mostrar('tela-primeiro');
  tela.dados = dados;
  tela.lojas = dados?.unidades || [];
  tela.usuario = dados?.usuario || null;
  atualizarTopo();
  desenharLojas();
}

function desenharLojas() {
  const sel = $('escolha-loja');
  const marcas = new Set(tela.lojas.map((l) => l.marcaId));
  sel.replaceChildren(
    el('option', { value: '' }, tela.lojas.length ? 'Escolha a loja' : 'Nenhuma loja liberada'),
    ...tela.lojas.map((l) => el('option', { value: l.id }, marcas.size > 1 ? `${l.marca} · ${l.nome}` : l.nome)),
  );
  let id = '';
  if (link.unidade) {
    if (tela.lojas.some((l) => l.id === link.unidade)) id = link.unidade;
    else aviso('Você não tem acesso à loja do link. Escolha uma das lojas liberadas para você.', 'alerta');
  }
  if (!id && tela.lojas.length === 1) id = tela.lojas[0].id;
  sel.value = id;
  $('escolha-status').textContent = tela.lojas.length ? '' : 'Nenhuma loja liberada para o seu acesso.';
  escolherLoja(id);
}
$('escolha-loja').addEventListener('change', (ev) => escolherLoja(ev.target.value));

async function escolherLoja(id) {
  const pedido = ++tela.pedido;
  tela.escopoLoja = null;
  tela.produtos = [];
  tela.escolhida = null;
  tela.busca = '';
  $('escolha-busca').value = '';
  $('bloco-escopo').hidden = true;
  $('btn-iniciar').disabled = true;
  if (!id) return;
  $('escolha-status').textContent = 'Carregando as etiquetas da loja…';
  let resp;
  try {
    resp = await api.escopo(id);
  } catch (e) {
    if (pedido !== tela.pedido || tratarErroSessao(e)) return;
    $('escolha-status').replaceChildren(e.message, ' ', el('button', { type: 'button', class: 'botao-secundario', onclick: () => escolherLoja(id) }, 'Tentar de novo'));
    return;
  }
  if (pedido !== tela.pedido) return;
  if (resp?.primeiroAcessoPendente) return mostrar('tela-primeiro');
  tela.escopoLoja = resp || {};
  tela.produtos = listarProdutos(resp?.unidades || []);

  // Produto que veio do celular.
  if (link.produto && (!link.unidade || link.unidade === id)) {
    let p = tela.produtos.find((x) => x.produtoId === link.produto);
    if (!p) {
      const b = (resp?.baixadasRecentes || []).find((x) => x.produtoId === link.produto);
      if (b) {
        p = { chave: b.produtoId, produtoId: b.produtoId, produtoNome: b.produtoNome || '', ativas: 0, vencidas: 0, etiquetas: 0 };
        tela.produtos.push(p);
      } else {
        aviso('O produto do link não tem etiquetas com QR nesta loja. Escolha outro produto ou a loja inteira.', 'alerta');
      }
    }
    if (p) tela.escolhida = { chave: p.chave, produto: p };
  }

  // Etiquetas antigas (sem QR) não entram na contagem.
  const legado = (tela.dados?.etiquetas || []).filter((e) => e.unidadeId === id && e.unidadesTotal === null).length;
  $('escolha-legado').textContent = legado
    ? `${n(legado, 'etiqueta antiga', 'etiquetas antigas')} desta loja, sem QR por unidade, não ${legado === 1 ? 'entra' : 'entram'} na contagem: dê baixa no app da loja.`
    : '';
  $('escolha-legado').hidden = !legado;
  $('escolha-busca').hidden = tela.produtos.length <= 6;
  $('bloco-escopo').hidden = false;
  $('escolha-status').textContent = '';
  desenharOpcoes();
}

function desenharOpcoes() {
  const termo = normalizar(tela.busca);
  const totalAtivas = tela.produtos.reduce((s, p) => s + p.ativas, 0);
  const totalEtiquetas = new Set((tela.escopoLoja?.unidades || []).map((u) => Number(u.numero))).size;
  const opcao = (chaveOpcao, produto, titulo, detalhe, extra = '') => {
    const escolhida = tela.escolhida?.chave === chaveOpcao;
    return el('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(escolhida),
      class: `opcao${escolhida ? ' escolhida' : ''}${extra}`,
      onclick: () => {
        tela.escolhida = { chave: chaveOpcao, produto };
        desenharOpcoes();
      },
    }, el('span', { class: 'opcao-titulo' }, titulo), el('small', {}, detalhe));
  };
  const visiveis = tela.produtos.filter((p) => !termo || normalizar(p.produtoNome).includes(termo));
  $('escolha-opcoes').replaceChildren(
    opcao('*loja', null, 'Loja inteira', `${n(totalAtivas, 'unidade ativa', 'unidades ativas')} em ${n(totalEtiquetas, 'etiqueta', 'etiquetas')}`, ' opcao-loja'),
    ...visiveis.map((p) => opcao(p.chave, p, p.produtoNome,
      `${n(p.ativas, 'unidade ativa', 'unidades ativas')} · ${n(p.etiquetas, 'etiqueta', 'etiquetas')}${p.vencidas ? ` · ${n(p.vencidas, 'vencida', 'vencidas')}` : ''}`)),
    ...(!tela.produtos.length ? [el('p', { class: 'vazio' }, 'Nenhuma unidade ativa com QR nesta loja.')] : []),
    ...(tela.produtos.length && !visiveis.length ? [el('p', { class: 'vazio' }, 'Nenhum produto com esse nome.')] : []),
  );
  const e = tela.escolhida;
  $('btn-iniciar').disabled = !e;
  $('btn-iniciar').textContent = !e ? 'Iniciar contagem' : e.produto ? 'Iniciar contagem do produto' : 'Iniciar contagem da loja inteira';
}
let esperaBusca = null;
$('escolha-busca').addEventListener('input', (ev) => {
  clearTimeout(esperaBusca);
  esperaBusca = setTimeout(() => {
    tela.busca = ev.target.value;
    desenharOpcoes();
  }, 120);
});

$('btn-iniciar').addEventListener('click', async () => {
  const unidadeId = $('escolha-loja').value;
  const escolha = tela.escolhida;
  if (!unidadeId || !escolha) return;
  prepararSom(); // o toque libera o som do bipe
  const botao = $('btn-iniciar');
  botao.disabled = true;
  botao.textContent = 'Iniciando…';
  try {
    const resp = await api.escopo(unidadeId);
    if (resp?.primeiroAcessoPendente) return mostrar('tela-primeiro');
    if (!resp?.inicio) throw new Error('A nuvem não devolveu o horário de início. Tente de novo.');
    if (resp?.usuario) tela.usuario = resp.usuario;
    estado = novoEstado(resp, {
      id: novoId(), unidadeId, produto: escolha.produto, volta: link.volta, usuario: tela.usuario,
      usuarioId: conectado()?.id || null, linkChave: link.chave || '',
    });
    if (!estado.unidadeNome) estado.unidadeNome = tela.lojas.find((l) => l.id === unidadeId)?.nome || '';
    indice = indexar(estado);
    salvar();
    aviso('');
    abrirContagem();
    ligarCamera();
  } catch (e) {
    if (!tratarErroSessao(e)) $('escolha-status').textContent = e.message;
  } finally {
    botao.disabled = !tela.escolhida;
    botao.textContent = 'Iniciar contagem';
  }
});

// ---------- Contagem ----------

const tituloEscopo = () => (estado.escopo === 'produto' ? estado.produtoNome : 'Loja inteira');

async function abrirContagem(retomada = false) {
  mostrar('tela-contagem');
  $('cont-escopo').textContent = tituloEscopo();
  $('cont-loja').textContent = `${estado.unidadeNome} · iniciada às ${formatarHora(estado.iniciadaEm)}`;
  $('ultimo').hidden = true;
  desenharContagem();
  atualizarBotaoCamera();
  if (camera.querLigada || (retomada && (await cameraLiberada()))) ligarCamera();
  else estadoCamera('Toque em “Ligar câmera” para bipar as etiquetas.');
}

function desenharContagem() {
  if (!estado) return;
  const agora = new Date();
  const grupos = gruposDoEscopo(estado, indice, agora);
  let achadas = 0;
  let total = 0;
  for (const g of grupos) {
    for (const u of g.unidades) {
      if (u.situacao === 'encontrada' || u.situacao === 'vencida') achadas += 1;
      if (u.situacao === 'encontrada' || u.situacao === 'vencida' || u.situacao === 'pendente') total += 1;
    }
  }
  $('cont-progresso').replaceChildren(el('strong', {}, `${achadas}/${total}`), el('small', {}, 'bipadas'));
  $('cont-barra').style.setProperty('--p', `${total ? Math.round((achadas / total) * 100) : 0}%`);

  for (const b of document.querySelectorAll('#cont-filtros .chip')) b.classList.toggle('ativo', b.dataset.filtro === filtroLista);
  const visiveis = grupos.filter((g) => (filtroLista === 'faltam' ? g.pendentes > 0 : filtroLista === 'achadas' ? g.encontradas > 0 : true));
  const itens = [];
  let produtoAtual = null;
  for (const g of visiveis) {
    if (estado.escopo === 'loja' && g.produtoNome !== produtoAtual) {
      produtoAtual = g.produtoNome;
      itens.push(el('h3', { class: 'grupo-produto' }, g.produtoNome));
    }
    itens.push(elGrupo(g));
  }
  if (!grupos.length) itens.push(el('p', { class: 'vazio' }, 'Nenhuma unidade ativa com QR neste escopo. Bipe mesmo assim: etiquetas com baixa podem ser reativadas.'));
  else if (!visiveis.length) itens.push(el('p', { class: 'vazio' }, filtroLista === 'faltam' ? 'Nada faltando: todas as unidades foram bipadas.' : 'Nenhuma unidade bipada ainda.'));
  $('grupos').replaceChildren(...itens);

  desenharBaixadas(agora);
  const avisos = estado.avisos || [];
  $('bloco-avisos').hidden = !avisos.length;
  $('avisos').replaceChildren(...avisos.map((a) => el('li', { class: `aviso-item ${a.tipo}` }, el('time', {}, formatarHora(a.em)), el('span', {}, a.mensagem))));
}

const SITUACOES = {
  pendente: 'falta bipar',
  encontrada: 'bipada',
  vencida: 'bipada e vencida',
  descartada: 'descartada nesta contagem',
  reativada: 'será reativada',
  baixada: 'estava com baixa',
};

function elGrupo(g) {
  const qtd = g.quantidade !== null && g.quantidade !== undefined && g.quantidade !== '' ? `${formatarQuantidade(g.quantidade)} ${g.medida || ''}`.trim() : '';
  const vencidas = g.unidades.filter((u) => u.situacao === 'vencida').map((u) => u.seq);
  const contaveis = g.unidades.filter((u) => u.situacao !== 'descartada' && u.situacao !== 'baixada').length;
  return el('article', { class: `grupo${g.vencido ? ' vencido' : ''}${g.pendentes ? '' : ' completo'}`, dataset: { numero: String(g.numero) } },
    el('div', { class: 'grupo-topo' },
      el('strong', {}, `Nº ${g.numeroTexto}`),
      el('span', { class: 'grupo-conta' }, `${g.encontradas}/${contaveis}${g.total && g.total !== g.unidades.length ? ` · de ${g.total}` : ''}`)),
    el('div', { class: 'grupo-info' }, [estado.escopo === 'loja' ? null : g.produtoNome, qtd, g.setor, `${g.vencido ? 'venceu' : 'vence'} ${formatarDataHora(g.venceEm)}`].filter(Boolean).join(' · ')),
    el('div', { class: 'fichas' }, ...g.unidades.map((u) => el('button', {
      type: 'button',
      class: `ficha ${u.situacao}`,
      'aria-label': `Unidade ${u.seq}: ${SITUACOES[u.situacao]}`,
      title: SITUACOES[u.situacao],
      onclick: () => tocarFicha(g, u),
    }, String(u.seq)))),
    vencidas.length
      ? el('div', { class: 'grupo-vencida' },
        el('span', {}, vencidas.some((seq) => estado.descartando?.[chave(g.numero, seq)])
          ? `Vencida: UN ${faixas(vencidas)}. O descarte ficou sem confirmação da nuvem: toque de novo (repetir é seguro).`
          : `Vencida: UN ${faixas(vencidas)}. Retire o produto.`),
        el('button', { type: 'button', class: 'botao-perigo', onclick: () => descartarVencidas(g, vencidas) }, 'Descartar e imprimir nova'))
      : null);
}

async function tocarFicha(g, u) {
  const nome = `UN ${u.seq}${g.total ? `/${g.total}` : ''} do nº ${g.numeroTexto}`;
  if (u.situacao === 'encontrada' || u.situacao === 'vencida') {
    const ok = await perguntar({ titulo: 'Desmarcar unidade?', texto: `A ${nome} volta para “falta bipar” e, se não for bipada de novo, recebe baixa ao finalizar.`, sim: 'Desmarcar' });
    if (!ok) return;
    desmarcar(estado, u.chave);
    salvar();
    desenharContagem();
  } else if (u.situacao === 'baixada' || u.situacao === 'reativada') {
    alternarReativar(u.chave);
  } else if (u.situacao === 'pendente') {
    mostrarUltimo({ tipo: 'info', mensagem: `Falta bipar a ${nome}. Sem o QR? Digite ${g.numero}-${u.seq}.` });
  } else {
    mostrarUltimo({ tipo: 'info', mensagem: `A ${nome} foi descartada nesta contagem.` });
  }
}

function desenharBaixadas(agora) {
  const itens = [];
  for (const k of Object.keys(estado.baixadasBipadas)) {
    const u = indice.baixadas.get(k);
    if (!u || !noEscopo(u, estado)) continue;
    const vencida = new Date(u.venceEm) <= agora;
    const reativar = Boolean(estado.reativar[k]);
    const quando = u.baixaEm ? ` em ${formatarDataHora(u.baixaEm)}` : '';
    const origem = u.baixaOrigem === 'contagem' ? ' pela contagem' : '';
    itens.push(el('div', { class: `item-baixa${reativar ? ' reativar' : ''}` },
      el('div', { class: 'item-baixa-textos' },
        el('strong', {}, `Nº ${formatarNumero(u.numero)} · UN ${u.seq}${u.total ? `/${u.total}` : ''}`),
        el('span', {}, `${u.produtoNome} · ${u.status === 'descartada' ? 'descartada' : 'utilizada'}${quando}${origem}`),
        reativar ? el('span', { class: 'texto-ok' }, 'Será reativada ao gravar a contagem.') : null,
        vencida ? el('span', { class: 'texto-critico' }, 'Vencida: descarte o produto.') : null),
      vencida
        ? null
        : el('button', { type: 'button', class: reativar ? 'botao-secundario' : 'botao-principal botao-curto', onclick: () => alternarReativar(k) }, reativar ? 'Não reativar' : 'Reativar')));
  }
  $('bloco-baixadas').hidden = !itens.length;
  $('lista-baixadas').replaceChildren(...itens);
}

function alternarReativar(k) {
  const u = indice.baixadas.get(k);
  if (!u) return;
  if (new Date(u.venceEm) <= new Date()) {
    mostrarUltimo({ tipo: 'vencida', mensagem: `Nº ${formatarNumero(u.numero)} · UN ${u.seq} está vencida: não reative, descarte o produto.` });
    return;
  }
  if (estado.reativar[k]) delete estado.reativar[k];
  else estado.reativar[k] = new Date().toISOString();
  salvar();
  desenharContagem();
}

for (const b of document.querySelectorAll('#cont-filtros .chip')) {
  b.addEventListener('click', () => {
    filtroLista = b.dataset.filtro;
    desenharContagem();
  });
}

// ---------- Bipes ----------

const vistos = new Map(); // texto lido pela câmera -> { em, espera }

function aoLerCodigo(texto, origem) {
  // Gravação sem resposta: a contagem fica como foi enviada (nada de bipe novo).
  if (!estado || estado.finalizada || estado.envio || tela.atual !== 'tela-contagem') return;
  const t = String(texto || '').trim();
  if (!t) return;
  const agora = Date.now();
  if (origem === 'camera') {
    const antes = vistos.get(t);
    if (antes && agora - antes.em < antes.espera) return;
  }
  const r = classificarBipe(estado, indice, t, new Date());
  if (origem === 'camera') {
    const conta = r.tipo === 'ok' || r.tipo === 'vencida' || r.tipo === 'repetido';
    vistos.set(t, { em: agora, espera: conta ? ESPERA_MESMO_CODIGO_MS : ESPERA_AVISO_MS });
    if (r.tipo === 'repetido') return; // o mesmo QR continua na frente da câmera
  }
  if (registrarBipe(estado, r)) salvar();
  sinalizar(r.tipo);
  mostrarUltimo(r);
  desenharContagem();
}

function mostrarUltimo(r) {
  const caixa = $('ultimo');
  const classe = { ok: 'ok', vencida: 'critico', baixada: 'atencao', repetido: 'info', info: 'info', nova: 'info', descarte: 'ok', erro: 'critico' }[r.tipo] || 'atencao';
  const acoes = [];
  if (r.tipo === 'vencida' && r.unidade) {
    const g = { numero: r.numero, numeroTexto: formatarNumero(r.numero), produtoId: r.unidade.produtoId || null, produtoNome: r.unidade.produtoNome };
    acoes.push(el('button', { type: 'button', class: 'botao-perigo', onclick: () => descartarVencidas(g, [r.seq]) }, 'Descartar e imprimir nova'));
  }
  if (r.tipo === 'baixada' && !r.vencida) {
    acoes.push(el('button', { type: 'button', class: 'botao-principal botao-curto', onclick: () => alternarReativar(r.chave) }, 'Reativar'));
  }
  if (r.link) acoes.push(r.link);
  const icone = { ok: '✓', vencida: '⛔', baixada: '↺', repetido: '•', info: 'ℹ', nova: 'ℹ', descarte: '🗑', erro: '!' }[r.tipo] || '⚠';
  caixa.className = `ultimo ${classe}`;
  caixa.replaceChildren(
    el('div', { class: 'ultimo-texto' }, el('span', { class: 'ultimo-icone', 'aria-hidden': 'true' }, icone), el('span', {}, r.mensagem)),
    ...(acoes.length ? [el('div', { class: 'ultimo-acoes' }, ...acoes)] : []),
  );
  caixa.hidden = false;
}

$('form-manual').addEventListener('submit', (ev) => {
  ev.preventDefault();
  prepararSom();
  const campo = $('manual-codigo');
  if (!campo.value.trim()) return;
  aoLerCodigo(campo.value, 'manual');
  campo.value = '';
});

// ---------- Descartar vencida e imprimir nova ----------

function elReimprimir(produto) {
  const destino = linkVolta(estado?.volta, produto);
  if (destino) {
    return el('a', { class: 'botao-principal botao-link-principal', href: destino, rel: 'noopener noreferrer' }, `Imprimir nova etiqueta de ${produto.produtoNome} no celular da loja`);
  }
  return el('p', { class: 'nota-cont' }, `Imprima a nova etiqueta de ${produto.produtoNome} no computador ou no celular da loja.`);
}

async function descartarVencidas(g, seqs) {
  if (!estado) return;
  const itens = seqs.map((seq) => ({ numero: g.numero, seq }));
  const ok = await perguntar({
    titulo: 'Descartar vencida?',
    texto: `Nº ${g.numeroTexto} · ${g.produtoNome}: ${seqs.length === 1 ? `a UN ${seqs[0]} será registrada como descartada` : `as UN ${faixas(seqs)} serão registradas como descartadas`}. Depois imprima uma etiqueta nova para a produção nova (validade contada de hoje).`,
    sim: 'Descartar',
    perigo: true,
  });
  if (!ok || !estado) return;
  // A tentativa fica anotada antes de chamar: se a resposta se perder e a
  // pessoa repetir, "já estava descartada" é o descarte deste aparelho.
  estado.descartando ||= {};
  const antes = { ...estado.descartando };
  const tentativa = new Date().toISOString();
  for (const i of itens) estado.descartando[chave(i.numero, i.seq)] ||= tentativa;
  salvar();
  const repetindo = itens.some((i) => antes[chave(i.numero, i.seq)]);
  let resposta;
  try {
    resposta = await api.descartar(estado.unidadeId, itens, MOTIVO_DESCARTE);
  } catch (e) {
    if (!e?.incerto) {
      // A nuvem respondeu com erro: nada foi descartado.
      for (const i of itens) if (!antes[chave(i.numero, i.seq)]) delete estado.descartando[chave(i.numero, i.seq)];
    }
    salvar();
    if (tratarErroSessao(e)) return;
    desenharContagem();
    mostrarUltimo({
      tipo: 'erro',
      mensagem: e?.incerto
        ? `Não deu para confirmar o descarte: ${e.message} Ele pode já ter sido registrado. Toque em “Descartar e imprimir nova” de novo (repetir é seguro).`
        : `Não foi possível descartar: ${e.message}`,
    });
    return;
  }
  const { deOutro } = resultadoDescarte(itens, resposta, antes);
  const quando = new Date().toISOString();
  for (const i of itens) {
    const k = chave(i.numero, i.seq);
    estado.descartadas[k] = quando;
    delete estado.bipes[k];
    delete estado.descartando[k];
  }
  salvar();
  desenharContagem();
  sinalizar('ok');
  const produto = { produtoId: g.produtoId, produtoNome: g.produtoNome };
  // A nuvem só descarta unidades ainda ativas: as que este aparelho não tinha
  // tentado descartar antes já tinham baixa feita em outro aparelho.
  const outras = deOutro.length;
  mostrarUltimo({
    tipo: 'descarte',
    mensagem: outras
      ? `Nº ${g.numeroTexto}, UN ${faixas(seqs)}: ${n(outras, 'unidade já estava', 'unidades já estavam')} com baixa na nuvem (feita em outro aparelho) e não ${outras === 1 ? 'mudou' : 'mudaram'}. Agora imprima a etiqueta da produção nova.`
      : `${repetindo ? 'Descarte confirmado' : 'Descarte registrado'}: nº ${g.numeroTexto}, UN ${faixas(seqs)}. Agora imprima a etiqueta da produção nova.`,
    link: elReimprimir(produto),
  });
}

/// ---------- Finalizar ----------

$('btn-finalizar').addEventListener('click', () => abrirResumo());
$('btn-voltar-contagem').addEventListener('click', () => {
  if (estado?.envio) abrirResumo();
  else abrirContagem();
});
$('btn-cancelar').addEventListener('click', async () => {
  if (estado?.envio) return cancelarEnvioPendente();
  const ok = await perguntar({
    titulo: 'Cancelar a contagem?',
    texto: textoCancelar(estado),
    sim: 'Cancelar contagem',
    nao: 'Continuar contando',
    perigo: true,
  });
  if (!ok) return;
  encerrarContagem();
  aviso('');
  carregarLojas();
});
$('btn-cancelar-resumo').addEventListener('click', () => cancelarEnvioPendente());

/**
 * Cancelar depois de uma gravação sem resposta: a contagem pode estar gravada
 * na nuvem. Confere lá (desfazer_contagem): "não encontrada" = nada gravado;
 * senão, desfaz o que ela baixou. Só então esquece a contagem no aparelho.
 */
async function cancelarEnvioPendente() {
  const descartes = Object.keys(estado?.descartadas || {}).length;
  const ok = await perguntar({
    titulo: 'Cancelar a contagem?',
    texto: `A resposta da nuvem não chegou: esta contagem pode já ter sido gravada. Ao cancelar, o app confere na nuvem e desfaz as baixas que ela tiver feito (precisa de internet).${descartes ? ' Os descartes de vencidas já registrados continuam.' : ''}`,
    sim: 'Conferir e cancelar',
    nao: 'Voltar',
    perigo: true,
  });
  if (!ok || !estado?.envio) return;
  const botao = $('btn-cancelar-resumo');
  botao.disabled = true;
  $('resumo-erro').hidden = true;
  let mensagem;
  try {
    const r = await api.desfazer(estado.id);
    const voltaram = Number(r?.reativadas) || 0;
    mensagem = r?.jaDesfeita
      ? 'A contagem tinha sido gravada e já estava desfeita. Contagem cancelada.'
      : `A contagem tinha sido gravada na nuvem e foi desfeita: ${n(voltaram, 'unidade baixada por ela voltou', 'unidades baixadas por ela voltaram')} a ficar ${voltaram === 1 ? 'ativa' : 'ativas'}.`;
  } catch (e) {
    if (/contagem não encontrada/i.test(e?.message || '')) {
      mensagem = 'Nada tinha sido gravado na nuvem. Contagem cancelada.';
    } else {
      botao.disabled = false;
      if (tratarErroSessao(e)) return;
      abrirResumo();
      $('resumo-erro').textContent = `${e.message} A contagem continua travada até o app conferir na nuvem.`;
      $('resumo-erro').hidden = false;
      return;
    }
  }
  botao.disabled = false;
  encerrarContagem();
  await carregarLojas();
  aviso(mensagem, 'alerta');
}

function listaResumo(titulo, itens, classe, vazio = '') {
  if (!itens.length && !vazio) return null;
  return el('section', { class: `bloco resumo-bloco ${classe}` },
    el('h2', {}, titulo),
    itens.length
      ? el('ul', { class: 'resumo-lista' }, ...itens.map((i) => el('li', {},
        el('strong', {}, `Nº ${i.numeroTexto}`),
        el('span', { class: 'resumo-produto' }, i.produtoNome),
        el('span', { class: 'resumo-un' }, i.texto))))
      : el('p', { class: 'vazio' }, vazio));
}

function numeros(pares) {
  return pares.map(([num, nome, classe]) => el('div', { class: `numero ${classe}` }, el('strong', {}, String(num)), el('span', {}, nome)));
}

/** Vencidas cujo descarte ficou sem resposta da nuvem ("Nº 001071 UN 1, 2"). */
function descartesSemConfirmacao() {
  const porNumero = new Map();
  for (const k of Object.keys(estado.descartando || {})) {
    if (estado.descartadas[k]) continue;
    const [num, seq] = k.split('-').map(Number);
    porNumero.set(num, [...(porNumero.get(num) || []), seq]);
  }
  return [...porNumero].map(([num, seqs]) => `Nº ${formatarNumero(num)} UN ${faixas(seqs)}`);
}

function abrirResumo() {
  // Enviada sem resposta: mostra e reenvia exatamente o que foi enviado.
  const travada = Boolean(estado.envio);
  const r = travada ? estado.envio.resumo : montarResumo(estado, indice);
  mostrar('tela-resumo');
  $('resumo-erro').hidden = true;
  $('resumo-escopo').textContent = `${estado.unidadeNome} · ${tituloEscopo()} · iniciada às ${formatarHora(estado.iniciadaEm)}`;
  $('resumo-numeros').replaceChildren(...numeros([
    [r.encontradas, 'bipadas', 'ok'],
    [r.totalABaixar, 'serão baixadas', r.totalABaixar ? 'atencao' : 'neutro'],
    [r.totalVencidas, 'vencidas bipadas', r.totalVencidas ? 'critico' : 'neutro'],
    [r.totalReativadas, 'reativadas', r.totalReativadas ? 'info' : 'neutro'],
  ]));
  $('resumo-travada').textContent = travada
    ? `A gravação desta contagem pode já ter sido feita: a resposta da nuvem não chegou (enviada às ${formatarHora(estado.envio.em)}). Para não baixar nada errado, ela ficou travada como foi enviada. Toque em “Tentar gravar de novo” (é seguro: a nuvem reconhece a mesma contagem e não grava duas vezes) ou cancele, que o app confere na nuvem e desfaz o que tiver sido baixado.`
    : '';
  $('resumo-travada').hidden = !travada;
  $('resumo-alerta').textContent = r.alerta || '';
  $('resumo-alerta').hidden = !r.alerta;
  const pessoa = textoOutraPessoa();
  $('resumo-pessoa').textContent = pessoa;
  $('resumo-pessoa').hidden = !pessoa;
  const semConfirmar = descartesSemConfirmacao();
  $('resumo-listas').replaceChildren(...[
    listaResumo(`Serão baixadas como utilizadas (${r.totalABaixar})`, r.aBaixar, 'baixar', 'Nenhuma: todas as unidades ativas foram bipadas.'),
    r.vencidas.length ? listaResumo(`Vencidas bipadas: continuam ativas (${r.totalVencidas})`, r.vencidas, 'vencidas') : null,
    r.vencidas.length && !travada ? el('p', { class: 'alerta-cont' }, 'Volte e toque em “Descartar e imprimir nova” nas vencidas; senão elas continuam avisando vencimento.') : null,
    semConfirmar.length && !travada
      ? el('p', { class: 'alerta-cont' }, `Descarte sem confirmação da nuvem: ${semConfirmar.join('; ')}. Volte e toque em “Descartar e imprimir nova” de novo para confirmar (repetir é seguro).`)
      : null,
    listaResumo(`Serão reativadas (${r.totalReativadas})`, r.reativadas, 'reativadas'),
    listaResumo(`Descartadas nesta contagem (${r.totalDescartadas}, já registradas)`, r.descartadas, 'descartadas'),
  ].filter(Boolean));
  $('resumo-nota').textContent = `Etiquetas impressas depois das ${formatarHora(estado.inicio)} e etiquetas antigas sem QR não entram nesta contagem.`;
  $('btn-voltar-contagem').hidden = travada;
  $('btn-cancelar-resumo').hidden = !travada;
  $('btn-confirmar').textContent = travada
    ? 'Tentar gravar de novo'
    : r.totalABaixar ? `Confirmar e dar baixa em ${n(r.totalABaixar, 'unidade', 'unidades')}` : 'Confirmar contagem';
}

$('btn-confirmar').addEventListener('click', async () => {
  if (!estado || estado.finalizada) return;
  const botao = $('btn-confirmar');
  if (!estado.envio) {
    const r = montarResumo(estado, indice);
    const { lidas, reativar, ...resumo } = r;
    // Guardado ANTES de chamar a nuvem: se a resposta se perder, a contagem
    // trava e o reenvio é idêntico (mesmo id, mesmas lidas).
    estado.envio = { em: new Date().toISOString(), dados: dadosFinalizar(estado, r), resumo, semResposta: 0 };
    salvar();
  }
  const envio = estado.envio;
  botao.disabled = true;
  botao.textContent = 'Gravando…';
  $('resumo-erro').hidden = true;
  try {
    const resposta = await api.finalizar(envio.dados);
    estado.finalizada = {
      em: new Date().toISOString(),
      resposta,
      local: envio.resumo,
      desfeita: null,
      divergencia: conferirResposta(resposta, envio.dados),
      descartesSemConfirmacao: descartesSemConfirmacao().length,
    };
    estado.envio = null;
    salvar();
    botao.disabled = false;
    mostrarResultado();
  } catch (e) {
    if (e?.incerto) envio.semResposta += 1;
    // A nuvem respondeu com erro e nunca ficou sem resposta antes (ou garantiu
    // que não gravou): nada foi gravado, a contagem destrava.
    else if (!envio.semResposta || e?.naoGravada) estado.envio = null;
    salvar();
    botao.disabled = false;
    if (tratarErroSessao(e)) return;
    abrirResumo();
    $('resumo-erro').textContent = estado.envio
      ? `${e.message} A gravação pode já ter sido feita; a contagem continua travada.`
      : e.message;
    $('resumo-erro').hidden = false;
  }
});

function mostrarResultado() {
  mostrar('tela-resultado');
  const f = estado.finalizada;
  const r = lerResultado(f.resposta, f.local);
  $('resultado-erro').hidden = true;
  const des = f.desfeita?.resposta;
  const voltaram = typeof des?.reativadas === 'number' ? des.reativadas : null;
  $('resultado-titulo').textContent = f.desfeita ? 'Contagem desfeita' : 'Contagem gravada';
  let texto = `${estado.unidadeNome} · ${tituloEscopo()} · gravada às ${formatarHora(f.em)}. O computador da loja recebe as baixas na próxima sincronização.`;
  if (des?.jaDesfeita) texto = 'Esta contagem já estava desfeita: as unidades que ela baixou já voltaram a ficar ativas.';
  else if (f.desfeita) {
    texto = `${voltaram === null ? 'As unidades' : `${n(voltaram, 'unidade', 'unidades')}`} baixadas por esta contagem ${voltaram === 1 ? 'voltou' : 'voltaram'} a ficar ${voltaram === 1 ? 'ativa' : 'ativas'}.`;
  }
  $('resultado-escopo').textContent = texto;
  $('resultado-numeros').replaceChildren(...numeros([
    [r.encontradas, 'bipadas', 'ok'],
    f.desfeita ? [r.baixadas, 'baixadas e depois desfeitas', 'neutro'] : [r.baixadas, 'baixadas como utilizadas', r.baixadas ? 'atencao' : 'neutro'],
    [r.reativadas, 'reativadas', r.reativadas ? 'info' : 'neutro'],
  ]));
  const reimprimir = produtosParaReimprimir(estado, indice);
  const div = f.divergencia;
  const motivoIgnoradas = f.descartesSemConfirmacao
    ? 'descarte deste aparelho que ficou sem confirmação, ou baixa feita em outro aparelho durante a contagem'
    : 'baixa feita em outro aparelho durante a contagem';
  $('resultado-reimprimir').replaceChildren(...[
    div ? el('p', { class: 'alerta-cont' }, `Atenção: a nuvem já tinha esta contagem gravada com ${n(div.nuvem, 'unidade bipada', 'unidades bipadas')}, e este aparelho enviou ${div.enviadas}. Vale o que está gravado na nuvem: confira a lista de baixadas abaixo e, se houver erro, desfaça a contagem.`) : null,
    r.ignoradas ? el('p', { class: 'alerta-cont' }, `${n(r.ignoradas, 'unidade bipada já não estava ativa', 'unidades bipadas já não estavam ativas')} na nuvem ao gravar (${motivoIgnoradas}) e não ${r.ignoradas === 1 ? 'foi alterada' : 'foram alteradas'}.`) : null,
    reimprimir.length ? el('section', { class: 'bloco' }, el('h2', {}, 'Imprimir etiquetas novas'), ...reimprimir.map((p) => elReimprimir(p))) : null,
    f.desfeita ? null : listaResumo(`Baixadas como utilizadas (${r.baixadas})`, r.baixadasLista, 'baixar', 'Nenhuma unidade foi baixada.'),
  ].filter(Boolean));
  $('btn-desfazer').hidden = Boolean(f.desfeita);
  const voltar = $('link-voltar-celular');
  voltar.hidden = !estado.volta;
  if (estado.volta) voltar.href = estado.volta;
}

$('btn-desfazer').addEventListener('click', async () => {
  const ok = await perguntar({
    titulo: 'Desfazer a contagem?',
    texto: 'As unidades que esta contagem baixou voltam a ficar ativas. Descartes de vencidas e reativações não são desfeitos.',
    sim: 'Desfazer contagem',
    perigo: true,
  });
  if (!ok) return;
  const botao = $('btn-desfazer');
  botao.disabled = true;
  try {
    const resposta = await api.desfazer(estado.id);
    estado.finalizada.desfeita = { em: new Date().toISOString(), resposta };
    salvar();
    mostrarResultado();
  } catch (e) {
    if (!tratarErroSessao(e)) {
      $('resultado-erro').textContent = e?.incerto
        ? `${e.message} O desfazer pode já ter sido feito: toque em “Desfazer contagem” de novo para conferir (repetir é seguro).`
        : e.message;
      $('resultado-erro').hidden = false;
    }
  } finally {
    botao.disabled = false;
  }
});

$('btn-nova').addEventListener('click', () => {
  encerrarContagem();
  aviso('');
  carregarLojas();
});

// ---------- Som, vibração e tela acesa ----------

let audio = null;
function prepararSom() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    if (audio?.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}
function tom(freq, inicio, duracao, volume = 0.2) {
  const o = audio.createOscillator();
  const g = audio.createGain();
  const t = audio.currentTime + inicio;
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duracao);
  o.connect(g);
  g.connect(audio.destination);
  o.start(t);
  o.stop(t + duracao + 0.02);
}
function sinalizar(tipo) {
  const vibrar = (p) => {
    try {
      navigator.vibrate?.(p);
    } catch {
      // sem vibração
    }
  };
  try {
    if (audio?.state === 'suspended') audio.resume();
    if (tipo === 'ok') {
      if (audio) tom(1760, 0, 0.08, 0.12);
      vibrar(50);
    } else if (tipo === 'vencida') {
      if (audio) {
        tom(880, 0, 0.16);
        tom(440, 0.2, 0.3);
      }
      vibrar([150, 80, 150]);
    } else if (tipo === 'repetido' || tipo === 'info' || tipo === 'nova') {
      // Neutro: etiqueta nova (impressa depois do início) não é erro.
      if (audio) tom(990, 0, 0.04, 0.06);
    } else if (tipo === 'desconhecido') {
      if (audio) tom(660, 0, 0.12, 0.12);
      vibrar(80);
    } else {
      if (audio) {
        tom(330, 0, 0.12);
        tom(330, 0.18, 0.12);
      }
      vibrar([60, 50, 60]);
    }
  } catch {
    // sem som
  }
}

// ---------- Câmera ----------

const camera = { stream: null, trilha: null, querLigada: false, abrindo: false, detector: null, leitor: null, timer: 0, lanterna: false, canvas: null, ctx: null, trava: null, mira: 0 };

function estadoCamera(texto, tipo = '') {
  const p = $('camera-estado');
  p.textContent = texto || '';
  p.className = `camera-estado ${tipo}`;
  p.hidden = !texto;
}

function atualizarBotaoCamera() {
  const ligada = Boolean(camera.stream);
  $('btn-camera').textContent = ligada ? '⏹ Desligar câmera' : '📷 Ligar câmera';
  $('camera').classList.toggle('ligada', ligada);
  const caps = camera.trilha?.getCapabilities?.() || {};
  $('btn-lanterna').hidden = !(ligada && caps.torch);
  $('btn-lanterna').classList.toggle('ativo', camera.lanterna);
}

async function cameraLiberada() {
  try {
    const p = await navigator.permissions?.query({ name: 'camera' });
    return p?.state === 'granted';
  } catch {
    return false;
  }
}

async function travarTela() {
  try {
    if (navigator.wakeLock && !camera.trava) {
      const trava = await navigator.wakeLock.request('screen');
      if (!camera.stream) {
        trava.release().catch(() => {});
        return;
      }
      camera.trava = trava;
      trava.addEventListener('release', () => {
        if (camera.trava === trava) camera.trava = null;
      });
    }
  } catch {
    camera.trava = null;
  }
}

async function ligarCamera() {
  camera.querLigada = true;
  if (camera.stream || camera.abrindo) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    camera.querLigada = false;
    estadoCamera('Este navegador não libera a câmera aqui. Digite os códigos no campo abaixo.', 'erro');
    return;
  }
  camera.abrindo = true;
  estadoCamera('Abrindo a câmera…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (!camera.querLigada || document.visibilityState === 'hidden' || tela.atual !== 'tela-contagem') {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    camera.stream = stream;
    camera.trilha = stream.getVideoTracks()[0] || null;
    camera.lanterna = false;
    const video = $('video');
    video.srcObject = stream;
    await video.play().catch(() => {});
    // Desligada enquanto abria (botão, troca de tela ou aba oculta): para aqui.
    if (camera.stream !== stream) return;
    try {
      await camera.trilha?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {
      // foco automático não ajustável neste aparelho
    }
    await prepararLeitor();
    if (camera.stream !== stream) return;
    travarTela();
    estadoCamera(camera.leitor && !camera.leitor.ativo ? 'O leitor de QR não carregou. Digite os códigos abaixo.' : 'Aponte o quadrado para o QR da etiqueta.');
    agendarLeitura(300);
  } catch (e) {
    camera.querLigada = false;
    const msg = {
      NotAllowedError: 'Sem permissão para usar a câmera. Libere a câmera para este site nas configurações do navegador, ou digite os códigos abaixo.',
      SecurityError: 'Sem permissão para usar a câmera. Libere a câmera para este site nas configurações do navegador, ou digite os códigos abaixo.',
      NotFoundError: 'Nenhuma câmera encontrada neste aparelho. Digite os códigos abaixo.',
      OverconstrainedError: 'Nenhuma câmera encontrada neste aparelho. Digite os códigos abaixo.',
      NotReadableError: 'A câmera está em uso por outro app. Feche o outro app e tente de novo.',
    }[e?.name] || 'Não foi possível abrir a câmera. Digite os códigos abaixo.';
    estadoCamera(msg, 'erro');
  } finally {
    camera.abrindo = false;
    atualizarBotaoCamera();
  }
}

function pararCamera(manterIntencao = false) {
  clearTimeout(camera.timer);
  if (!manterIntencao) camera.querLigada = false;
  for (const t of camera.stream?.getTracks() || []) t.stop();
  camera.stream = null;
  camera.trilha = null;
  camera.lanterna = false;
  const video = $('video');
  if (video) video.srcObject = null;
  camera.trava?.release().catch(() => {});
  camera.trava = null;
  if (tela.atual === 'tela-contagem') {
    atualizarBotaoCamera();
    estadoCamera('Câmera desligada.');
  }
}

$('btn-camera').addEventListener('click', () => {
  prepararSom();
  if (camera.stream) pararCamera();
  else ligarCamera();
});

$('btn-lanterna').addEventListener('click', async () => {
  if (!camera.trilha) return;
  try {
    await camera.trilha.applyConstraints({ advanced: [{ torch: !camera.lanterna }] });
    camera.lanterna = !camera.lanterna;
  } catch {
    $('btn-lanterna').hidden = true;
  }
  atualizarBotaoCamera();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pararCamera(true);
  else if (tela.atual === 'tela-contagem' && camera.querLigada) ligarCamera();
});
window.addEventListener('pagehide', () => pararCamera(true));

async function prepararLeitor() {
  if (camera.detector || camera.leitor) return;
  if ('BarcodeDetector' in window) {
    try {
      const formatos = await window.BarcodeDetector.getSupportedFormats();
      if (formatos.includes('qr_code')) {
        camera.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        return;
      }
    } catch {
      // usa o jsQR
    }
  }
  camera.leitor = leitorJsQR();
}

/** jsQR num worker (contagem-leitor.js), para não travar a tela. */
function leitorJsQR() {
  let worker = null;
  let quebrado = false;
  let ultimo = 0;
  const pendentes = new Map();
  const falhar = () => {
    quebrado = true;
    for (const ok of pendentes.values()) ok(null);
    pendentes.clear();
    worker?.terminate();
    worker = null;
    if (tela.atual === 'tela-contagem') estadoCamera('O leitor de QR não carregou. Digite os códigos abaixo.', 'erro');
  };
  try {
    worker = new Worker('contagem-leitor.js');
    worker.addEventListener('message', (ev) => {
      const ok = pendentes.get(ev.data?.id);
      pendentes.delete(ev.data?.id);
      ok?.(ev.data?.texto || null);
    });
    worker.addEventListener('error', falhar);
  } catch {
    quebrado = true;
  }
  return {
    get ativo() {
      return !quebrado;
    },
    ler(imagem) {
      if (quebrado || !worker) return Promise.resolve(null);
      const id = ++ultimo;
      return new Promise((ok) => {
        pendentes.set(id, ok);
        setTimeout(() => {
          if (pendentes.delete(id)) ok(null);
        }, 3000);
        worker.postMessage({ id, largura: imagem.width, altura: imagem.height, dados: imagem.data.buffer }, [imagem.data.buffer]);
      });
    },
  };
}

function agendarLeitura(ms = INTERVALO_LEITURA_MS) {
  clearTimeout(camera.timer);
  camera.timer = setTimeout(lerQuadro, ms);
}

async function lerQuadro() {
  if (!camera.stream) return;
  const video = $('video');
  const comeco = performance.now();
  if (video.readyState >= 2 && video.videoWidth) {
    try {
      for (const texto of await decodificar(video)) aoLerCodigo(texto, 'camera');
    } catch {
      // quadro perdido: tenta o próximo
    }
  }
  if (camera.stream) agendarLeitura(Math.max(40, INTERVALO_LEITURA_MS - (performance.now() - comeco)));
}

/** Lê só o quadrado da mira (centro da imagem visível), reduzido. */
async function decodificar(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const caixa = video.getBoundingClientRect();
  let lado = Math.min(vw, vh) * FRACAO_MIRA;
  if (caixa.width && caixa.height) {
    const escala = Math.max(caixa.width / vw, caixa.height / vh); // object-fit: cover
    lado = Math.min(caixa.width / escala, caixa.height / escala, vw, vh) * FRACAO_MIRA;
    const px = Math.round(lado * escala);
    if (px !== camera.mira) {
      camera.mira = px;
      $('mira').style.setProperty('--lado', `${px}px`);
    }
  }
  const alvo = Math.max(1, Math.round(Math.min(LADO_MAX, lado)));
  if (!camera.canvas) {
    camera.canvas = document.createElement('canvas');
    camera.ctx = camera.canvas.getContext('2d', { willReadFrequently: true });
  }
  const c = camera.canvas;
  if (c.width !== alvo) {
    c.width = alvo;
    c.height = alvo;
  }
  camera.ctx.drawImage(video, (vw - lado) / 2, (vh - lado) / 2, lado, lado, 0, 0, alvo, alvo);
  if (camera.detector) {
    try {
      const achados = await camera.detector.detect(c);
      return achados.map((a) => a.rawValue).filter(Boolean);
    } catch {
      camera.detector = null;
      camera.leitor = leitorJsQR();
      return [];
    }
  }
  if (!camera.leitor?.ativo) return [];
  const texto = await camera.leitor.ler(camera.ctx.getImageData(0, 0, alvo, alvo));
  return texto ? [texto] : [];
}

// ---------- Início ----------

// A mesma contagem aberta em outra aba (o celular da loja abre a Contagem em
// aba nova): esta aba acompanha o que foi salvo lá.
window.addEventListener('storage', (ev) => {
  if (ev.key !== CHAVE_ANDAMENTO || !sessao.logado) return;
  const novo = lerAndamento();
  const naContagem = ['tela-contagem', 'tela-resumo', 'tela-resultado'].includes(tela.atual);
  if (!novo || !andamentoValido(novo)) {
    if (!estado) return;
    pararCamera();
    estado = null;
    indice = null;
    if (naContagem) carregarLojas();
    return;
  }
  estado = novo;
  estado.descartando ||= {};
  indice = indexar(estado);
  if (estado.finalizada) {
    if (naContagem) mostrarResultado();
  } else if (estado.envio) {
    // Gravada na outra aba sem resposta: aqui também fica travada.
    if (naContagem || tela.atual === 'tela-escolha') abrirResumo();
  } else if (tela.atual === 'tela-contagem') desenharContagem();
  else if (tela.atual === 'tela-resumo') abrirResumo();
  else if (tela.atual === 'tela-escolha' || tela.atual === 'tela-resultado') abrirContagem();
});

window.addEventListener('hashchange', () => {
  if (!lerHash(location.hash).chave) return;
  link = lerLink();
  if (!estado && tela.atual === 'tela-escolha' && tela.lojas.length) desenharLojas();
});

$('copyright').textContent = `© ${new Date().getFullYear()} Grupo Impettus. Todos os direitos reservados.`;

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
