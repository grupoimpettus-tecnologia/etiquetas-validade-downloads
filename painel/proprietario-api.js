// Painel do Proprietário: as ÚNICAS chamadas à nuvem da página proprietario.html.
//
// Funções da nuvem: lista fechada (eh_dono e as prazzo_*), sempre por POST.
// Quem decide é o servidor (exigir_dono): só o Proprietário, com o perfil
// ativo (sem verificação em duas etapas desde a 20261016000002, decisão do
// dono). Toda gravação leva o operacao_id do formulário: repetir (clique
// duplo, resposta perdida) devolve a mesma resposta, sem gravar de novo.
//
// Do Auth, só a troca da senha da conta (PUT /auth/v1/user, como o updateUser
// do supabase-js); login e saída ficam em sessao.js. O site não carrega o
// supabase-js: as chamadas são feitas aqui, com fetch, como no resto do site.
import { lerJwt } from './proprietario-logica.js';
import { ErroPainel } from './sessao.js';

/** Funções da nuvem que a página do Proprietário pode chamar (nenhuma outra). */
export const RPCS_PROPRIETARIO = Object.freeze([
  'eh_dono',
  'prazzo_listar_clientes',
  'prazzo_historico',
  'prazzo_listar_usuarios',
  'prazzo_criar_cliente',
  'prazzo_registrar_pagamento',
  'prazzo_conceder_dias',
  'prazzo_zerar_dias_extras',
  'prazzo_suspender',
  'prazzo_reativar',
  'prazzo_configurar_licenca',
  'prazzo_descartar_reservas',
  'prazzo_redefinir_acesso_master',
]);

/** Rotas do Auth: só a troca da senha (nenhuma outra; login e saída ficam em sessao.js). */
export const ROTAS_AUTH = Object.freeze(['PUT user']);

const ESPERA_MS = 25_000;

/** Erros do Auth (código do Supabase) na troca da senha (PUT /auth/v1/user). */
const ERROS_AUTH = {
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  weak_password: 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.',
  reauthentication_needed: 'Por segurança, a nuvem pede uma entrada recente: saia, entre de novo e troque a senha logo em seguida.',
  // Fator de verificação em duas etapas que ficou cadastrado na conta (de antes da 20261016000002).
  insufficient_aal: 'Esta conta ainda tem a verificação em duas etapas cadastrada no Supabase: remova o fator em Authentication › Users (esta conta) para trocar a senha por aqui.',
};
/** Respostas do Auth que encerram a sessão (token inválido, sessão encerrada). */
const SESSAO_ENCERRADA = ['bad_jwt', 'session_not_found', 'session_expired', 'no_authorization', 'user_not_found'];

/** Erro sem resposta certa da nuvem: a gravação pode ter acontecido ou não (repetir com o mesmo formulário é seguro). */
function incerto(e) {
  e.incerto = true;
  return e;
}

/** Código de erro do Auth: novo formato ({ code: 'texto' }) ou antigo ({ error_code }). */
function codigoAuth(json) {
  if (typeof json?.error_code === 'string') return json.error_code;
  return typeof json?.code === 'string' ? json.code : '';
}

export class ApiProprietario {
  /**
   * @param {import('./sessao.js').SessaoPainel} sessao
   * @param {{ esperaMs?: number }} [opcoes] tempo máximo de cada chamada
   */
  constructor(sessao, { esperaMs = ESPERA_MS } = {}) {
    this.sessao = sessao;
    this.esperaMs = esperaMs;
  }

