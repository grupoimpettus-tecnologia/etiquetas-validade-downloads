// Painel de gestão: organiza os dados que vêm da nuvem (somente leitura).
import { SITUACAO } from '../shared/constants.js';
import { lerCodigo } from '../shared/qr-etiqueta.js';
import { classificar, diasDeCalendario } from '../shared/validade.js';

/** Ordem de prioridade das situações na lista. */
export const ORDEM_SITUACAO = [SITUACAO.VENCIDO, SITUACAO.HOJE, SITUACAO.PROXIMO, SITUACAO.OK];

/** Loja sem nenhuma etiqueta nova há mais que isso merece atenção. */
export const DIAS_SEM_MOVIMENTO = 2;

const vazio = () => ({ vencido: 0, hoje: 0, proximo: 0, ok: 0, total: 0 });

/**
 * Classifica as etiquetas ativas e resume por loja.
 * @param {{ unidades: object[], etiquetas: object[], aprovacoesPendentes?: number }} dados resposta de painel_gestao
 * @param {{ agora?: Date, diasAviso?: number }} [op]
 */
export function montarPainel(dados, { agora = new Date(), diasAviso = 2 } = {}) {
  const lojas = (dados?.unidades || []).map((u) => ({ ...u, contagem: vazio() }));
  const porId = new Map(lojas.map((l) => [l.id, l]));
  const etiquetas = [];
  const totais = vazio();

  for (const e of dados?.etiquetas || []) {
    const loja = porId.get(e.unidadeId);
    if (!loja) continue;
    const situacao = classificar({ status: 'ativa', venceEm: e.venceEm }, agora, diasAviso);
    etiquetas.push({ ...e, situacao, loja });
    loja.contagem[situacao] += 1;
    loja.contagem.total += 1;
    totais[situacao] += 1;
    totais.total += 1;
  }

  for (const l of lojas) {
    l.diasSemEtiqueta = l.ultimaEtiqueta ? diasDeCalendario(new Date(l.ultimaEtiqueta), agora) : null;
    l.nivel = l.contagem.vencido ? 'critico' : l.contagem.hoje ? 'aviso' : l.contagem.proximo ? 'atencao' : 'ok';
  }

  etiquetas.sort((a, b) => ORDEM_SITUACAO.indexOf(a.situacao) - ORDEM_SITUACAO.indexOf(b.situacao)
    || new Date(a.venceEm) - new Date(b.venceEm));

  return { lojas, etiquetas, totais, acoes: acoesPendentes(lojas, totais, dados?.aprovacoesPendentes || 0) };
}

const n = (q, um, varios) => `${q} ${q === 1 ? um : varios}`;

/** O que ainda precisa ser feito, do mais urgente para o menos. */
export function acoesPendentes(lojas, totais, aprovacoes = 0) {
  const acoes = [];
  const comVencidas = lojas.filter((l) => l.contagem.vencido);
  if (totais.vencido) {
    acoes.push({
      nivel: 'critico',
      titulo: `${n(totais.vencido, 'etiqueta vencida', 'etiquetas vencidas')} sem baixa`,
      detalhe: `Retirar o produto e dar baixa no app da loja ou pela Contagem: ${comVencidas.map((l) => `${l.nome} (${l.contagem.vencido})`).join(', ')}.`,
      filtro: { situacao: SITUACAO.VENCIDO },
    });
  }
  if (totais.hoje) {
    const lojasHoje = lojas.filter((l) => l.contagem.hoje);
    acoes.push({
      nivel: 'aviso',
      titulo: `${n(totais.hoje, 'etiqueta vence', 'etiquetas vencem')} hoje`,
      detalhe: `Usar ou descartar até o horário indicado: ${lojasHoje.map((l) => `${l.nome} (${l.contagem.hoje})`).join(', ')}.`,
      filtro: { situacao: SITUACAO.HOJE },
    });
  }
  if (aprovacoes) {
    acoes.push({
      nivel: 'atencao',
      titulo: `${n(aprovacoes, 'pedido de cadastro aguardando', 'pedidos de cadastro aguardando')} aprovação`,
      detalhe: 'Aprovar ou recusar no app do computador (Configurações → Aprovações).',
      filtro: null,
    });
  }
  const paradas = lojas.filter((l) => l.diasSemEtiqueta !== null && l.diasSemEtiqueta > DIAS_SEM_MOVIMENTO);
  if (paradas.length) {
    acoes.push({
      nivel: 'atencao',
      titulo: `${n(paradas.length, 'loja sem etiquetas novas', 'lojas sem etiquetas novas')} há mais de ${DIAS_SEM_MOVIMENTO} dias`,
      detalhe: `${paradas.map((l) => `${l.nome} (${l.diasSemEtiqueta} dias)`).join(', ')}. Confirme se a loja está etiquetando.`,
      filtro: null,
    });
  }
  const nunca = lojas.filter((l) => !l.ultimaEtiqueta);
  if (nunca.length) {
    acoes.push({
      nivel: 'info',
      titulo: `${n(nunca.length, 'loja ainda não emitiu', 'lojas ainda não emitiram')} etiquetas`,
      detalhe: nunca.map((l) => l.nome).join(', ') + '.',
      filtro: null,
    });
  }
  return acoes;
}

/** Aplica os filtros da tela (marca, loja, situação, busca). A busca aceita o QR da etiqueta (E1070-3, 001070). */
export function filtrar(etiquetas, { marcaId = '', unidadeId = '', situacao = '', busca = '' } = {}) {
  const termo = normalizar(busca);
  const codigo = lerCodigo(busca);
  return etiquetas.filter((e) => (!marcaId || e.loja.marcaId === marcaId)
    && (!unidadeId || e.unidadeId === unidadeId)
    && (!situacao || e.situacao === situacao)
    && (!termo || Number(e.numero) === codigo?.numero || normalizar(`${e.produto} ${e.numero} ${e.responsavel} ${e.setor} ${e.lote} ${e.loja.nome}`).includes(termo)));
}

export function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
