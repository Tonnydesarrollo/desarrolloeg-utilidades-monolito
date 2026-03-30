import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, "..");

const credentialsPath = process.env.FACTURACION_GOOGLE_CREDENTIALS_PATH || path.join(moduleRoot, "services", "credentials.json");
const tokenPath = process.env.FACTURACION_GOOGLE_TOKEN_PATH || path.join(moduleRoot, "services", "token.json");

function buildAuthClient() {
  if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
    return null;
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8")).installed;
  const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  const { client_secret, client_id, redirect_uris } = credentials;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

export default buildAuthClient();
