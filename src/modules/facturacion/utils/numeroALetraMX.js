export function numeroALetraMX(num) {

  // 🧹 Normalización total
  if (typeof num === "string") {
    num = num.replace(/[^0-9.-]/g, "");
  }

  num = Number(num);

  if (!Number.isFinite(num)) {
    return "CERO PESOS 00/100 M.N.";
  }

  const unidades = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
  const decenas = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function convertirMenor100(n) {
  if (n < 10) return unidades[n];

  if (n === 10) return "DIEZ"; // 👈 FIX CLAVE

  if (n >= 11 && n <= 15) {
    return ["ONCE","DOCE","TRECE","CATORCE","QUINCE"][n - 11];
  }

  if (n < 20) return "DIECI" + unidades[n - 10];

  if (n === 20) return "VEINTE";

  if (n < 30) return "VEINTI" + unidades[n - 20];

  return decenas[Math.floor(n / 10)] +
    (n % 10 ? " Y " + unidades[n % 10] : "");
}


  function convertirGrupo(n) {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    return (
      (n >= 100 ? centenas[Math.floor(n / 100)] + " " : "") +
      convertirMenor100(n % 100)
    ).trim();
  }

  const entero = Math.floor(num);
  const centavos = Math.round((num - entero) * 100);

  if (entero === 0) {
    return `CERO PESOS ${centavos.toString().padStart(2, "0")}/100 M.N.`;
  }

  let letras = "";

  if (entero >= 1_000_000) {
    const millones = Math.floor(entero / 1_000_000);
    letras += (millones === 1 ? "UN MILLÓN " : convertirGrupo(millones) + " MILLONES ");
  }

  if (entero >= 1_000) {
    const miles = Math.floor((entero % 1_000_000) / 1_000);

    if (miles === 1) {
      letras += "MIL ";
    } else if (miles === 10) {
      letras += "DIEZ MIL ";
    } else if (miles > 1) {
      letras += convertirGrupo(miles) + " MIL ";
    }
  }

  letras += convertirGrupo(entero % 1_000);

  const moneda = entero === 1 ? "PESO" : "PESOS";

  return `${letras.trim()} ${moneda} ${centavos.toString().padStart(2, "0")}/100 M.N.`;
}
