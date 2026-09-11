export const DEFAULT_COMPANY_ADDRESS = "Río Tehuantepec 1704-1, Morelos, Los Pinos, 80170 Culiacán Rosales, Sin.";

export function getCompanyAddress() {
  return String(process.env.COMPANY_ADDRESS || DEFAULT_COMPANY_ADDRESS).trim();
}

export function getCompanyAddressLines() {
  return [getCompanyAddress()];
}
