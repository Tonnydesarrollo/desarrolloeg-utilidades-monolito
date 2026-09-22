import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { google } from "googleapis";

export const DICTAMENES_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

function loadOAuthClient(credentialsPath) {
  const file = path.resolve(credentialsPath);
  if (!fs.existsSync(file)) throw new Error(`No se encontro el archivo de credenciales Google: ${file}`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const credentials = json.installed || json.web || {};
  if (!credentials.client_id || !credentials.client_secret || !credentials.redirect_uris?.[0]) {
    throw new Error("El archivo de credenciales Google no contiene un cliente OAuth valido");
  }
  return new google.auth.OAuth2(credentials.client_id, credentials.client_secret, credentials.redirect_uris[0]);
}

export function getDictamenesGoogleConfig() {
  return {
    credentialsPath: process.env.DICTAMENES_GOOGLE_CLIENT_CREDENTIALS
      || process.env.PEDIDOS_GOOGLE_CLIENT_CREDENTIALS
      || process.env.GOOGLE_CLIENT_CREDENTIALS,
    tokenPath: process.env.DICTAMENES_GOOGLE_TOKEN_PATH,
  };
}

export function getDictamenesAuthClient() {
  const { credentialsPath, tokenPath } = getDictamenesGoogleConfig();
  if (!credentialsPath || !tokenPath) {
    throw new Error("Configura DICTAMENES_GOOGLE_CLIENT_CREDENTIALS y DICTAMENES_GOOGLE_TOKEN_PATH");
  }
  const tokenFile = path.resolve(tokenPath);
  if (!fs.existsSync(tokenFile)) {
    throw new Error(`Falta autorizar Google para dictamenes. Ejecuta npm run auth:dictamenes (${tokenFile})`);
  }
  const client = loadOAuthClient(credentialsPath);
  client.setCredentials(JSON.parse(fs.readFileSync(tokenFile, "utf8")));
  return client;
}

export async function authorizeDictamenesGoogle() {
  const { credentialsPath, tokenPath } = getDictamenesGoogleConfig();
  if (!credentialsPath || !tokenPath) throw new Error("Configura las rutas DICTAMENES_GOOGLE_CLIENT_CREDENTIALS y DICTAMENES_GOOGLE_TOKEN_PATH");
  const client = loadOAuthClient(credentialsPath);
  const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: DICTAMENES_GOOGLE_SCOPES });
  console.log(`Abre esta URL y autoriza la cuenta contacto.gga.sc@gmail.com:\n${url}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => rl.question("Pega el codigo de autorizacion: ", resolve));
  rl.close();
  const entered = String(code).trim();
  let authorizationCode = entered;
  try {
    authorizationCode = new URL(entered).searchParams.get("code") || entered;
  } catch {
    // Tambien se acepta pegar solamente el codigo.
  }
  const { tokens } = await client.getToken(authorizationCode);
  const tokenFile = path.resolve(tokenPath);
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log(`Token guardado en ${tokenFile}`);
}
