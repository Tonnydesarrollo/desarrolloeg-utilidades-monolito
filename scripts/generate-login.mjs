import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { stitch } from "@google/stitch-sdk";

dotenv.config({ path: path.resolve(process.cwd(), ".env.stitch") });

const projectId = "12367790359575328546";

const loginPrompt = `
Design a modern, high-fidelity corporate login screen for "Desarrollo EG", an enterprise operations and civil protection compliance platform in Mexico.

Style & Theme:
- Clean, executive enterprise aesthetic with glassmorphism touches.
- Color palette: Deep Teal (#0f4c5c) as primary brand color, Crimson Red (#c0392b) as selective accent, clean background (#f0f4f8 with subtle radial gradients), crisp white cards with soft shadows (rgba(15, 76, 92, 0.08)).
- Typography: Elegant modern typography (Inter / Montserrat sans-serif), excellent contrast meeting WCAG AA standards.

Layout structure (Desktop split card layout):
1. Left / Brand Hero Column:
   - "Desarrollo EG" brand emblem/logo with badge "Plataforma Operativa 2026".
   - Headline: "Gestión Integral de Seguridad, Protección Civil y Capacitación".
   - Subtitle: "Control centralizado de capacitaciones STPS, constancias DC-3, pedidos comerciales y expedientes municipales y estatales."
   - Trust highlights:
     * Checkmark pill: "Sincronización en tiempo real con AppSheet"
     * Checkmark pill: "Cumplimiento normativo y auditoría de cambios"
     * Checkmark pill: "Acceso seguro institucional"

2. Right / Authentication Column:
   - Welcome heading: "Iniciar Sesión"
   - Helper text: "Accede con tu cuenta institucional para comenzar tu jornada."
   - Primary action: Prominent "Continuar con Google" button with Google 'G' icon, elegant hover state, high contrast.
   - Divider: "o acceso de pruebas internas"
   - Collapsible / secondary QA token card:
     * Label: "Token de acceso QA / Emergencia"
     * Input: Password field with placeholder "Introduce tu token de verificación"
     * Secondary button: "Validar token QA"
   - Error notification banner component example: "Aviso: Acceso restringido a colaboradores autorizados de Desarrollo EG."
   - Security footer: "Conexión segura SSL · Datos auditados · © 2026 Desarrollo EG".
`;

async function main() {
  console.log("Connecting to Stitch project:", projectId);
  const project = stitch.project(projectId);

  console.log("Generating Login screen on Stitch...");
  const screen = await project.generate(loginPrompt, "DESKTOP");
  console.log("Screen successfully generated!");
  console.log("Screen ID:", screen.id);
  console.log("Screen Data:", JSON.stringify(screen.data, null, 2));

  // Download HTML
  const outputDir = path.resolve(process.cwd(), "stitch-output", "login");
  fs.mkdirSync(outputDir, { recursive: true });

  const htmlUrl = await screen.getHtml();
  console.log("HTML URL:", htmlUrl);

  if (htmlUrl) {
    const res = await fetch(htmlUrl);
    const html = await res.text();
    const filePath = path.join(outputDir, "login.html");
    fs.writeFileSync(filePath, html, "utf8");
    console.log("Saved generated login HTML to:", filePath);
  }

  const imageUrl = await screen.getImage();
  console.log("Image URL:", imageUrl);
  if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const imgPath = path.join(outputDir, "login-preview.png");
    fs.writeFileSync(imgPath, buffer);
    console.log("Saved preview screenshot to:", imgPath);
  }
}

main().catch(err => {
  console.error("Error generating login screen:", err);
});

