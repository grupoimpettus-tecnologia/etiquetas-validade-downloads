// Cálculo de vencimento e classificação das etiquetas.
import { SITUACAO, STATUS } from './constants.js';

const DIA_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/** Soma dias corridos mantendo o mesmo horário de parede. */
export function adicionarDias(data, dias) {
  const d = toDate(data);
  d.setDate(d.getDate() + Number(dias));
  return d;
}

export function calcularVencimento(manipuladoEm, dias) {
  return adicionarDias(manipuladoEm, dias);
}

function inicioDoDia(data) {
  const d = toDate(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Diferença em dias de calendário (b - a). */
export function diasDeCalendario(a, b) {
  return Math.round((inicioDoDia(b) - inicioDoDia(a)) / DIA_MS);
}

/**
 * Situação de uma etiqueta:
 *  - utilizada/descartada quando já teve baixa;
 *  - vencido quando o vencimento já passou;
 *  - hoje quando vence ainda hoje;
 *  - proximo quando vence dentro de `diasAviso` dias;
 *  - ok nos demais casos.
 */
export function classificar(etiqueta, agora = new Date(), diasAviso = 2) {
  if (etiqueta.status === STATUS.UTILIZADA) return SITUACAO.UTILIZADA;
  if (etiqueta.status === STATUS.DESCARTADA) return SITUACAO.DESCARTADA;
  const vence = toDate(etiqueta.venceEm);
  if (vence <= agora) return SITUACAO.VENCIDO;
  const dias = diasDeCalendario(agora, vence);
  if (dias <= 0) return SITUACAO.HOJE;
  if (dias <= diasAviso) return SITUACAO.PROXIMO;
  return SITUACAO.OK;
}

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Texto curto do tempo restante, ex.: "vence em 3 dias", "vencido há 2 h". */
export function descreverRestante(venceEm, agora = new Date()) {
  const vence = toDate(venceEm);
  const diffMs = vence - agora;
  const dias = diasDeCalendario(agora, vence);
  if (diffMs <= 0) {
    const passadoMs = -diffMs;
    if (passadoMs < 60 * 60 * 1000) return `vencido há ${plural(Math.max(1, Math.floor(passadoMs / 60000)), 'min', 'min')}`;
    if (passadoMs < DIA_MS) return `vencido há ${plural(Math.floor(passadoMs / 3600000), 'hora', 'horas')}`;
    return `vencido há ${plural(Math.floor(passadoMs / DIA_MS), 'dia', 'dias')}`;
  }
  if (dias === 0) {
    if (diffMs < 60 * 60 * 1000) return `vence em ${plural(Math.max(1, Math.ceil(diffMs / 60000)), 'min', 'min')}`;
    return `vence hoje às ${formatarHora(vence)}`;
  }
  if (dias === 1) return `vence amanhã às ${formatarHora(vence)}`;
  return `vence em ${plural(dias, 'dia', 'dias')}`;
}

const pad = (n) => String(n).padStart(2, '0');

export function formatarData(value, anoCurto = false) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const ano = anoCurto ? pad(d.getFullYear() % 100) : d.getFullYear();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${ano}`;
}

export function formatarHora(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatarDataHora(value, anoCurto = false) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatarData(d, anoCurto)} ${formatarHora(d)}`;
}

/** Valor para <input type="datetime-local"> no fuso local. */
export function paraInputDataHora(value) {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor para <input type="date"> no fuso local. */
export function paraInputData(value) {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Formata quantidade no padrão brasileiro (2,5). */
export function formatarQuantidade(qtd) {
  if (qtd === null || qtd === undefined || qtd === '') return '';
  const n = Number(qtd);
  if (!Number.isFinite(n)) return String(qtd);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Converte "2,5" ou "2.5" em número; retorna null se vazio ou inválido. */
export function lerQuantidade(texto) {
  if (texto === null || texto === undefined) return null;
  const limpo = String(texto).trim().replace(/\s/g, '');
  if (!limpo) return null;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
