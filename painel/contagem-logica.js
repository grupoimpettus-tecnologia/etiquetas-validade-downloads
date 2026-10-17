// Contagem por QR code: regras puras (sem tela, câmera nem rede).
//
// A pessoa bipa as unidades que estão na loja. Ao finalizar, as unidades ATIVAS
// do escopo (um produto ou a loja inteira) que não foram bipadas recebem baixa
// como "utilizadas" na nuvem. Aqui só se decide o que cada bipe significa e o
// que será enviado; quem grava e confere o acesso é a nuvem (contagem-api.js).
import { lerCodigo, rotuloUnidade } from '../shared/qr-etiqueta.js';
import { formatarHora } from '../shared/validade.js';
import { normalizar } from './dados.js';

/** Contagem não gravada fica guardada no aparelho por até 12 horas. */
export const VALIDADE_ANDAMENTO_MS = 12 * 3600_000;

/** Mais da metade do escopo sem bipe merece um aviso antes de confirmar. */
const FRACAO_ALERTA = 0.5;

export const chave = (numero, seq) => `${Number(numero)}-${Number(seq)}`;
export const formatarNumero = (numero) => String(numero).padStart(6, '0');
const rotulo = (seq, total) => (total ? rotuloUnidade(seq, total) : `UN ${seq}`);
const vencida = (u, agora) => new Date(u.venceEm) <= agora;
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** Mesmo critério da nuvem (normalizar_nome_produto): sem acento, caixa e espaços extras. */
export const nomeProduto = (t) => normalizar(t).replace(/\s+/g, ' ');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Link de entrada e de volta ----------

/** IPv4 de rede privada (onde o app do computador atende o celular). */
function ipPrivado(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host || '');
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * Endereço de volta para o celular da loja: só http:// num IP privado, sem
 * usuário/senha; devolve só a origem com "/". Qualquer outra coisa vira ''
 * (o link não pode levar a um site de fora).
 */
export function validarVolta(texto) {
  if (!texto) return '';
  let u;
  try {
    u = new URL(String(texto));
  } catch {
    return '';
  }
  if (u.protocol !== 'http:' || u.username || u.password || !ipPrivado(u.hostname)) return '';
  return `${u.origin}/`;
}

/**
 * Lê o #unidade=…&produto=…&volta=…&n=… do link que vem do celular. "n" muda a
 * cada toque em Contagem no celular; "chave" identifica o link (recarregar a
 * página não é um link novo).
 */
export function lerHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const id = (v) => (UUID.test(v || '') ? v.toLowerCase() : '');
  const link = { unidade: id(p.get('unidade')), produto: id(p.get('produto')), volta: validarVolta(p.get('volta')) };
  const n = /^[A-Za-z0-9_-]{1,40}$/.test(p.get('n') || '') ? p.get('n') : '';
  if (n) link.n = n;
  if (link.unidade || link.produto || link.volta) link.chave = [link.unidade, link.produto, link.volta, n].join('|');
  return link;
}

/** Link para a Nova Etiqueta do produto no celular da loja. */
export function linkVolta(volta, produto = null) {
  const base = validarVolta(volta);
  if (!base || !produto) return base;
  return `${base}#produto=${encodeURIComponent(produto.produtoId || '')}&nome=${encodeURIComponent(produto.produtoNome || '')}`;
}

// ---------- Escopo ----------

/** A unidade pertence ao escopo (produto pelo id; sem id, pelo nome; nenhum = loja inteira)? */
export function noEscopo(u, { produtoId = null, produtoNome = null } = {}) {
  if (produtoId) return u.produtoId === produtoId;
  if (produtoNome) return nomeProduto(u.produtoNome) === nomeProduto(produtoNome);
  return true;
}

/** Produtos da loja com unidades ativas (para escolher o escopo). */
export function listarProdutos(unidades = [], agora = new Date()) {
  const porChave = new Map();
  for (const u of unidades) {
    const k = u.produtoId || `nome:${nomeProduto(u.produtoNome)}`;
    let p = porChave.get(k);
    if (!p) {
      p = { chave: k, produtoId: u.produtoId || null, produtoNome: u.produtoNome || '', ativas: 0, vencidas: 0, numeros: new Set() };
      porChave.set(k, p);
    }
    p.ativas += 1;
    p.numeros.add(Number(u.numero));
    if (vencida(u, agora)) p.vencidas += 1;
  }
  return [...porChave.values()]
    .map(({ numeros, ...p }) => ({ ...p, etiquetas: numeros.size }))
    .sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, 'pt-BR'));
}

