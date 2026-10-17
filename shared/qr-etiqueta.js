// Conteúdo do QR de rastreio impresso em cada unidade da etiqueta. Puro e sem
// dependências: roda no processo principal, na interface, no celular e no site.
//
// Formato: "E<número sem zeros>-<unidade>" (ex.: E1070-3 = etiqueta nº 001070,
// unidade 3). Só letras maiúsculas, dígitos e "-": cabe no QR versão 1
// (21 x 21) com correção Q mesmo com número de 12 dígitos e unidade 99.

/** Maior unidade de uma etiqueta (cópias impressas de uma vez). */
export const MAX_UNIDADES = 99;

/** Texto do QR da unidade `seq` da etiqueta `numero`. */
export function textoQr(numero, seq) {
  const n = Number(numero);
  const s = Number(seq);
  if (!Number.isSafeInteger(n) || n < 0 || String(n).length > 12) throw new Error(`Número de rastreio inválido para o QR: ${numero}`);
  if (!Number.isInteger(s) || s < 1 || s > MAX_UNIDADES) throw new Error(`Unidade inválida para o QR: ${seq}`);
  return `E${n}-${s}`;
}

const COM_E = /^E(\d{1,12})-(\d{1,2})$/;
const SO_NUMERO = /^#?(\d{1,12})$/;
const COM_UNIDADE = /^(\d{1,12})(?:\s*[-/]\s*|\s+)(\d{1,2})$/;

/**
 * Lê o que foi bipado ou digitado: o QR ("E1070-3"), o número com a unidade
 * ("001070-3", "1070/3", "1070 3") ou só o número ("#001070", "001070").
 * @returns {{ numero: number, seq: number|null } | null}
 */
export function lerCodigo(texto) {
  const t = String(texto ?? '').trim().toUpperCase();
  const m = COM_E.exec(t) || COM_UNIDADE.exec(t);
  let numero;
  let seq = null;
  if (m) {
    numero = Number(m[1]);
    seq = Number(m[2]);
    if (seq < 1 || seq > MAX_UNIDADES) return null;
  } else {
    const so = SO_NUMERO.exec(t);
    if (!so) return null;
    numero = Number(so[1]);
  }
  return numero > 0 ? { numero, seq } : null;
}

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Filtro da busca de etiquetas: casa pelo nº do QR/código digitado ("E1070-3",
 * "001070-3") OU pelo texto (produto, responsável, lote…). É "ou" porque um
 * lote como "06/10" ou "15-10" também tem cara de código.
 * @param {string} busca
 * @param {(e: object) => string} textoDe texto pesquisável de cada etiqueta
 * @returns {(e: object) => boolean}
 */
export function filtroDeBusca(busca, textoDe) {
  const termo = semAcento(busca);
  if (!termo) return () => true;
  const lido = lerCodigo(busca);
  return (e) => (lido !== null && Number(e.numero ?? e.codigo) === lido.numero) || semAcento(textoDe(e)).includes(termo);
}

/** Linha da unidade na etiqueta: "UN 3/10". */
export function rotuloUnidade(seq, total) {
  return `UN ${Number(seq)}/${Number(total)}`;
}

/**
 * Matriz de um QR válido de "E0-1" (correção Q, 21 x 21; "1" = módulo preto),
 * para a pré-visualização sem a biblioteca de QR. Gerada pela lib "qrcode".
 */
export const MATRIZ_EXEMPLO = Object.freeze([
  '111111101010101111111',
  '100000100001001000001',
  '101110100111001011101',
  '101110100011101011101',
  '101110101100101011101',
  '100000101101001000001',
  '111111101010101111111',
  '000000000100000000000',
  '011111110111100110001',
  '001000011101011001001',
  '110010100001001100010',
  '000101011011111001111',
  '010100100111100100010',
  '000000001010100101001',
  '111111101111010010100',
  '100000101100000110101',
  '101110101100110010100',
  '101110101001111001000',
  '101110101000101100000',
  '100000101101111001001',
  '111111100000100100100',
]);

/** Confere se é uma matriz quadrada de "0"/"1" (formato de MATRIZ_EXEMPLO). */
export function matrizValida(matriz) {
  if (!Array.isArray(matriz) || matriz.length < 21) return false;
  return matriz.every((l) => typeof l === 'string' && l.length === matriz.length && /^[01]+$/.test(l));
}
