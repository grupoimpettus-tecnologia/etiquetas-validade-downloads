// Painel do Proprietário: as ÚNICAS chamadas ao serviço de e-mail do Prazzo
// (deploy/vps/email), que fica atrás da portaria no MESMO endereço deste
// painel: https://prazzo…/api/email/*.
//
// Por que um serviço à parte (e não a nuvem): o app roda nos PCs das lojas e
// não pode levar a senha do servidor de e-mail, e as funções da nuvem não
// falam SMTP. O serviço guarda a senha cifrada e manda o e-mail na hora.
//
// Regras desta página:
// * lista fechada das rotas (nenhuma outra sai daqui);
// * mesma origem: o caminho é relativo (/api/email), então a CSP continua
//   `connect-src 'self'` e o token nunca vai para outro endereço;
// * Authorization: Bearer com o token da sessão do painel (renovado por
//   sessao.js); quem é e se é o Proprietário quem decide é o serviço, que
//   pergunta à nuvem. Nada da chave pública da nuvem vai para o serviço;
// * tempo limite em cada chamada; sem resposta certa num envio = "incerto"
//   (o e-mail pode ter saído ou não);
// * nenhum erro daqui desconecta o painel sozinho (o `status` do erro fica
//   vazio; o código HTTP vai em `http`): o serviço é um auxiliar, e uma
//   recusa dele (ou uma configuração errada no servidor) não pode derrubar a
//   sessão. Quando ele recusa a sessão, a tela confere com a nuvem
//   (eh_dono), que é quem manda.
import { ErroPainel } from './sessao.js';

/** Rotas do serviço de e-mail que esta página pode chamar (nenhuma outra). */
export const ROTAS_EMAIL = Object.freeze(['GET estado', 'GET config', 'PUT config', 'POST teste', 'POST acesso']);

/** Tipos do e-mail de acesso (o modelo muda o título e o assunto). */
export const TIPOS_ACESSO = Object.freeze(['boas-vindas', 'nova-senha']);

/** Caminho do serviço, relativo à página: sempre a mesma origem do painel. */
export const BASE_EMAIL = '/api/email';

/** Leitura (estado, configuração): resposta rápida. */
const ESPERA_MS = 15_000;
/** Envio na hora (teste, acesso): o serviço fala com o servidor de e-mail antes de responder. */
const ESPERA_ENVIO_MS = 30_000;

/** Campos que a configuração aceita (PUT); a senha só vai quando digitada. */
const CAMPOS_CONFIG = ['servidor', 'porta', 'seguranca', 'usuario', 'remetenteNome', 'remetenteEmail', 'responderPara', 'ligado'];

/** Erro sem resposta certa: num envio, o e-mail pode ter saído ou não. */
function incerto(e) {
  e.incerto = true;
  return e;
}

/** Mensagem do serviço ({ erro }), curta e só texto; '' se não veio. */
function mensagemDoServico(json) {
  const m = typeof json?.erro === 'string' ? json.erro.trim() : '';
  return m.slice(0, 400);
}