/**
 * Quem está conectado, lido do token de acesso (sem chamar a nuvem).
 * @returns {{ id: string, email: string } | null}
 */
export function usuarioDoToken(token) {
  try {
    const parte = String(token || '').split('.')[1];
    if (!parte) return null;
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dados = JSON.parse(new TextDecoder().decode(bytes));
    return typeof dados?.sub === 'string' && dados.sub ? { id: dados.sub, email: typeof dados.email === 'string' ? dados.email : '' } : null;
  } catch {
    return null;
  }
}

/**
 * Quem começou a contagem não é quem está conectado agora (sessão trocada no
 * meio). Devolve os nomes para o aviso; null se for a mesma pessoa ou se não
 * der para saber.
 */
export function outraPessoa(estado, conectado) {
  if (!estado?.usuarioId || !conectado?.id || conectado.id === estado.usuarioId) return null;
  return { iniciou: estado.usuario?.nome || 'outra pessoa', agora: conectado.email || '' };
}

/** Nova contagem a partir da resposta de contagem_escopo. */
export function novoEstado(resposta, {
  id, unidadeId, produto = null, volta = '', usuario = null, usuarioId = null, linkChave = '', agora = new Date(),
}) {
  return {
    versao: 1,
    id,
    unidadeId,
    unidadeNome: resposta?.unidade?.nome || '',
    marca: resposta?.unidade?.marca || '',
    escopo: produto ? 'produto' : 'loja',
    produtoId: produto?.produtoId || null,
    produtoNome: produto?.produtoNome || null,
    inicio: resposta?.inicio,
    iniciadaEm: agora.toISOString(),
    volta: validarVolta(volta),
    usuario,
    usuarioId,
    linkChave,
    unidades: Array.isArray(resposta?.unidades) ? resposta.unidades : [],
    baixadas: Array.isArray(resposta?.baixadasRecentes) ? resposta.baixadasRecentes : [],
    bipes: {},
    baixadasBipadas: {},
    reativar: {},
    descartadas: {},
    descartando: {},
    avisos: [],
    envio: null,
    finalizada: null,
  };
}

/**
 * Contagem guardada no aparelho ainda serve? (formato e prazo). Enviada sem
 * resposta não vence: pode estar gravada na nuvem e precisa ser conferida.
 */
export function andamentoValido(salvo, agora = new Date()) {
  return Boolean(salvo && salvo.versao === 1 && salvo.id && salvo.unidadeId && salvo.inicio
    && Array.isArray(salvo.unidades) && salvo.bipes && typeof salvo.bipes === 'object'
    && ((salvo.envio && !salvo.finalizada) || agora - new Date(salvo.iniciadaEm) < VALIDADE_ANDAMENTO_MS));
}

/** Índices para responder rápido a cada bipe (não são guardados). */
export function indexar(estado) {
  const ativas = new Map();
  const baixadas = new Map();
  const numeros = new Map();
  let maiorNumero = 0;
  const anotar = (u) => {
    const n = Number(u.numero);
    if (!numeros.has(n)) numeros.set(n, { total: Number(u.total) || 0, produtoNome: u.produtoNome || '' });
    if (n > maiorNumero) maiorNumero = n;
  };
  for (const u of estado.unidades) {
    ativas.set(chave(u.numero, u.seq), u);
    anotar(u);
  }
  for (const u of estado.baixadas) {
    const k = chave(u.numero, u.seq);
    if (!ativas.has(k)) baixadas.set(k, u);
    anotar(u);
  }
  return { ativas, baixadas, numeros, maiorNumero };
}

// ---------- Bipes ----------

/**
 * O que significa o código lido/digitado agora. Não altera o estado.
 * tipo: ok | vencida | baixada | repetido | outro-produto | nova | desconhecido | sem-unidade | invalido
 */
