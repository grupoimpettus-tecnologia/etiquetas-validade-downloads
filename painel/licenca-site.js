// Assinatura do Prazzo no site: a faixa do Painel de Gestão e da Contagem.
//
// A situação vem pronta da nuvem, na chave 'licenca' de painel_gestao e de
// contagem_escopo, já resumida por papel (gestor e operador não recebem o
// vencimento: para eles o aviso chega como em_dia). Sem a chave (nuvem antiga
// ou primeiro acesso pendente) ou sem vencimento: nenhuma faixa.
//   aviso      (amarela, só o master): vence em N dias;
//   tolerancia (laranja, todos): a impressão para em N dias, texto por papel;
//   consulta   (vermelha, fixa, todos): o que parou e o que continua.
// Os textos são os mesmos do app do computador. Nada aqui consulta a nuvem.

/** Brasília: UTC-3 fixo (sem horário de verão desde 2019; a nuvem usa 'America/Sao_Paulo'). */
const BRASILIA_MS = 3 * 3600e3;

export const FALE_COM_O_PRAZZO = 'Fale com o Prazzo para regularizar.';

/** Cor de cada faixa (classe do elemento). */
export const COR_DA_FAIXA = Object.freeze({ aviso: 'amarela', tolerancia: 'laranja', consulta: 'vermelha' });

/** Contagem: o botão das vencidas, com e sem impressão. */
export const ROTULO_DESCARTE = 'Descartar e imprimir nova';
export const ROTULO_DESCARTE_CONSULTA = 'Descartar';

/** Contagem no modo consulta: depois do descarte, no lugar do link para imprimir a nova. */
export const IMPRESSAO_SUSPENSA = 'A impressão de etiquetas está suspensa (modo consulta por pendência na assinatura do Prazzo): a etiqueta da produção nova não pode ser impressa agora. Consultar validades, rastrear e dar baixa continuam liberados.';

/** Instante (ms) de um texto ISO ou número; null se não for um instante. */
export function instante(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string' || !valor) return null;
  const n = Date.parse(valor);
  return Number.isFinite(n) ? n : null;
}

const ehDia = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Dia de Brasília ('aaaa-mm-dd') de um dia ou de um instante; null se não der. */
export function diaDeBrasilia(valor) {
  if (ehDia(valor)) return valor;
  const ms = instante(valor);
  return ms === null ? null : new Date(ms - BRASILIA_MS).toISOString().slice(0, 10);
}

/** "16/11" de um dia 'aaaa-mm-dd' ou de um instante (no horário de Brasília). */
export function diaMes(valor) {
  const dia = diaDeBrasilia(valor);
  if (!dia) return '';
  const [, mes, d] = dia.split('-');
  return `${d}/${mes}`;
}

/** "16/11/2026" de um dia 'aaaa-mm-dd' ou de um instante (no horário de Brasília). */
export function dataCompleta(valor) {
  const dia = diaDeBrasilia(valor);
  if (!dia) return '';
  const [ano, mes, d] = dia.split('-');
  return `${d}/${mes}/${ano}`;
}

/** "6h" ou "6h30" de um instante, no horário de Brasília. */
export function horaDeBrasilia(valor) {
  const ms = instante(valor);
  if (ms === null) return '';
  const d = new Date(ms - BRASILIA_MS);
  const min = d.getUTCMinutes();
  return `${d.getUTCHours()}h${min ? String(min).padStart(2, '0') : ''}`;
}

/** "16/11/2026 14:05" de um instante, no horário de Brasília. */
export function dataHoraDeBrasilia(valor) {
  const ms = instante(valor);
  if (ms === null) return '';
  const d = new Date(ms - BRASILIA_MS);
  const dois = (n) => String(n).padStart(2, '0');
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
}

/** "hoje", "amanhã" ou "em N dias". */
export function quando(dias) {
  if (!Number.isFinite(dias)) return 'em breve';
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

/** Modo consulta: imprimir e cadastrar suspensos (ver validades, rastrear e dar baixa continuam). */
export function emModoConsulta(licenca) {
  return Boolean(licenca && typeof licenca === 'object' && licenca.estado === 'consulta');
}

/**
 * Faixa da assinatura para quem está usando, ou null.
 * @param {object|null|undefined} licenca a chave 'licenca' da nuvem
 * @param {string} papel master | gestor | operador
 * @returns {{ tipo: 'aviso'|'tolerancia'|'consulta', cor: string, texto: string } | null}
 */
export function faixaLicenca(licenca, papel) {
  const f = textoDaFaixa(licenca, papel);
  return f ? { ...f, cor: COR_DA_FAIXA[f.tipo] } : null;
}

function textoDaFaixa(licenca, papel) {
  const l = licenca && typeof licenca === 'object' ? licenca : null;
  if (!l) return null;
  const master = papel === 'master';
  // Consulta vale até para quem não tem vencimento (suspensão manual).
  if (l.estado === 'consulta') {
    const porque = l.motivo === 'vencida' ? 'pendência de pagamento' : 'pendência na assinatura';
    return {
      tipo: 'consulta',
      texto: `Modo consulta: impressão de etiquetas e cadastro suspensos por ${porque}. Você ainda pode consultar validades, rastrear e dar baixa.${master ? ` ${FALE_COM_O_PRAZZO}` : ''}`,
    };
  }
  if (l.semVencimento) return null;
  if (l.estado === 'aviso') {
    // A amarela é só do master (a nuvem já manda em_dia para os outros; aqui também não aparece).
    if (!master) return null;
    return {
      tipo: 'aviso',
      texto: `Sua assinatura do Prazzo vence ${quando(l.diasParaVencer)}${ehDia(l.pagoAte) ? ` (${diaMes(l.pagoAte)})` : ''}. Para não interromper a impressão de etiquetas, regularize o pagamento.`,
    };
  }
  if (l.estado === 'tolerancia') {
    const prazo = instante(l.bloqueiaEm) !== null
      ? `${quando(l.diasParaBloquear)} (${diaMes(l.bloqueiaEm)}, às ${horaDeBrasilia(l.bloqueiaEm)})`
      : 'em breve';
    return master
      ? { tipo: 'tolerancia', texto: `Pagamento em atraso: impressão e cadastro serão suspensos ${prazo}. Consultar validades e dar baixa continuam liberados.` }
      : { tipo: 'tolerancia', texto: `Pagamento em atraso: a impressão será suspensa ${prazo}. Avise o responsável pela conta.` };
  }
  return null;
}

/** Contagem: rótulo do botão das vencidas (no modo consulta não se imprime a nova). */
export function rotuloDescarte(licenca) {
  return emModoConsulta(licenca) ? ROTULO_DESCARTE_CONSULTA : ROTULO_DESCARTE;
}

/**
 * Mostra (ou esconde) a faixa no elemento #faixa-licenca. Só mexe no elemento
 * quando o texto muda: a recarga do painel a cada minuto não repete o anúncio
 * para quem usa leitor de tela.
 * @param {HTMLElement} elemento
 * @param {{ tipo: string, cor: string, texto: string } | null} faixa
 */
export function mostrarFaixa(elemento, faixa) {
  if (!elemento) return;
  const classe = faixa ? `faixa-licenca ${faixa.cor}` : 'faixa-licenca';
  const texto = faixa?.texto || '';
  if (elemento.textContent !== texto) elemento.textContent = texto;
  if (elemento.className !== classe) elemento.className = classe;
  if (faixa) elemento.dataset.tipo = faixa.tipo;
  else delete elemento.dataset.tipo;
  elemento.hidden = !faixa;
}
