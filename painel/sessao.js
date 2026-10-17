// Painel de gestão: login na nuvem e leitura dos dados.
//
// O painel só consulta: além do login, faz UMA chamada à nuvem, a função
// painel_gestao, que o banco executa em modo somente leitura (STABLE). Não há
// aqui nenhum caminho para imprimir, dar baixa ou alterar cadastros. A tela de
// Contagem usa a mesma sessão (tokenValido) e grava só pelas funções da nuvem
// listadas em contagem-api.js. O Painel do Proprietário (proprietario.html)
// usa esta classe com a sessão guardada numa chave só dele (o Painel de Gestão
// fica no mesmo endereço e Sair num não derruba o outro), com as chamadas de
// proprietario-api.js.

const CHAVE = 'painel-sessao';

/** Tempo máximo de espera do login e da renovação do acesso (sinal fraco não trava a tela). */
export const ESPERA_AUTH_MS = 25_000;

export class ErroPainel extends Error {
  constructor(mensagem, status = 0) {
    super(mensagem);
    this.status = status;
  }
}

function guardar(armazem, valor, chave = CHAVE) {
  try {
    if (valor) armazem.setItem(chave, JSON.stringify(valor));
    else armazem.removeItem(chave);
  } catch {
    // Armazenamento bloqueado (aba anônima etc.): a sessão vale só enquanto a página estiver aberta.
  }
}

function ler(armazem, chave = CHAVE) {
  try {
    const v = JSON.parse(armazem.getItem(chave) || 'null');
    return v && typeof v.refresh === 'string' ? v : null;
  } catch {
    return null;
  }
}

export class SessaoPainel {
  /**
   * @param {{ url: string, chave: string }} nuvem
   * @param {{ fetch?: typeof fetch, local?: Storage, sessao?: Storage, esperaMs?: number, nomeGuardado?: string }} [dep]
   *        nomeGuardado: chave da sessão no armazenamento (padrão: a do Painel de Gestão)
   */
  constructor(nuvem, dep = {}) {
    this.url = nuvem.url.replace(/\/$/, '');
    this.chave = nuvem.chave;
    this.fetch = dep.fetch || globalThis.fetch.bind(globalThis);
    this.esperaMs = dep.esperaMs ?? ESPERA_AUTH_MS;
    this.local = dep.local ?? globalThis.localStorage;
    this.sessao = dep.sessao ?? globalThis.sessionStorage;
    this.nomeGuardado = dep.nomeGuardado || CHAVE;
    this.atual = ler(this.sessao, this.nomeGuardado) || ler(this.local, this.nomeGuardado);
    this.manter = Boolean(this.atual && ler(this.local, this.nomeGuardado));
  }

  get logado() {
    return Boolean(this.atual);
  }

  async #auth(caminho, corpo, token) {
    // Com tempo limite: sem ele, a renovação do acesso num sinal fraco deixa a
    // tela presa (ex.: "Gravando…" da Contagem) até o navegador desistir.
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let espera = null;
    let falhou = false;
    let r;
    let json;
    try {
      const pedido = (async () => {
        const resp = await this.fetch(`${this.url}/auth/v1/${caminho}`, {
          method: 'POST',
          headers: {
            apikey: this.chave,
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(corpo || {}),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        });
        return [resp, await resp.json().catch(() => ({}))];
      })();
      const limite = new Promise((_, falhar) => {
        espera = setTimeout(() => {
          falhou = true;
          ctrl?.abort();
          falhar(new Error('tempo'));
        }, this.esperaMs);
      });
      [r, json] = await Promise.race([pedido, limite]);
    } catch {
      falhou = true;
    } finally {
      clearTimeout(espera);
    }
    if (!r || falhou) {
      throw new ErroPainel(ctrl?.signal.aborted ? 'A nuvem não respondeu a tempo. Confira o sinal e tente de novo.' : 'Sem conexão com a internet.');
    }
    if (!r.ok) {
      if (r.status === 400 || r.status === 401) throw new ErroPainel('E-mail ou senha incorretos.', r.status);
      if (r.status === 429) throw new ErroPainel('Muitas tentativas. Aguarde alguns minutos.', r.status);
      throw new ErroPainel('Não foi possível entrar agora. Tente de novo.', r.status);
    }
    return json;
  }

