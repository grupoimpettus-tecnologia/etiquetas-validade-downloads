// Contagem por QR code: as ÚNICAS chamadas de escrita do site.
//
// Cada uma é uma função da nuvem (security definer) que confere o perfil e o
// acesso da pessoa à loja; o site nunca altera tabelas direto. contagem_escopo
// só lê (STABLE). Usa a mesma sessão do Painel de Gestão.
import { ErroPainel } from './sessao.js';

/** Funções da nuvem que a Contagem pode chamar (nenhuma outra). */
export const RPCS_CONTAGEM = Object.freeze(['contagem_escopo', 'finalizar_contagem', 'descartar_unidades', 'desfazer_contagem']);

const ESPERA_MS = 25_000;

/** Erro sem resposta certa da nuvem: a gravação pode ter acontecido ou não. */
function incerto(e) {
  e.incerto = true;
  return e;
}

export class ApiContagem {
  /**
   * @param {import('./sessao.js').SessaoPainel} sessao
   * @param {string} versaoTermos
   * @param {{ esperaMs?: number }} [opcoes] tempo máximo de cada chamada
   */
  constructor(sessao, versaoTermos, { esperaMs = ESPERA_MS } = {}) {
    this.sessao = sessao;
    this.versaoTermos = versaoTermos;
    this.esperaMs = esperaMs;
  }

  async #rpc(nome, corpo) {
    if (!RPCS_CONTAGEM.includes(nome)) throw new ErroPainel(`Chamada não permitida: ${nome}.`);
    const token = await this.sessao.tokenValido();
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let espera = null;
    let semResposta = false;
    let r;
    let json;
    try {
      // O prazo vale para a resposta inteira (cabeçalho e corpo).
      const pedido = (async () => {
        const resp = await this.sessao.fetch(`${this.sessao.url}/rest/v1/rpc/${nome}`, {
          method: 'POST',
          headers: { apikey: this.sessao.chave, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...corpo, p_versao_termos: this.versaoTermos }),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        });
        return [resp, await resp.json().catch(() => null)];
      })();
      const limite = new Promise((_, falhar) => {
        espera = setTimeout(() => {
          semResposta = true;
          ctrl?.abort();
          falhar(new Error('tempo'));
        }, this.esperaMs);
      });
      [r, json] = await Promise.race([pedido, limite]);
    } catch {
      semResposta = true;
    } finally {
      clearTimeout(espera);
    }
    if (!r || semResposta) {
      // Sem resposta: o pedido pode ter chegado à nuvem (e gravado) ou não.
      throw incerto(new ErroPainel(ctrl?.signal.aborted
        ? 'A nuvem não respondeu a tempo. Tente de novo: a contagem continua salva neste aparelho.'
        : 'Sem conexão com a internet. A contagem continua salva neste aparelho; tente de novo quando tiver sinal.'));
    }
    if (r.status === 401) {
      this.sessao.esquecer();
      throw new ErroPainel('Sua sessão expirou. Entre de novo.', 401);
    }
    if (!r.ok) {
      if (json?.code === '42501') {
        this.sessao.esquecer();
        throw new ErroPainel('Seu acesso está desativado. Fale com o administrador.', 403);
      }
      if (json?.code === 'P0001' && json.message) {
        const e = new ErroPainel(String(json.message), r.status);
        // A nuvem garante que a contagem não ficou gravada (ex.: limite, início inválido).
        if (json.hint === 'contagem-nao-gravada') e.naoGravada = true;
        throw e;
      }
      if (r.status === 404 || json?.code === 'PGRST202') throw new ErroPainel('A contagem ainda não está disponível na nuvem. Fale com o administrador.', r.status);
      const e = new ErroPainel('Não foi possível falar com a nuvem agora. Tente de novo.', r.status);
      // Erro do banco (com código) desfaz a transação inteira; erro do caminho
      // (502/504 sem código) pode ter chegado depois de gravar.
      throw r.status >= 500 && !json?.code ? incerto(e) : e;
    }
    return json;
  }

  /** Unidades ativas da loja (e baixas recentes) e o horário de início. Só leitura. */
  escopo(unidadeId) {
    return this.#rpc('contagem_escopo', { p_unidade: unidadeId });
  }

  /** Grava a contagem (idempotente pelo id: repetir devolve o mesmo resumo). */
  finalizar(dados) {
    return this.#rpc('finalizar_contagem', {
      p_contagem: dados.p_contagem,
      p_unidade: dados.p_unidade,
      p_produto_id: dados.p_produto_id ?? null,
      p_produto_nome: dados.p_produto_nome ?? null,
      p_inicio: dados.p_inicio,
      p_lidas: dados.p_lidas || [],
      p_reativar: dados.p_reativar || [],
    });
  }

  /** Descarta unidades ativas da loja (vencidas encontradas na contagem). */
  descartar(unidadeId, itens, motivo) {
    return this.#rpc('descartar_unidades', { p_unidade: unidadeId, p_itens: itens, p_motivo: motivo });
  }

  /** Volta para ativas as unidades baixadas por esta contagem. */
  desfazer(contagemId) {
    return this.#rpc('desfazer_contagem', { p_contagem: contagemId });
  }
}
