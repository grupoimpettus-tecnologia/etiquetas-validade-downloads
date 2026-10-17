// Painel do Proprietário: regras puras (sem tela e sem nuvem).
//
// Situação de cada cliente (chip colorido), o filtro "precisa de atenção", o
// operacao_id de cada formulário (idempotência na nuvem), a sugestão do "pago
// até", a prévia dos dias extras, o histórico em texto, a senha provisória e o
// texto pronto para mandar ao cliente, e as regras da configuração do envio de
// e-mails (aba E-mail). As telas ficam em proprietario.js.
import { dataCompleta, dataHoraDeBrasilia, diaDeBrasilia, diaMes, horaDeBrasilia, instante, quando } from './licenca-site.js';

/** Cliente nº 1 (id fixo da migration): sem vencimento, nunca suspenso, nada muda para ele. */
export const CLIENTE_NUMERO_1 = '00000000-0000-4000-8000-000000000001';

/** Formas de pagamento aceitas pela nuvem (prazzo_registrar_pagamento). */
export const FORMAS_PAGAMENTO = Object.freeze([
  ['manual', 'Manual'],
  ['pix', 'PIX'],
  ['boleto', 'Boleto'],
  ['cortesia', 'Cortesia'],
  ['outro', 'Outro'],
]);
const NOME_FORMA = Object.fromEntries(FORMAS_PAGAMENTO);

export const PAPEIS = Object.freeze({ master: 'Master', gestor: 'Gestor', operador: 'Operador' });

const NOME_ESTADO = { em_dia: 'em dia', aviso: 'perto do vencimento', tolerancia: 'atrasado (tolerância)', consulta: 'modo consulta' };

// ---------- Token (JWT) ----------

/** Conteúdo (payload) do token de acesso; null se não for um JWT legível. */
export function lerJwt(token) {
  try {
    const parte = String(token || '').split('.')[1];
    if (!parte) return null;
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const dados = JSON.parse(new TextDecoder().decode(bytes));
    return dados && typeof dados === 'object' ? dados : null;
  } catch {
    return null;
  }
}

// ---------- Formulários: operacao_id ----------

/** Texto canônico dos campos (a ordem das chaves não importa). */
function canonico(valores) {
  return JSON.stringify(Object.keys(valores || {}).sort().map((k) => [k, valores[k] ?? null]));
}

/**
 * operacao_id de um formulário: gerado ao abrir; outro para cada conteúdo
 * diferente dos campos; o MESMO sempre que o conteúdo volta a ser um que já
 * teve (clique duplo, resposta perdida, ou mudar um campo e desfazer), que a
 * nuvem reconhece e responde igual, sem gravar de novo.
 *
 * Envio sem resposta certa (incerto): até a nuvem responder, o formulário só
 * pode ser reenviado com os campos daquele envio (`divergente` diz se mudaram).
 * Assim, mudar um campo depois de uma resposta perdida nunca vira uma 2ª
 * operação (ex.: dias extras em dobro).
 * @param {() => string} gerar ex.: () => crypto.randomUUID()
 */
export function novaOperacao(gerar) {
  const usados = new Map(); // conteúdo dos campos -> operacao_id
  let id = gerar();
  let assinatura = null;
  let incerta = null; // conteúdo do envio que ficou sem resposta certa
  return {
    get id() {
      return id;
    },
    /** Os campos agora; devolve o operacao_id que vale para eles. */
    campos(valores) {
      const a = canonico(valores);
      if (assinatura === null) usados.set(a, id);
      else if (a !== assinatura) {
        id = usados.get(a) ?? gerar();
        usados.set(a, id);
      }
      assinatura = a;
      return id;
    },
    /** O último envio ficou sem resposta certa (pode ter sido gravado). */
    marcarIncerto() {
      incerta = assinatura;
    },
    /** A nuvem respondeu (gravou, confirmou ou recusou por regra): o formulário fica livre. */
    respondida() {
      incerta = null;
    },
    /** Há um envio sem resposta certa (pode ter sido gravado)? */
    get incerto() {
      return incerta !== null;
    },
    /** Os campos mudaram depois de um envio sem resposta certa? */
    get divergente() {
      return incerta !== null && incerta !== assinatura;
    },
  };
}