  #salvar(json) {
    this.atual = {
      token: json.access_token,
      refresh: json.refresh_token,
      expira: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    };
    guardar(this.manter ? this.local : this.sessao, this.atual, this.nomeGuardado);
    guardar(this.manter ? this.sessao : this.local, null, this.nomeGuardado);
  }

  async entrar(email, senha, manter = true) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !senha) throw new ErroPainel('Informe o e-mail e a senha.');
    this.manter = Boolean(manter);
    this.#salvar(await this.#auth('token?grant_type=password', { email: e, password: String(senha) }));
  }

  async #token() {
    if (!this.atual) throw new ErroPainel('Entre com o seu acesso.', 401);
    if (this.atual.expira - Date.now() > 60_000) return this.atual.token;
    // Sessão guardada no aparelho: outra aba pode ter renovado (a nuvem troca o
    // código de renovação a cada vez; reusar o antigo derruba a sessão) ou saído.
    if (this.manter) {
      const guardada = ler(this.local, this.nomeGuardado);
      if (!guardada) {
        this.#limpar();
        throw new ErroPainel('Sua sessão terminou. Entre de novo.', 401);
      }
      if (guardada.refresh !== this.atual.refresh) {
        this.atual = guardada;
        if (this.atual.expira - Date.now() > 60_000) return this.atual.token;
      }
    }
    try {
      this.#salvar(await this.#auth('token?grant_type=refresh_token', { refresh_token: this.atual.refresh }));
    } catch (e) {
      if (e.status) this.#limpar();
      throw e.status ? new ErroPainel('Sua sessão expirou. Entre de novo.', 401) : e;
    }
    return this.atual.token;
  }

  /** Lê o painel (função somente leitura da nuvem). */
  async painel(versaoTermos) {
    const token = await this.#token();
    let r;
    try {
      r = await this.fetch(`${this.url}/rest/v1/rpc/painel_gestao`, {
        method: 'POST',
        headers: { apikey: this.chave, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_versao_termos: versaoTermos }),
      });
    } catch {
      throw new ErroPainel('Sem conexão com a internet.');
    }
    if (r.status === 401) {
      this.#limpar();
      throw new ErroPainel('Sua sessão expirou. Entre de novo.', 401);
    }
    const json = await r.json().catch(() => null);
    if (!r.ok) {
      if (json?.code === '42501') {
        this.#limpar();
        throw new ErroPainel('Seu acesso está desativado. Fale com o administrador.', 403);
      }
      // Recusa de regra (P0001), inclusive a da assinatura ('licenca-bloqueada'):
      // mostra a mensagem da nuvem e continua conectado.
      if (json?.code === 'P0001' && json.message) {
        const e = new ErroPainel(String(json.message), r.status);
        e.dica = typeof json.hint === 'string' ? json.hint : '';
        throw e;
      }
      throw new ErroPainel('Não foi possível carregar o painel agora.', r.status);
    }
    return json;
  }

  /** Token de acesso válido (renova se preciso), para as chamadas da Contagem. */
  async tokenValido() {
    return this.#token();
  }

  /** Esquece a sessão neste aparelho (a nuvem recusou o token). */
  esquecer() {
    this.#limpar();
  }

  #limpar() {
    this.atual = null;
    guardar(this.local, null, this.nomeGuardado);
    guardar(this.sessao, null, this.nomeGuardado);
  }

  async sair() {
    const token = this.atual?.token;
    this.#limpar();
    if (token) await this.#auth('logout?scope=local', {}, token).catch(() => {});
  }
}