export function classificarBipe(estado, indice, texto, agora = new Date()) {
  const cod = lerCodigo(texto);
  if (!cod) return { tipo: 'invalido', texto: String(texto ?? '').trim(), mensagem: 'Código não reconhecido: não é o QR de uma etiqueta do sistema.' };
  const num = formatarNumero(cod.numero);
  const doNumero = indice.numeros.get(cod.numero);
  let seq = cod.seq;
  if (seq === null) {
    if (doNumero?.total !== 1) {
      return {
        tipo: 'sem-unidade',
        numero: cod.numero,
        mensagem: doNumero
          ? `O nº ${num} tem ${doNumero.total} unidades: digite também a unidade, ex.: ${cod.numero}-1.`
          : `Digite o número com a unidade, ex.: ${cod.numero}-1.`,
      };
    }
    seq = 1;
  }
  const k = chave(cod.numero, seq);
  const base = { chave: k, numero: cod.numero, seq };

  const u = indice.ativas.get(k);
  if (u) {
    const nome = `Nº ${num} · ${rotulo(seq, u.total)}`;
    if (!noEscopo(u, estado)) {
      return { ...base, tipo: 'outro-produto', unidade: u, mensagem: `${nome} é de ${u.produtoNome}, fora desta contagem (${estado.produtoNome}). Não conta aqui.` };
    }
    if (estado.descartadas[k]) return { ...base, tipo: 'repetido', unidade: u, mensagem: `${nome} já foi descartada nesta contagem.` };
    if (estado.bipes[k]) return { ...base, tipo: 'repetido', unidade: u, mensagem: `${nome} já foi bipada.` };
    if (vencida(u, agora)) return { ...base, tipo: 'vencida', unidade: u, mensagem: `${nome} · ${u.produtoNome} está VENCIDA. Descarte o produto.` };
    return { ...base, tipo: 'ok', unidade: u, mensagem: `${nome} · ${u.produtoNome}` };
  }

  const b = indice.baixadas.get(k);
  if (b) {
    const nome = `Nº ${num} · ${rotulo(seq, b.total)}`;
    if (!noEscopo(b, estado)) {
      return { ...base, tipo: 'outro-produto', unidade: b, mensagem: `${nome} é de ${b.produtoNome} e já tinha baixa. Não conta nesta contagem.` };
    }
    if (estado.baixadasBipadas[k] || estado.reativar[k]) return { ...base, tipo: 'repetido', unidade: b, mensagem: `${nome} já foi bipada.` };
    const venc = vencida(b, agora);
    return {
      ...base,
      tipo: 'baixada',
      unidade: b,
      vencida: venc,
      mensagem: venc
        ? `${nome} estava com baixa e está vencida: descarte o produto.`
        : `${nome} estava com baixa (${b.status === 'descartada' ? 'descartada' : 'utilizada'}). Reative se o produto ainda está aqui.`,
    };
  }

  if (doNumero && doNumero.total && seq > doNumero.total) {
    return { ...base, tipo: 'desconhecido', mensagem: `A etiqueta nº ${num} tem só ${doNumero.total} unidades.` };
  }
  const hora = estado.inicio ? ` (${formatarHora(estado.inicio)})` : '';
  // A numeração é crescente: nº maior que todos os da loja no início = etiqueta
  // impressa depois (ex.: a nova da vencida descartada). Não é erro.
  if (indice.maiorNumero && cod.numero > indice.maiorNumero) {
    return {
      ...base,
      tipo: 'nova',
      mensagem: `Nº ${num} · UN ${seq} é uma etiqueta nova, impressa depois do início da contagem${hora}: não entra nesta contagem e continua ativa.`,
    };
  }
  return {
    ...base,
    tipo: 'desconhecido',
    mensagem: `Nº ${num} · UN ${seq} não estava nesta loja no início da contagem${hora}: pode ter sido impressa depois, ser de outra loja ou ainda não ter sido enviada pelo computador. Não entra nesta contagem e não recebe baixa.`,
  };
}