/** Mensagem quando os campos mudaram depois de um envio sem resposta certa. */
export const FORMULARIO_JA_ENVIADO = 'Este formulário já foi enviado e a nuvem não confirmou: ele pode ter sido gravado. Para repetir com segurança, deixe os campos como estavam no envio; para mudar algo, feche, confira o histórico do cliente e abra o formulário de novo.';

// ---------- Endereço do painel ----------

/** Endereços de desenvolvimento (testes e prévia neste computador). */
const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * O Painel do Proprietário só roda num endereço (origem) só dele: no
 * *.github.io, todos os sites do GitHub Pages da mesma conta dividem a origem,
 * e qualquer um deles poderia abrir esta página e ler o que se digita nela
 * (senha, código, a chave do app autenticador). Vale: o endereço próprio
 * posto na publicação (`origemPropria`; padrão: a cópia do site na VPS; nunca
 * *.github.io) ou um endereço local de desenvolvimento.
 * @param {{ origin: string, hostname: string }} local window.location
 * @param {string} origemPropria ex.: 'https://prazzo.179-197-234-103.sslip.io'
 */
export function enderecoPermitido(local, origemPropria) {
  const host = String(local?.hostname || '').toLowerCase();
  if (LOCAIS.has(host) || host.endsWith('.localhost')) return true;
  if (!origemPropria || /\.github\.io$/i.test(host)) return false;
  return String(local?.origin || '') === origemPropria;
}

// ---------- Situação dos clientes ----------

/**
 * Chip da situação: Em dia (verde), Vence em N dias (amarelo), Atrasado —
 * bloqueia em dd/mm (laranja), Consulta (vermelho), Suspenso (vermelho),
 * Sem vencimento (cinza).
 * @param {object} l licenca de prazzo_listar_clientes (estado_licenca)
 * @returns {{ classe: string, texto: string }}
 */
export function situacaoCliente(l) {
  if (!l || typeof l !== 'object') return { classe: 'vermelha', texto: 'Sem licença' };
  if (l.estado === 'consulta') {
    if (l.motivo === 'suspensa') return { classe: 'vermelha', texto: 'Suspenso' };
    if (l.motivo === 'sem_licenca') return { classe: 'vermelha', texto: 'Consulta — sem licença' };
    return { classe: 'vermelha', texto: 'Consulta' };
  }
  if (l.semVencimento) return { classe: 'cinza', texto: 'Sem vencimento' };
  if (l.estado === 'tolerancia') {
    return { classe: 'laranja', texto: instante(l.bloqueiaEm) !== null ? `Atrasado — bloqueia em ${diaMes(l.bloqueiaEm)}` : 'Atrasado' };
  }
  if (l.estado === 'aviso') {
    const n = l.diasParaVencer;
    return { classe: 'amarela', texto: n === 0 ? 'Vence hoje' : n === 1 ? 'Vence amanhã' : `Vence ${quando(n)}` };
  }
  return { classe: 'verde', texto: 'Em dia' };
}

/** Lojas acima do contratado (sinal de abuso do teto de números): o texto do alerta, ou ''. */
export function alertaLojas(c) {
  const l = c?.licenca;
  const contratadas = Number(l?.lojasContratadas);
  if (!l || l.semVencimento || !Number.isFinite(contratadas)) return '';
  const partes = [];
  if (Number(c.lojasAtivas) > contratadas) partes.push(`${c.lojasAtivas} ativas`);
  if (Number(c.lojasComEtiqueta30d) > contratadas) partes.push(`${c.lojasComEtiqueta30d} com etiqueta nos últimos 30 dias`);
  if (Number(c.lojasCriadas30d) > contratadas) partes.push(`${c.lojasCriadas30d} cadastradas nos últimos 30 dias`);
  return partes.length ? `Lojas acima do contratado (${contratadas}): ${partes.join(', ')}.` : '';
}

/** "Precisa de atenção": perto de vencer, atrasado, em consulta/suspenso, ou lojas acima do contratado. */
export function precisaAtencao(c) {
  return ['aviso', 'tolerancia', 'consulta'].includes(c?.licenca?.estado) || Boolean(alertaLojas(c));
}