  /** Uma chamada com tempo limite: [resposta, json] ou erro "incerto" (sem resposta). */
  async #pedir(caminho, metodo, corpo) {
    const token = await this.sessao.tokenValido();
    const comCorpo = metodo === 'POST' || metodo === 'PUT';
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let espera = null;
    let semResposta = false;
    let r;
    let json;
    try {
      const pedido = (async () => {
        const resp = await this.sessao.fetch(`${this.sessao.url}${caminho}`, {
          method: metodo,
          headers: {
            apikey: this.sessao.chave,
            Authorization: `Bearer ${token}`,
            ...(comCorpo ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(comCorpo ? { body: JSON.stringify(corpo ?? {}) } : {}),
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
      throw incerto(new ErroPainel(ctrl?.signal.aborted
        ? 'A nuvem não respondeu a tempo.'
        : 'Sem conexão com a internet.'));
    }
    return [r, json];
  }

  #expirou() {
    this.sessao.esquecer();
    return new ErroPainel('Sua sessão expirou. Entre de novo.', 401);
  }

  // ---------- Funções da nuvem ----------

  async #rpc(nome, corpo = {}) {
    if (!RPCS_PROPRIETARIO.includes(nome)) throw new ErroPainel(`Chamada não permitida: ${nome}.`);
    const [r, json] = await this.#pedir(`/rest/v1/rpc/${nome}`, 'POST', corpo);
    if (r.status === 401) throw this.#expirou();
    if (!r.ok) {
      if (json?.code === '42501') {
        this.sessao.esquecer();
        throw new ErroPainel('Seu acesso está desativado. Entre de novo ou fale com o suporte do Prazzo.', 403);
      }
      if (json?.code === 'P0001' && json.message) {
        // Recusa de regra (nada foi gravado). Nenhuma delas desconecta (nem a da assinatura).
        const e = new ErroPainel(String(json.message), r.status);
        e.dica = typeof json.hint === 'string' ? json.hint : '';
        e.restrito = /^Acesso restrito/i.test(e.message);
        throw e;
      }
      if (r.status === 404 || json?.code === 'PGRST202') {
        throw new ErroPainel('Esta função do Painel do Proprietário ainda não está na nuvem (falta aplicar a migration).', r.status);
      }
      const e = new ErroPainel('Não foi possível falar com a nuvem agora. Tente de novo.', r.status);
      // Erro do banco (com código) desfaz tudo; erro do caminho (502/504) pode ter chegado depois de gravar.
      throw r.status >= 500 && !json?.code ? incerto(e) : e;
    }
    return json;
  }

  /** A conta conectada é a do Proprietário? (a nuvem responde só sobre a própria conta) */
  async ehDono() {
    return (await this.#rpc('eh_dono')) === true;
  }

  listarClientes() {
    return this.#rpc('prazzo_listar_clientes');
  }

  historico(cliente, limite = 200) {
    return this.#rpc('prazzo_historico', { p_cliente: cliente, p_limite: limite });
  }

  listarUsuarios(cliente) {
    return this.#rpc('prazzo_listar_usuarios', { p_cliente: cliente });
  }

  /** Cliente novo: cliente, licença, 1ª marca, setores padrão e o 1º master (troca a senha no 1º acesso). */
  criarCliente(d) {
    return this.#rpc('prazzo_criar_cliente', {
      p_operacao: d.operacao,
      p_nome: d.nome,
      p_documento: d.documento ?? '',
      p_pago_ate: d.pagoAte,
      p_marca_nome: d.marcaNome,
      p_master_nome: d.masterNome,
      p_master_email: d.masterEmail,
      p_master_senha: d.masterSenha,
      p_marca_cor: d.marcaCor,
      p_contato_nome: d.contatoNome ?? '',
      p_contato_email: d.contatoEmail ?? '',
      p_contato_telefone: d.contatoTelefone ?? '',
      p_valor_mensal: d.valorMensal ?? null,
      p_dias_aviso: d.diasAviso,
      p_dias_tolerancia: d.diasTolerancia,
      p_observacao: d.observacao ?? '',
      p_lojas_contratadas: d.lojasContratadas,
    });
  }

  registrarPagamento(d) {
    return this.#rpc('prazzo_registrar_pagamento', {
      p_operacao: d.operacao,
      p_cliente: d.cliente,
      p_pago_ate: d.pagoAte,
      p_valor: d.valor ?? null,
      p_forma: d.forma,
      p_referencia: d.referencia ?? '',
      p_observacao: d.observacao ?? '',
    });
  }