/** Registra o bipe no estado (só os que contam). Devolve true se mudou algo. */
export function registrarBipe(estado, r, agora = new Date()) {
  const quando = agora.toISOString();
  if (r.tipo === 'ok' || r.tipo === 'vencida') {
    estado.bipes[r.chave] = quando;
    return true;
  }
  if (r.tipo === 'baixada') {
    estado.baixadasBipadas[r.chave] = quando;
    return true;
  }
  if (r.tipo === 'outro-produto' || r.tipo === 'nova' || r.tipo === 'desconhecido' || r.tipo === 'invalido' || r.tipo === 'sem-unidade') {
    estado.avisos = [{ em: quando, tipo: r.tipo, mensagem: r.mensagem }, ...(estado.avisos || []).filter((a) => a.mensagem !== r.mensagem)].slice(0, 30);
    return true;
  }
  return false;
}

/** Desfaz um bipe feito por engano. */
export function desmarcar(estado, k) {
  delete estado.bipes[k];
  delete estado.reativar[k];
}

// ---------- Lista e resumo ----------

/**
 * Unidades do escopo agrupadas por nº (e por produto, na loja inteira).
 * estado de cada unidade: pendente | encontrada | vencida | descartada | reativada | baixada
 */
export function gruposDoEscopo(estado, indice, agora = new Date()) {
  const grupos = new Map();
  const grupo = (u) => {
    const n = Number(u.numero);
    let g = grupos.get(n);
    if (!g) {
      g = {
        numero: n,
        numeroTexto: formatarNumero(n),
        produtoId: u.produtoId || null,
        produtoNome: u.produtoNome || '',
        total: Number(u.total) || 0,
        venceEm: u.venceEm,
        manipuladoEm: u.manipuladoEm,
        quantidade: u.quantidade,
        medida: u.unidade,
        setor: u.setor || '',
        conservacao: u.conservacao || '',
        vencido: vencida(u, agora),
        unidades: [],
      };
      grupos.set(n, g);
    }
    return g;
  };
  for (const [k, u] of indice.ativas) {
    if (!noEscopo(u, estado)) continue;
    let situacao = 'pendente';
    if (estado.descartadas[k]) situacao = 'descartada';
    else if (estado.bipes[k]) situacao = vencida(u, agora) ? 'vencida' : 'encontrada';
    grupo(u).unidades.push({ seq: Number(u.seq), chave: k, situacao });
  }
  for (const [k, u] of indice.baixadas) {
    if (!noEscopo(u, estado) || !(estado.baixadasBipadas[k] || estado.reativar[k])) continue;
    grupo(u).unidades.push({ seq: Number(u.seq), chave: k, situacao: estado.reativar[k] ? 'reativada' : 'baixada', status: u.status, vencida: vencida(u, agora) });
  }
  const lista = [...grupos.values()];
  for (const g of lista) {
    g.unidades.sort((a, b) => a.seq - b.seq);
    g.encontradas = g.unidades.filter((x) => x.situacao === 'encontrada' || x.situacao === 'vencida' || x.situacao === 'reativada').length;
    g.pendentes = g.unidades.filter((x) => x.situacao === 'pendente').length;
  }
  return lista.sort((a, b) => nomeProduto(a.produtoNome).localeCompare(nomeProduto(b.produtoNome), 'pt-BR') || a.numero - b.numero);
}

/** [1,2,5,6,7,8,10] => "1, 2, 5–8, 10" */
export function faixas(seqs) {
  const s = [...new Set(seqs.map(Number))].sort((a, b) => a - b);
  const partes = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j += 1;
    if (j - i >= 2) partes.push(`${s[i]}–${s[j]}`);
    else for (let x = i; x <= j; x += 1) partes.push(String(s[x]));
    i = j + 1;
  }
  return partes.join(', ');
}

const itemResumo = (g, seqs) => ({
  numero: g.numero,
  numeroTexto: g.numeroTexto,
  produtoId: g.produtoId,
  produtoNome: g.produtoNome,
  seqs,
  total: g.total,
  texto: `UN ${faixas(seqs)}${g.total ? ` (${seqs.length} de ${g.total})` : ''}`,
});