/** "16/11/2026 às 6h" (instante do bloqueio, no horário de Brasília). */
export function textoBloqueio(valor) {
  return instante(valor) !== null ? `${dataCompleta(valor)} às ${horaDeBrasilia(valor)}` : '';
}

// ---------- Pagamento ----------

/** 'aaaa-mm-dd' + 1 mês (31/01 → 28/02 ou 29/02). */
export function somarMes(dia) {
  const [a, m, d] = String(dia).split('-').map(Number);
  const ano = m === 12 ? a + 1 : a;
  const mes = m === 12 ? 1 : m + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Sugestão do novo "pago até": o atual + 1 mês (sem data, hoje + 1 mês). */
export function sugerirPagoAte(pagoAte, agoraMs) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(pagoAte || '') ? pagoAte : diaDeBrasilia(agoraMs);
  return somarMes(base);
}

/** Voltar a data do "pago até" exige motivo (a nuvem grava como 'ajuste'). */
export function voltaAData(atual, nova) {
  return Boolean(atual && nova && nova < atual);
}

/** Valor em reais digitado ("1.234,56", "1234,56", "1234.56"): null se vazio, NaN se inválido. */
export function lerValor(texto) {
  let t = String(texto ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Number(t);
}

/** "R$ 1.234,50" (ou "—"). */
export function formatarValor(valor) {
  if (valor === null || valor === undefined || valor === '' || !Number.isFinite(Number(valor))) return '—';
  const [inteiro, centavos] = Number(valor).toFixed(2).split('.');
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`;
}

// ---------- Dias extras ----------

/** Prévia de prazzo_conceder_dias (p_previa): "O bloqueio passa de 16/11 para 19/11." */
export function descreverPrevia(r) {
  if (!r) return '';
  const depois = r.bloqueiaEmDepois ? `${diaMes(r.bloqueiaEmDepois)} (às ${horaDeBrasilia(r.bloqueiaEmDepois)})` : '—';
  const frases = [r.bloqueiaEmAntes
    ? `O bloqueio passa de ${diaMes(r.bloqueiaEmAntes)} para ${depois}.`
    : `O bloqueio passa a ser em ${depois}.`];
  if (r.estadoAntes && r.estadoDepois && r.estadoAntes !== r.estadoDepois) {
    frases.push(`A situação muda de ${NOME_ESTADO[r.estadoAntes] || r.estadoAntes} para ${NOME_ESTADO[r.estadoDepois] || r.estadoDepois}.`);
  }
  if (r.estadoAntes === 'consulta' && r.estadoDepois !== 'consulta') frases.push('A impressão e o cadastro voltam a funcionar em até 1 minuto.');
  return frases.join(' ');
}

// ---------- Histórico ----------

const TIPOS_EVENTO = {
  criacao: 'Cliente criado',
  pagamento: 'Pagamento registrado',
  ajuste: 'Ajuste do "pago até"',
  dias_extras: 'Dias extras',
  dias_extras_zerados: 'Dias extras zerados',
  suspensao: 'Suspensão',
  reativacao: 'Reativação',
  configuracao: 'Configuração',
  reservas_descartadas: 'Reservas descartadas',
  suporte: 'Suporte',
};

const data = (v) => (v ? dataCompleta(v) : '—');

const CAMPOS_CONFIG = [
  ['dias_aviso', 'aviso', (v) => `${v} ${v === 1 ? 'dia' : 'dias'}`],
  ['dias_tolerancia', 'tolerância', (v) => `${v} ${v === 1 ? 'dia' : 'dias'}`],
  ['valor_mensal', 'valor mensal', formatarValor],
  ['lojas_contratadas', 'lojas contratadas', String],
  ['sem_vencimento', 'sem vencimento', (v) => (v ? 'sim' : 'não')],
];

/**
 * Uma linha do histórico (prazzo_historico) em texto: quando, quem, o quê,
 * antes → depois, dias, valor, forma, referência e observação.
 */
export function descreverEvento(ev) {
  const d = ev?.detalhes && typeof ev.detalhes === 'object' ? ev.detalhes : {};
  let oque = TIPOS_EVENTO[ev?.tipo] || String(ev?.tipo || '');
  let mudanca = '';
  switch (ev?.tipo) {
    case 'criacao':
      if (ev.origem === 'migracao') oque = 'Cliente nº 1 (migração)';
      mudanca = ev.pagoAteDepois ? `pago até ${data(ev.pagoAteDepois)}` : d.semVencimento ? 'sem vencimento' : '';
      break;
    case 'pagamento':
    case 'ajuste':
      mudanca = `pago até ${data(ev.pagoAteAntes)} → ${data(ev.pagoAteDepois)}`;
      break;
    case 'dias_extras':
    case 'dias_extras_zerados':
      mudanca = `liberado até ${data(ev.liberadoAteAntes)} → ${data(ev.liberadoAteDepois)}`;
      break;
    case 'suspensao':
      mudanca = 'em uso → suspenso';
      break;
    case 'reativacao':
      mudanca = 'suspenso → reativado';
      break;
    case 'configuracao': {
      const antes = d.antes || {};
      const depois = d.depois || {};
      mudanca = CAMPOS_CONFIG.filter(([k]) => JSON.stringify(antes[k] ?? null) !== JSON.stringify(depois[k] ?? null))
        .map(([k, nome, f]) => `${nome} ${antes[k] === null || antes[k] === undefined ? '—' : f(antes[k])} → ${depois[k] === null || depois[k] === undefined ? '—' : f(depois[k])}`)
        .join('; ') || 'nada mudou';
      break;
    }
    case 'reservas_descartadas':
      mudanca = `${Number(d.quantidade) || 0} ${Number(d.quantidade) === 1 ? 'número descartado' : 'números descartados'}`;
      break;
    case 'suporte':
      if (d.acao === 'redefinir_acesso_master') oque = 'Acesso de master redefinido';
      mudanca = d.email ? `senha provisória para ${d.email}` : '';
      break;
    default:
      break;
  }
  return {
    quando: dataHoraDeBrasilia(ev?.feitoEm),
    quem: ev?.feitoPor || (ev?.origem === 'integracao' ? 'Integração de pagamento' : '—'),
    oque,
    mudanca,
    dias: Number.isFinite(ev?.dias) ? String(ev.dias) : '',
    valor: ev?.valor === null || ev?.valor === undefined ? '' : formatarValor(ev.valor),
    forma: ['pagamento', 'ajuste', 'criacao'].includes(ev?.tipo) || ev?.origem === 'integracao' ? (NOME_FORMA[ev?.forma] || '') : '',
    referencia: ev?.referencia || '',
    observacao: ev?.observacao || '',
  };
}

// ---------- Acessos ----------

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * Senha provisória legível (sem 0/O, 1/l/I), em 3 grupos de 4: "Xk7m-Q2pa-Vn9r".
 * Sempre com maiúscula, minúscula e número.
 * @param {(n: number) => Uint8Array} [aleatorio] bytes aleatórios (crypto.getRandomValues)
 */
export function gerarSenhaProvisoria(aleatorio = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  const limite = 256 - (256 % LETRAS.length); // sem viés
  for (;;) {
    let s = '';
    while (s.length < 12) {
      for (const b of aleatorio(24)) {
        if (b < limite && s.length < 12) s += LETRAS[b % LETRAS.length];
      }
    }
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  }
}

/**
 * Texto pronto para mandar ao 1º master de um cliente novo. Sai sempre, mesmo
 * com o envio de e-mails ligado: é o plano B quando o e-mail não chega.
 */
export function textoParaCliente({ cliente, masterNome, email, senha, instalador }) {
  return [
    `Olá, ${masterNome}!`,
    '',
    `O acesso de ${cliente} ao Prazzo está pronto.`,
    '',
    `1. Instale o Prazzo no computador da loja: ${instalador}`,
    `2. Entre com o e-mail ${email} e a senha provisória ${senha}`,
    '3. No 1º acesso, troque a senha e aceite os termos de uso.',
    '',
    'Depois, em Configurações, cadastre as lojas, os usuários e a impressora.',
  ].join('\n');
}

/** Texto pronto para mandar ao master cujo acesso foi redefinido pelo Proprietário. */
export function textoAcessoRedefinido({ nome, email, senha }) {
  return [
    `Olá, ${nome}!`,
    '',
    'O seu acesso ao Prazzo foi redefinido.',
    `Entre com o e-mail ${email} e a senha provisória ${senha}`,
    'No próximo acesso, o app pede para você criar uma senha nova.',
  ].join('\n');
}

// ---------- E-mail (o envio dos dados de acesso, serviço do Prazzo na VPS) ----------

/** Portas aceitas pelo serviço (as mesmas do ERP). */
export const PORTAS_EMAIL = Object.freeze([587, 465, 25, 2525]);

/** Segurança da conexão com o servidor de e-mail: [valor, nome na tela]. */
export const SEGURANCAS_EMAIL = Object.freeze([
  ['starttls', 'STARTTLS'],
  ['ssl', 'SSL/TLS'],
]);

/**
 * Dicas prontas de provedor: preenchem servidor, porta e segurança; o resto
 * (usuário, senha, remetente) é da conta de cada um.
 */
export const PROVEDORES_EMAIL = Object.freeze({
  outlook: Object.freeze({
    nome: 'Hotmail / Outlook',
    servidor: 'smtp-mail.outlook.com',
    porta: 587,
    seguranca: 'starttls',
    dica: 'Usuário e remetente: o seu endereço do Hotmail/Outlook (o mesmo nos dois). Atenção: a Microsoft pode recusar o login por senha em conta pessoal; se o teste disser que a senha foi recusada, use outro provedor (por exemplo, o Brevo).',
  }),
  brevo: Object.freeze({
    nome: 'Brevo',
    servidor: 'smtp-relay.brevo.com',
    porta: 587,
    seguranca: 'starttls',
    dica: 'Usuário: o login SMTP que aparece no painel do Brevo (SMTP e API › SMTP). Senha: a "chave SMTP" gerada lá (não a senha da sua conta). O e-mail do remetente precisa estar validado no Brevo.',
  }),
});

/** A porta 465 usa SSL/TLS desde o início; 587, 25 e 2525 começam sem e sobem com STARTTLS. */
export function segurancaDaPorta(porta) {
  return Number(porta) === 465 ? 'ssl' : 'starttls';
}

/** Nomes que só existem dentro de uma rede (o serviço recusa, como o ERP). */
const NOME_LOCAL = /(^|\.)(localhost|local|localdomain|internal|lan|home\.arpa)$/i;

/**
 * Servidor de e-mail só por nome (como o ERP): nada de IP, de "localhost",
 * de ".local" nem de nome sem ponto. Assim o serviço nunca é usado para
 * bater em endereços da própria VPS ou da rede interna.
 */
export function servidorEmailValido(nome) {
  const n = String(nome ?? '').trim().toLowerCase();
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(n)) return false;
  return !NOME_LOCAL.test(n);
}

/** E-mail com cara de e-mail (o serviço confere de novo). */
export function emailValido(email) {
  const e = String(email ?? '').trim();
  return e.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(e);
}

/** Campos da conexão: mudar qualquer um (ou digitar uma senha) desliga o envio até um teste novo passar. */
const CAMPOS_CONEXAO = ['servidor', 'porta', 'seguranca', 'usuario'];
const normal = (k, v) => (k === 'porta' ? Number(v) || 0 : String(v ?? '').trim().toLowerCase());

/**
 * O formulário muda a conexão em relação à configuração salva?
 * @param {object|null} salva a configuração do serviço (GET config)
 * @param {object} v os campos do formulário (senha: o que foi digitado)
 */
export function conexaoMudou(salva, v) {
  if (String(v?.senha ?? '') !== '') return true;
  return CAMPOS_CONEXAO.some((k) => normal(k, salva?.[k]) !== normal(k, v?.[k]));
}

/** Servidor ou usuário trocados: o serviço exige a senha de novo (ela é amarrada aos dois). */
export function exigeSenhaDeNovo(salva, v) {
  if (!salva?.senhaGuardada) return true;
  return ['servidor', 'usuario'].some((k) => normal(k, salva?.[k]) !== normal(k, v?.[k]));
}

/** O último teste passou com a conexão salva (só então dá para ligar o envio)? */
export function testeValeParaLigar(salva) {
  return Boolean(salva?.teste?.ok);
}

/**
 * Confere o formulário antes de salvar (o serviço confere tudo de novo).
 * @returns {string} '' se está tudo certo, ou o que corrigir
 */
export function validarConfigEmail(v, salva) {
  const servidor = String(v?.servidor ?? '').trim();
  if (!servidor) return 'Informe o servidor de e-mail (SMTP), por exemplo smtp-mail.outlook.com.';
  if (!servidorEmailValido(servidor)) return 'Servidor de e-mail: use o nome do servidor (por exemplo smtp-mail.outlook.com), não um IP nem um nome da rede local.';
  const porta = Number(v?.porta);
  if (!PORTAS_EMAIL.includes(porta)) return 'Porta: use 587, 465, 25 ou 2525.';
  if (v?.seguranca !== segurancaDaPorta(porta)) return 'A porta 465 usa SSL/TLS; as portas 587, 25 e 2525 usam STARTTLS.';
  const usuario = String(v?.usuario ?? '').trim();
  if (!usuario) return 'Informe o usuário da conta de e-mail.';
  if (usuario.length > 254 || /[\r\n]/.test(usuario)) return 'Usuário da conta de e-mail inválido.';
  if (String(v?.senha ?? '') === '' && exigeSenhaDeNovo(salva, v)) {
    return salva?.senhaGuardada ? 'Ao trocar o servidor ou o usuário, digite a senha de novo.' : 'Digite a senha da conta de e-mail (ou a chave SMTP).';
  }
  if (String(v?.senha ?? '').length > 512) return 'Senha grande demais.';
  const nome = String(v?.remetenteNome ?? '').trim();
  if (nome.length > 80 || /[\r\n<>"]/.test(nome)) return 'Nome do remetente: até 80 caracteres, sem aspas nem < >.';
  if (!emailValido(v?.remetenteEmail)) return 'Informe um e-mail válido para o remetente.';
  if (String(v?.responderPara ?? '').trim() && !emailValido(v.responderPara)) return 'O "responder para" precisa ser um e-mail válido (ou vazio).';
  // Como o serviço: mudar a conexão sempre desliga; o teste que passou só é exigido ao LIGAR (desligado → ligado).
  // Já ligado, um teste que falhou depois (ex.: endereço digitado errado) não desliga nem trava as outras mudanças.
  if (v?.ligado && (conexaoMudou(salva, v) || (!salva?.ligado && !testeValeParaLigar(salva)))) {
    return 'Para ligar o envio, salve a conexão e mande um e-mail de teste que passe.';
  }
  return '';
}

/** O formulário difere da configuração salva (fora o "ligado")? O teste usa a salva: mudou, salva antes. */
export function configEmailMudou(salva, v) {
  if (conexaoMudou(salva, v)) return true;
  return ['remetenteNome', 'remetenteEmail', 'responderPara'].some((k) => String(salva?.[k] ?? '').trim() !== String(v?.[k] ?? '').trim());
}

/** O corpo do PUT /api/email/config: aparado, porta em número, senha só se digitada. */
export function corpoConfigEmail(v) {
  const corpo = {
    servidor: String(v?.servidor ?? '').trim().toLowerCase(),
    porta: Number(v?.porta),
    seguranca: String(v?.seguranca ?? ''),
    usuario: String(v?.usuario ?? '').trim(),
    remetenteNome: String(v?.remetenteNome ?? '').trim(),
    remetenteEmail: String(v?.remetenteEmail ?? '').trim(),
    responderPara: String(v?.responderPara ?? '').trim(),
    ligado: Boolean(v?.ligado),
  };
  if (String(v?.senha ?? '') !== '') corpo.senha = String(v.senha);
  return corpo;
}

/**
 * Chip do estado do envio: "Ligado" (verde), "Desligado" (cinza), "Parado"
 * (vermelho; o motivo, que pode ser a resposta inteira do servidor de e-mail,
 * vai na faixa de textoPausa: "Parado: <motivo>"), "Não configurado" (cinza).
 * O "desligado" vem antes do "parado": o serviço guarda a pausa mesmo com o
 * envio desligado (ela continua ao ligar de novo), mas desligado é desligado.
 * @param {{ configurado?: boolean, servidor?: string, ligado?: boolean, pausado?: boolean, motivo?: string }|null} e
 */
export function estadoEmail(e) {
  const configurado = e?.configurado ?? Boolean(e?.servidor && e?.senhaGuardada);
  if (!e || !configurado) return { classe: 'cinza', texto: 'Não configurado' };
  if (!e.ligado) return { classe: 'cinza', texto: 'Desligado' };
  if (e.pausado) return { classe: 'vermelha', texto: 'Parado' };
  return { classe: 'verde', texto: 'Ligado' };
}

/**
 * Dá para oferecer o envio (a caixa "Mandar por e-mail")? E, se não, por quê.
 * Quem lê é o Proprietário: "não configurado" e "desligado" têm o texto do
 * painel (o do serviço, "peça ao Proprietário do Prazzo", é para as outras
 * contas); só o "parado" usa o motivo do serviço (a hora de tentar de novo).
 */
export function ofertaDeEnvio(e) {
  if (e?.ligado && !e?.pausado) return { pode: true, dica: '' };
  if (!e?.configurado) return { pode: false, dica: 'O envio de e-mails não está configurado (aba E-mail): mande o texto pronto.' };
  if (!e.ligado) return { pode: false, dica: 'O envio de e-mails está desligado (aba E-mail): mande o texto pronto.' };
  // Ligado e parado: o motivo do serviço já começa por "O envio de e-mails está parado…".
  return { pode: false, dica: `${String(e.motivo || 'O envio de e-mails está parado.').replace(/\.?$/, '.')} Mande o texto pronto.` };
}

/**
 * Envio parado, como no ERP: senha recusada pelo servidor de e-mail espera um
 * teste que passe; erro de conexão tenta de novo sozinho depois de um tempo
 * (pausadoAte). Com o envio desligado e a pausa guardada, o chip diz
 * "Desligado" e a faixa avisa que, ao ligar de novo, continua parado.
 */
export function textoPausa(c) {
  if (!c?.pausado) return '';
  const motivo = String(c.motivo || 'o servidor de e-mail recusou o último envio').replace(/\.?$/, '.');
  const volta = instante(c.pausadoAte) !== null
    ? `Tenta de novo sozinho a partir de ${dataHoraDeBrasilia(c.pausadoAte)} (ou já, com um e-mail de teste que passe).`
    : 'Volta quando um e-mail de teste passar.';
  const inicio = c.ligado === false ? 'Ao ligar de novo, o envio continua parado:' : 'Parado:';
  return `${inicio} ${motivo} ${volta}`;
}

/** "Último teste: …" da configuração salva. */
export function textoUltimoTeste(teste) {
  if (!teste || typeof teste !== 'object') return 'Nenhum teste com esta conexão ainda: salve e mande um e-mail de teste.';
  const quando = instante(teste.quando) !== null ? ` em ${dataHoraDeBrasilia(teste.quando)}` : '';
  const para = teste.para ? ` para ${teste.para}` : '';
  if (teste.ok) return `Último teste: enviado${quando}${para}.`;
  return `Último teste: falhou${quando}${para}${teste.erro ? ` — ${teste.erro}` : ''}.`;
}

/**
 * O resultado do e-mail de acesso, em texto para a tela.
 * @param {{ enviado?: boolean, para?: string, motivo?: string, incerto?: boolean }} r
 */
export function textoEnvioAcesso(r) {
  if (r?.enviado) return `E-mail enviado para ${r.para || 'o usuário'}.`;
  const motivo = String(r?.motivo || 'motivo não informado').replace(/\.?$/, '.');
  if (r?.incerto) return `${motivo} O e-mail pode ter sido enviado ou não: confira com a pessoa antes de mandar o texto pronto.`;
  return `O e-mail não foi enviado: ${motivo} Mande o texto pronto.`;
}

/** "há 3 dias" / "hoje" / "nunca" para o último acesso de um usuário. */
export function ultimoAcesso(valor, agoraMs) {
  const ms = instante(valor);
  if (ms === null) return 'nunca entrou';
  const dias = Math.round((Date.parse(`${diaDeBrasilia(agoraMs)}T00:00:00Z`) - Date.parse(`${diaDeBrasilia(ms)}T00:00:00Z`)) / 864e5);
  if (dias <= 0) return `hoje, ${dataHoraDeBrasilia(ms).slice(-5)}`;
  if (dias === 1) return 'ontem';
  return `há ${dias} dias (${dataCompleta(ms)})`;
}
