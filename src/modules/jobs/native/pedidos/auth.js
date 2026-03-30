import fs from "fs";
import path from "path";
import readline from "readline";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.file"
];

function promptInput(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function getAuthClient({ credentialsPath, tokenPath }) {
  const credentialsFile = path.resolve(credentialsPath);
  if (!fs.existsSync(credentialsFile)) throw new Error(`No se encontro credentials.json en ${credentialsFile}`);

  const content = JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
  const { client_secret, client_id, redirect_uris } = content.installed || content.web || {};
  if (!client_id || !client_secret || !redirect_uris || !redirect_uris.length) {
    throw new Error("credentials.json invalido: faltan client_id/client_secret/redirect_uris");
  }

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const tokenFile = path.resolve(tokenPath);
  if (fs.existsSync(tokenFile)) {
    const token = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });
  console.log("Autoriza esta app en el navegador:");
  console.log(authUrl);
  const code = await promptInput("Pega aqui el codigo de autorizacion: ");
  const { tokens } = await oAuth2Client.getToken(code.trim());
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), "utf8");
  return oAuth2Client;
}