/** Resumo mostrado ANTES de gravar e os dados enviados para a nuvem. */
export function montarResumo(estado, indice, agora = new Date()) {
  const grupos = gruposDoEscopo(estado, indice, agora);
  const aBaixar = [];
  const vencidas = [];
  const reativadas = [];
  const descartadas = [];
  const lidas = [];
  const reativar = [];
  let encontradas = 0;
  let ativasNoEscopo = 0;
  for (const g of grupos) {
    const por = (s) => g.unidades.filter((x) => x.situacao === s).map((x) => x.seq);
    const pend = por('pendente');
    const enc = por('encontrada');
    const venc = por('vencida');
    const reat = por('reativada');
    const desc = por('descartada');
    ativasNoEscopo += pend.length + enc.length + venc.length;
    encontradas += enc.length + venc.length + reat.length;
    if (pend.length) aBaixar.push(itemResumo(g, pend));
    if (venc.length) vencidas.push(itemResumo(g, venc));
    if (reat.length) reativadas.push(itemResumo(g, reat));
    if (desc.length) descartadas.push(itemResumo(g, desc));
    for (const seq of [...enc, ...venc, ...reat]) lidas.push({ numero: g.numero, seq });
    for (const seq of reat) reativar.push({ numero: g.numero, seq });
  }
  const totalABaixar = aBaixar.reduce((s, i) => s + i.seqs.length, 0);
  const contar = (lista) => lista.reduce((s, i) => s + i.seqs.length, 0);
  const alerta = totalABaixar >= 5 && totalABaixar > ativasNoEscopo * FRACAO_ALERTA
    ? `Atenção: ${plural(totalABaixar, 'unidade', 'unidades')} de ${ativasNoEscopo} não ${totalABaixar === 1 ? 'foi encontrada' : 'foram encontradas'}. Confira se bipou tudo antes de confirmar.`
    : null;
  return {
    encontradas,
    ativasNoEscopo,
    totalABaixar,
    aBaixar,
    vencidas,
    totalVencidas: contar(vencidas),
    reativadas,
    totalReativadas: contar(reativadas),
    descartadas,
    totalDescartadas: contar(descartadas),
    lidas,
    reativar,
    alerta,
  };
}

/** Parâmetros de finalizar_contagem (a nuvem recalcula tudo e confere o acesso). */
export function dadosFinalizar(estado, resumo) {
  return {
    p_contagem: estado.id,
    p_unidade: estado.unidadeId,
    p_produto_id: estado.escopo === 'produto' ? estado.produtoId : null,
    p_produto_nome: estado.escopo === 'produto' ? estado.produtoNome : null,
    p_inicio: estado.inicio,
    p_lidas: resumo.lidas,
    p_reativar: resumo.reativar,
  };
}

/** Agrupa por nº uma lista de unidades [{ numero, seq, total, produtoNome }] (resposta da nuvem). */
export function agruparUnidades(lista = []) {
  const grupos = new Map();
  for (const u of Array.isArray(lista) ? lista : []) {
    const n = Number(u?.numero);
    const seq = Number(u?.seq);
    if (!Number.isSafeInteger(n) || !Number.isInteger(seq)) continue;
    const g = grupos.get(n) || { numero: n, numeroTexto: formatarNumero(n), produtoId: u.produtoId || null, produtoNome: u.produtoNome || '', total: Number(u.total) || 0, seqs: [] };
    g.seqs.push(seq);
    grupos.set(n, g);
  }
  return [...grupos.values()]
    .sort((a, b) => nomeProduto(a.produtoNome).localeCompare(nomeProduto(b.produtoNome), 'pt-BR') || a.numero - b.numero)
    .map((g) => itemResumo(g, [...new Set(g.seqs)].sort((a, b) => a - b)));
}

/**
 * Resultado devolvido por finalizar_contagem (com o resumo local como reserva):
 * confirmadas = bipadas que ficaram ativas; utilizadas = baixadas agora;
 * ignoradas = bipadas que já não estavam ativas na nuvem ao gravar.
 */
export function lerResultado(resposta, local) {
  const r = resposta && typeof resposta === 'object' ? (resposta.resumo && typeof resposta.resumo === 'object' ? resposta.resumo : resposta) : {};
  const num = (...chaves) => {
    for (const c of chaves) {
      const v = r[c];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (Array.isArray(v)) return v.length;
    }
    return null;
  };
  const lista = Array.isArray(r.unidadesUtilizadas) ? agruparUnidades(r.unidadesUtilizadas) : null;
  return {
    encontradas: num('confirmadas', 'encontradas', 'lidas') ?? local.encontradas,
    baixadas: num('utilizadas', 'baixadas') ?? local.totalABaixar,
    reativadas: num('reativadas') ?? local.totalReativadas,
    ignoradas: num('ignoradas') ?? 0,
    baixadasLista: lista ?? local.aBaixar ?? [],
  };
}