  /** Dias extras; com previa = true só mostra "o bloqueio passa de … para …" (nada é gravado). */
  concederDias(d) {
    return this.#rpc('prazzo_conceder_dias', {
      p_operacao: d.operacao,
      p_cliente: d.cliente,
      p_dias: d.dias,
      p_observacao: d.observacao ?? '',
      p_previa: Boolean(d.previa),
    });
  }

  zerarDiasExtras(d) {
    return this.#rpc('prazzo_zerar_dias_extras', { p_operacao: d.operacao, p_cliente: d.cliente, p_observacao: d.observacao ?? '' });
  }

  suspender(d) {
    return this.#rpc('prazzo_suspender', {
      p_operacao: d.operacao,
      p_cliente: d.cliente,
      p_confirmacao_nome: d.confirmacaoNome ?? '',
      p_observacao: d.observacao ?? '',
    });
  }

  reativar(d) {
    return this.#rpc('prazzo_reativar', { p_operacao: d.operacao, p_cliente: d.cliente, p_observacao: d.observacao ?? '' });
  }

  /** Configuração; campo null = mantém o atual. Nunca tira o "sem vencimento" do cliente nº 1 (sem p_confirmar). */
  configurar(d) {
    return this.#rpc('prazzo_configurar_licenca', {
      p_operacao: d.operacao,
      p_cliente: d.cliente,
      p_dias_aviso: d.diasAviso ?? null,
      p_dias_tolerancia: d.diasTolerancia ?? null,
      p_valor_mensal: d.valorMensal ?? null,
      p_sem_vencimento: d.semVencimento ?? null,
      p_observacao: d.observacao ?? '',
      p_lojas_contratadas: d.lojasContratadas ?? null,
    });
  }

  descartarReservas(d) {
    return this.#rpc('prazzo_descartar_reservas', {
      p_operacao: d.operacao,
      p_cliente: d.cliente,
      p_emitidas_antes_de: d.emitidasAntesDe ?? null,
      p_observacao: d.observacao ?? '',
    });
  }

  redefinirAcessoMaster(d) {
    return this.#rpc('prazzo_redefinir_acesso_master', {
      p_operacao: d.operacao,
      p_cliente: d.cliente,
      p_usuario: d.usuario,
      p_senha_provisoria: d.senha,
      p_observacao: d.observacao ?? '',
    });
  }

  // ---------- Auth: a troca da senha ----------

  async #auth(metodo, rota, corpo) {
    const [r, json] = await this.#pedir(`/auth/v1/${rota}`, metodo, corpo);
    if (r.ok) return json;
    const codigo = codigoAuth(json);
    // Conta com um fator cadastrado (401 insufficient_aal): não é sessão encerrada.
    if (codigo !== 'insufficient_aal' && (r.status === 401 || SESSAO_ENCERRADA.includes(codigo))) throw this.#expirou();
    const e = new ErroPainel(ERROS_AUTH[codigo] || (r.status === 429 ? ERROS_AUTH.over_request_rate_limit : 'Não foi possível falar com a nuvem agora. Tente de novo.'), r.status);
    e.codigo = codigo;
    throw e;
  }

  /** E-mail da conta conectada (do token). */
  email() {
    const t = lerJwt(this.sessao.atual?.token);
    return typeof t?.email === 'string' ? t.email : '';
  }

  /**
   * Troca a senha da conta conectada (updateUser). O Auth encerra as OUTRAS
   * sessões da conta (computadores e celulares das lojas pedem a senha nova);
   * esta continua.
   */
  async trocarSenha(novaSenha) {
    const senha = String(novaSenha ?? '');
    if (senha.length < 8) throw new ErroPainel('A nova senha precisa ter pelo menos 8 caracteres.');
    await this.#auth('PUT', 'user', { password: senha });
  }
}
