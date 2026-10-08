import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { stitch } from "@google/stitch-sdk";

dotenv.config({ path: path.resolve(process.cwd(), ".env.stitch") });

const projectId = "12367790359575328546";

const pagePrompt = `
Full desktop web application screen: Corporate Sign-in and Authentication Portal for "Desarrollo EG".

Screen Layout (1440px desktop viewport):
- Background: Elegant subtle gradient (#f4f7fb to #e9eff6) with soft ambient glow.
- Center Stage: A centered, wide dual-card authentication container (approx 980px wide, 620px high) with subtle border radius (24px), glassmorphic surface, and gentle elevation shadow.

Left Panel (Branding & Trust - 50% width):
- Deep corporate gradient background (from #092c35 to #0f4c5c) with white text.
- Brand logo: "Desarrollo EG" with badge "Plataforma Operativa 2026".
- Main headline: "Gestión Integral de Seguridad, Protección Civil y Capacitación".
- Value propositions with clean icon badges:
  * "Control en tiempo real de capacitaciones y constancias DC-3"
  * "Gestión de expedientes de Protección Civil y dictámenes"
  * "Sincronización bidireccional instantánea con AppSheet"
- Small trust indicator at bottom: "Desarrollo EG · Cumplimiento Normativo STPS".

Right Panel (Interactive Sign-In Form - 50% width):
- Clean white background (#ffffff) with crisp slate text (#15202b).
- Title: "Bienvenido" with subtitle "Accede con tu cuenta institucional para comenzar tu jornada laboral."
- Primary Action: Large, prominent "Continuar con Google" button with Google 'G' icon, styled with subtle border and elevation.
- Visual divider line: "o ingresar con credenciales de prueba"
- QA / Emergency Token Accordion/Field:
  * Input label: "Token de acceso QA / Auditoría"
  * Password input with lock icon: placeholder "Token de acceso temporal"
  * Button: "Validar Token QA"
- Information banner at the bottom: "Acceso exclusivo para personal autorizado y colaboradores."
- Footer links: "Soporte Técnico" · "Aviso de Privacidad" · "Estado de Servicios".
`;

async function main() {
  const project = stitch.project(projectId);
  console.log("Generating full desktop login page on project:", projectId);
  const screen = await project.generate(pagePrompt, "DESKTOP");
  console.log("Screen ID:", screen.id);
  console.log("Title:", screen.data?.title);
  console.log("Type:", screen.data?.screenType);

  const outputDir = path.resolve(process.cwd(), "stitch-output", "login-page");
  fs.mkdirSync(outputDir, { recursive: true });

  const htmlUrl = await screen.getHtml();
  if (htmlUrl) {
    const res = await fetch(htmlUrl);
    const html = await res.text();
    fs.writeFileSync(path.join(outputDir, "index.html"), html, "utf8");
    console.log("Saved full HTML to stitch-output/login-page/index.html");
  }

  const imageUrl = await screen.getImage();
  if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(path.join(outputDir, "preview.png"), buffer);
    console.log("Saved preview to stitch-output/login-page/preview.png");
  }
}

main().catch(console.error);