/**
 * Produtos com unidades descartadas nesta contagem (precisam de etiqueta nova),
 * inclusive descarte ainda sem confirmação da nuvem: o produto vencido sai de
 * qualquer jeito.
 */
export function produtosParaReimprimir(estado, indice) {
  const porChave = new Map();
  const chaves = new Set([...Object.keys(estado.descartadas), ...Object.keys(estado.descartando || {})]);
  for (const k of chaves) {
    const u = indice.ativas.get(k);
    if (!u) continue;
    const c = u.produtoId || `nome:${nomeProduto(u.produtoNome)}`;
    const p = porChave.get(c) || { produtoId: u.produtoId || null, produtoNome: u.produtoNome || '', unidades: 0 };
    p.unidades += 1;
    porChave.set(c, p);
  }
  return [...porChave.values()];
}

// ---------- Gravação sem resposta ----------

/**
 * Confere a resposta de finalizar_contagem com o que foi enviado. A nuvem
 * devolve o resumo já gravado quando o mesmo id chega de novo; se o número de
 * lidas for outro, vale o que está na nuvem e a pessoa precisa saber.
 * @returns {{ nuvem: number, enviadas: number } | null}
 */
export function conferirResposta(resposta, dados) {
  const r = resposta && typeof resposta === 'object' ? (resposta.resumo && typeof resposta.resumo === 'object' ? resposta.resumo : resposta) : null;
  const nuvem = Number(r?.lidas);
  const enviadas = Array.isArray(dados?.p_lidas) ? dados.p_lidas.length : 0;
  if (!r || typeof r.lidas !== 'number' || !Number.isFinite(nuvem) || nuvem === enviadas) return null;
  return { nuvem, enviadas };
}

/**
 * Resultado de descartar_unidades. Unidade que a nuvem ignorou (já não estava
 * ativa) e que este aparelho já tinha tentado descartar (resposta perdida)
 * conta como descarte confirmado, não como baixa feita em outro aparelho.
 * @returns {{ confirmadas: string[], deOutro: string[] }} chaves "numero-seq"
 */
export function resultadoDescarte(itens, resposta, descartando = {}) {
  const feitas = new Set((Array.isArray(resposta?.unidades) ? resposta.unidades : []).map((u) => chave(u.numero, u.seq)));
  const todas = itens.map((i) => chave(i.numero, i.seq));
  // Resposta sem a lista (versão antiga): só o número de ignoradas.
  if (!Array.isArray(resposta?.unidades)) {
    const ignoradas = Math.min(Math.max(0, Number(resposta?.ignoradas) || 0), todas.length);
    const tentadas = todas.filter((k) => descartando[k]);
    const deOutro = ignoradas > tentadas.length ? todas.filter((k) => !descartando[k]).slice(0, ignoradas - tentadas.length) : [];
    return { confirmadas: todas.filter((k) => !deOutro.includes(k)), deOutro };
  }
  const deOutro = todas.filter((k) => !feitas.has(k) && !descartando[k]);
  return { confirmadas: todas.filter((k) => !deOutro.includes(k)), deOutro };
}

/** Texto do "Cancelar" da contagem em andamento (os descartes já registrados ficam). */
export function textoCancelar(estado) {
  const bipadas = Object.keys(estado.bipes || {}).length + Object.keys(estado.reativar || {}).length;
  const descartes = Object.keys(estado.descartadas || {}).length;
  const partes = [bipadas === 1 ? 'A unidade bipada será esquecida e nada será baixado.'
    : bipadas ? `As ${bipadas} unidades bipadas serão esquecidas e nada será baixado.` : 'Nada será baixado.'];
  if (descartes) {
    partes.push(`${descartes === 1 ? 'O descarte de vencida já registrado continua' : `Os ${descartes} descartes de vencidas já registrados continuam`} (não ${descartes === 1 ? 'é desfeito' : 'são desfeitos'}).`);
  }
  return partes.join(' ');
}
