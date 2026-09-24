/** Dinheiro em centavos (inteiro) para validações sem erro de float. */
export function toCents(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function toReais(cents: number): number {
  return Math.round(cents) / 100;
}

/** "275.66" -> "275,66" (recibo BR). Nulo/inválido vira "0,00" (nunca "NaN"). */
export function br(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0,00';
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}
