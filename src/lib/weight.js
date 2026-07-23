const JIN_PER_KG = 2;

export function kgToJin(value) {
  return Number(value) * JIN_PER_KG;
}

export function jinToKg(value) {
  return Number(value) / JIN_PER_KG;
}

export function formatWeightJin(value) {
  return `${kgToJin(value).toFixed(1)} 斤`;
}