export class ApiEmail {
  /**
   * @param {import('./sessao.js').SessaoPainel} sessao a sessão do painel (token e fetch)
   * @param {{ base?: string, esperaMs?: number, esperaEnvioMs?: number }} [opcoes]
   *        base: só '/api/email' (a página) ou, nos testes, 'http(s)://host/api/email'
   */
  constructor(sessao, { base = BASE_EMAIL, esperaMs = ESPERA_MS, esperaEnvioMs = ESPERA_ENVIO_MS } = {}) {
    // O token só vai para o caminho do serviço (nunca para outro lugar do site nem de fora).
    if (!/^(https?:\/\/[^/?#\s]+)?\/api\/email$/.test(base)) throw new Error(`Endereço do serviço de e-mail inválido: ${base}`);
    this.sessao = sessao;
    this.base = base;
    this.esperaMs = esperaMs;
    this.esperaEnvioMs = esperaEnvioMs;
  }

  /** Uma chamada da lista, com tempo limite: o JSON da resposta, ou ErroPainel com a explicação. */
  async #pedir(metodo, rota, corpo, esperaMs = this.esperaMs) {
    if (!ROTAS_EMAIL.includes(`${metodo} ${rota}`)) throw new ErroPainel(`Chamada não permitida: ${metodo} ${rota}.`);
    const token = await this.sessao.tokenValido();
    const comCorpo = metodo === 'POST' || metodo === 'PUT';
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let espera = null;
    let r;
    let json;
    try {
      const pedido = (async () => {
        const resp = await this.sessao.fetch(`${this.base}/${rota}`, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(comCorpo ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(comCorpo ? { body: JSON.stringify(corpo ?? {}) } : {}),
          // Nada de cache, cookie nem redirecionamento (um redirecionamento levaria o token junto).
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          ...(ctrl ? { signal: ctrl.signal } : {}),
        });
        return [resp, await resp.json().catch(() => null)];
      })();
      const limite = new Promise((_, falhar) => {
        espera = setTimeout(() => {
          ctrl?.abort();
          falhar(new Error('tempo'));
        }, esperaMs);
      });
      [r, json] = await Promise.race([pedido, limite]);
    } catch {
      r = null;
    } finally {
      clearTimeout(espera);
    }
    if (!r) {
      throw incerto(new ErroPainel(ctrl?.signal.aborted
        ? 'O serviço de e-mail não respondeu a tempo.'
        : 'Sem conexão com o serviço de e-mail.'));
    }
    if (r.ok && json && typeof json === 'object' && !Array.isArray(json)) return json;
    throw this.#erro(r.status, r.ok ? null : json, comCorpo && rota !== 'config');
  }

  /** Erro de uma resposta do serviço (ou da portaria na frente dele). */
  #erro(http, json, envio) {
    const msg = mensagemDoServico(json);
    let e;
    if (http >= 200 && http < 300) e = new ErroPainel('Resposta inesperada do serviço de e-mail.');
    else if (http === 401) {
      // Token recusado pelo serviço: a tela confere com a nuvem antes de desconectar.
      e = new ErroPainel(msg || 'O serviço de e-mail não reconheceu a sua sessão. Saia e entre de novo.');
      e.sessao = true;
    } else if (http === 403) {
      e = new ErroPainel(msg || 'O serviço de e-mail recusou este pedido.');
      e.recusado = true;
    } else if (http === 404 && !msg) {
      // A portaria ainda sem o serviço: /api/* cai no site, que não tem a página.
      e = new ErroPainel('O serviço de e-mail ainda não está instalado neste endereço.');
      e.semServico = true;
    } else if (http === 413) e = new ErroPainel(msg || 'Os dados enviados são grandes demais.');
    else if (http === 429) e = new ErroPainel(msg || 'Muitos pedidos ao serviço de e-mail. Aguarde alguns minutos e tente de novo.');
    else if (msg) e = new ErroPainel(msg);
    else if ([502, 503, 504].includes(http)) {
      // A portaria não chegou ao serviço (parado, reiniciando) ou ele caiu no meio: num envio, pode ter saído.
      e = new ErroPainel('O serviço de e-mail não está respondendo agora. Tente de novo em alguns minutos.');
      if (envio && http !== 503) incerto(e);
    } else e = new ErroPainel('Não foi possível falar com o serviço de e-mail agora. Tente de novo.');
    e.http = http;
    return e;
  }

  /**
   * Dá para mandar e-mail agora? (qualquer conta logada)
   * @returns {Promise<{ configurado: boolean, ligado: boolean, pausado: boolean, motivo: string }>}
   */
  async estado() {
    const j = await this.#pedir('GET', 'estado');
    return {
      configurado: j.configurado === true,
      ligado: j.ligado === true,
      pausado: j.pausado === true,
      motivo: typeof j.motivo === 'string' ? j.motivo : '',
    };
  }

  /** Configuração do envio (só o Proprietário), SEM a senha: `senhaGuardada` diz se há uma. */
  config() {
    return this.#pedir('GET', 'config');
  }

  /**
   * Grava a configuração (só o Proprietário). A senha vai só quando digitada
   * (vazia = mantém a guardada); o serviço desliga o envio se a conexão mudar.
   * @returns a configuração gravada (a mesma forma de config())
   */
  salvarConfig(dados) {
    const corpo = Object.fromEntries(CAMPOS_CONFIG.filter((k) => dados?.[k] !== undefined).map((k) => [k, dados[k]]));
    if (typeof dados?.senha === 'string' && dados.senha !== '') corpo.senha = dados.senha;
    return this.#pedir('PUT', 'config', corpo);
  }

  /**
   * Manda um e-mail de teste NA HORA com a configuração salva (só o
   * Proprietário). O serviço devolve junto a configuração depois do teste
   * (`config`: o teste guardado, a pausa tirada); no erro, ela vai em e.config.
   * @returns {Promise<{ ok: true, para: string, config?: object }>}
   */
  async testar(para) {
    const j = await this.#pedir('POST', 'teste', { para: String(para ?? '').trim() }, this.esperaEnvioMs);
    if (j.ok !== true) {
      const e = new ErroPainel(mensagemDoServico(j) || 'O e-mail de teste não foi enviado.');
      e.http = 200;
      if (j.config && typeof j.config === 'object' && !Array.isArray(j.config)) e.config = j.config;
      throw e;
    }
    return j;
  }

  /**
   * Manda os dados de acesso (com a senha provisória) ao usuário, NA HORA.
   * Quem pode é a nuvem que decide (prazzo_destinatario_de_acesso): recusa =
   * erro com a mensagem dela. Envio desligado/parado ou falha do servidor de
   * e-mail = { enviado: false, motivo }.
   * @param {{ usuarioId: string, senha: string, tipo: 'boas-vindas' | 'nova-senha' }} d
   * @returns {Promise<{ enviado: boolean, para: string, motivo: string }>}
   */
  async enviarAcesso(d) {
    if (!TIPOS_ACESSO.includes(d?.tipo)) throw new ErroPainel(`Tipo de e-mail de acesso inválido: ${d?.tipo}.`);
    if (!d.usuarioId || !d.senha) throw new ErroPainel('Faltam o usuário ou a senha provisória para o e-mail de acesso.');
    const j = await this.#pedir('POST', 'acesso', { usuarioId: String(d.usuarioId), senha: String(d.senha), tipo: d.tipo }, this.esperaEnvioMs);
    return {
      enviado: j.enviado === true,
      para: typeof j.para === 'string' ? j.para : '',
      motivo: typeof j.motivo === 'string' ? j.motivo : '',
    };
  }
}
