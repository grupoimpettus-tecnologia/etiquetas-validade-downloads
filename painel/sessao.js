// Painel de gestão: login na nuvem e leitura dos dados.
//
// Somente consulta: além do login, o painel faz UMA chamada à nuvem, a função
// painel_gestao, que o banco executa em modo somente leitura (STABLE). Não há
// aqui nenhum caminho para imprimir, dar baixa ou alterar cadastros.

const CHAVE = 'painel-sessao';

export class ErroPainel extends Error {
  constructor(mensagem, status = 0) {
    super(mensagem);
    this.status = status;
  }
}

function guardar(armazem, valor) {
  try {
    if (valor) armazem.setItem(CHAVE, JSON.stringify(valor));
    else armazem.removeItem(CHAVE);
  } catch {
    // Armazenamento bloqueado (aba anônima etc.): a sessão vale só enquanto a página estiver aberta.
  }
}

function ler(armazem) {
  try {
    const v = JSON.parse(armazem.getItem(CHAVE) || 'null');
    return v && typeof v.refresh === 'string' ? v : null;
  } catch {
    return null;
  }
}

export class SessaoPainel {
  /**
   * @param {{ url: string, chave: string }} nuvem
   * @param {{ fetch?: typeof fetch, local?: Storage, sessao?: Storage }} [dep]
   */
  constructor(nuvem, dep = {}) {
    this.url = nuvem.url.replace(/\/$/, '');
    this.chave = nuvem.chave;
    this.fetch = dep.fetch || globalThis.fetch.bind(globalThis);
    this.local = dep.local ?? globalThis.localStorage;
    this.sessao = dep.sessao ?? globalThis.sessionStorage;
    this.atual = ler(this.sessao) || ler(this.local);
    this.manter = Boolean(this.atual && ler(this.local));
  }

  get logado() {
    return Boolean(this.atual);
  }

  async #auth(caminho, corpo, token) {
    let r;
    try {
      r = await this.fetch(`${this.url}/auth/v1/${caminho}`, {
        method: 'POST',
        headers: {
          apikey: this.chave,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(corpo || {}),
      });
    } catch {
      throw new ErroPainel('Sem conexão com a internet.');
    }
    const json = await r.json().catch(() => ({}));
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
    guardar(this.manter ? this.local : this.sessao, this.atual);
    guardar(this.manter ? this.sessao : this.local, null);
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
      throw new ErroPainel('Não foi possível carregar o painel agora.', r.status);
    }
    return json;
  }

  #limpar() {
    this.atual = null;
    guardar(this.local, null);
    guardar(this.sessao, null);
  }

  async sair() {
    const token = this.atual?.token;
    this.#limpar();
    if (token) await this.#auth('logout?scope=local', {}, token).catch(() => {});
  }
}
