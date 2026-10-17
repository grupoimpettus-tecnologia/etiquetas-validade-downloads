// Aceite dos termos pelo site: a ÚNICA chamada de escrita da página termos.html.
//
// Uma função da nuvem (security definer) que confere o perfil ativo e a versão
// publicada dos termos e grava o aceite da própria pessoa, com a data do
// servidor (repetir não grava de novo). Usa a mesma sessão do Painel de Gestão.
import { ErroPainel } from './sessao.js';

/** Funções da nuvem que a página de termos pode chamar (nenhuma outra). */
export const RPCS_ACEITE = Object.freeze(['aceitar_termos']);

/** Como o aceite feito pelo site fica registrado (o app do computador manda o nome do computador). */
export const DISPOSITIVO_SITE = 'Site (navegador)';

const ESPERA_MS = 25_000;

export class ApiAceite {
  /**
   * @param {import('./sessao.js').SessaoPainel} sessao
   * @param {{ esperaMs?: number }} [opcoes] tempo máximo da chamada
   */
  constructor(sessao, { esperaMs = ESPERA_MS } = {}) {
    this.sessao = sessao;
    this.esperaMs = esperaMs;
  }

  async #rpc(nome, corpo) {
    if (!RPCS_ACEITE.includes(nome)) throw new ErroPainel(`Chamada não permitida: ${nome}.`);
    const token = await this.sessao.tokenValido();
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let espera = null;
    let semResposta = false;
    let r;
    let json;
    try {
      const pedido = (async () => {
        const resp = await this.sessao.fetch(`${this.sessao.url}/rest/v1/rpc/${nome}`, {
          method: 'POST',
          headers: { apikey: this.sessao.chave, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
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
      // Repetir é seguro: a nuvem não grava o mesmo aceite duas vezes.
      throw new ErroPainel(ctrl?.signal.aborted ? 'A nuvem não respondeu a tempo. Confira o sinal e tente de novo.' : 'Sem conexão com a internet.');
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
      // Ex.: versão dos termos desconhecida (página antiga em cache): a mensagem da nuvem manda recarregar.
      if (json?.code === 'P0001' && json.message) throw new ErroPainel(String(json.message), r.status);
      if (r.status === 404 || json?.code === 'PGRST202') throw new ErroPainel('O aceite pelo site ainda não está disponível na nuvem. Fale com o administrador.', r.status);
      throw new ErroPainel('Não foi possível registrar o aceite agora. Tente de novo.', r.status);
    }
    return json;
  }

  /**
   * Registra o aceite da versão dos termos mostrada na página.
   * @param {string} versao
   * @returns {Promise<{ versao: string, senhaPendente: boolean }>}
   */
  aceitar(versao) {
    return this.#rpc('aceitar_termos', { p_versao: versao, p_dispositivo: DISPOSITIVO_SITE });
  }
}
