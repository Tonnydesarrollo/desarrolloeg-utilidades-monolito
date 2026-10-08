import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { stitch } from "@google/stitch-sdk";

dotenv.config({ path: path.resolve(process.cwd(), ".env.stitch") });

const projectId = "12367790359575328546";

const dashboardPrompt = `
Full desktop web application screen: Main Operational Executive Dashboard for "Desarrollo EG" (Operations, Training & Civil Protection Platform).

Visual Style & Tokens:
- Modern executive dashboard, light mode with glassmorphic clean panels.
- Palette: Deep Teal (#0f4c5c) as brand primary, Crimson Red (#c0392b) as alert/action accent, clean canvas (#f4f7fb), white cards with subtle borders (#e2e8f0) and soft shadows.
- Typography: Inter for clean UI metrics and labels, Montserrat for prominent headers.

Screen Structure (1440px desktop):

1. Top Navigation Bar (Header):
   - Left: "Desarrollo EG" brand logo + subtitle "Plataforma Operativa".
   - Center context: "Calendario y Operaciones en Campo".
   - Right:
     * Live SSE Status Badge: Green pulsating dot + label "En vivo · Sincronizado" (representing real-time connection to AppSheet & SQLite).
     * Quick manual refresh button with sync icon: "Actualizar datos".
     * User profile pill: Avatar circle, user name "Jesús Morales", role badge "Coordinador Operativo", and "Cerrar sesión" link.

2. Module Navigation Bar (Primary Operational Tabs):
   - Tab 1 (Active): "Calendario" (with calendar icon)
   - Tab 2: "Capacitaciones" (with school icon)
   - Tab 3: "Constancias DC-3" (with badge/diploma icon)
   - Tab 4: "Empresas y Sucursales" (with store/building icon)
   - Tab 5: "Pedidos" (with shopping_cart/receipt icon)
   - Tab 6: "Cotizaciones" (with calculate/price icon)
   - Tab 7: "Protección Civil y Trabajos" (with shield icon)
   - Tab 8: "Notas y Avisos" (with sticky_note icon)

3. Executive Metric KPI Row (4 Stat Cards):
   - Card 1: "Capacitaciones del Mes" -> Number "139", detail "+12 vs mes anterior", badge "En curso".
   - Card 2: "Pedidos sin Liberación" -> Number "8", detail "Requieren revisión en Casa Ley", tone amber alert.
   - Card 3: "Expedientes de Protección Civil" -> Number "94%", detail "Avance general en sucursales", tone emerald ok.
   - Card 4: "Sync Local AppSheet" -> Label "Activa", detail "Latencia <10ms · SQLite local", tone teal.

4. Main Content Area (Two Columns: 70% Calendar + 30% Operational Sidebar):
   - Left 70%: Interactive Monthly Calendar Grid (October 2026).
     * Calendar toolbar: Month title "Octubre 2026", view switcher buttons ("Mes", "Semana", "Agenda"), employee filter dropdown ("Todos los capacitadores").
     * Calendar day cells showing scheduled training chips colored by instructor (e.g. "Casa Ley Plaza Culiacán - Primeros Auxilios", "Walmart Tres Ríos - Evacuación", "Soriana Zapata - Contra Incendios").
     * Today highlighted with active border.
   - Right 30%: "Detalle de Operación y Tareas Prioritarias"
     * Selected event card preview: Training name, company logo, branch address, trainer name, 24 attendees registered.
     * Quick action buttons: "Generar Constancias DC-3", "Abrir Carpeta Drive", "Editar Nota".
     * Urgent alerts list: 2 items needing attention (e.g. "Dictamen pendiente en Sucursal Mazatlán Norte", "Reenvío de pedido #4092").
`;

async function main() {
  const project = stitch.project(projectId);
  console.log("Generating Operational Dashboard screen on project:", projectId);
  const screen = await project.generate(dashboardPrompt, "DESKTOP");
  console.log("Dashboard screen generated!");
  console.log("Screen ID:", screen.id);
  console.log("Title:", screen.data?.title);

  const outputDir = path.resolve(process.cwd(), "stitch-output", "dashboard-page");
  fs.mkdirSync(outputDir, { recursive: true });

  const htmlUrl = await screen.getHtml();
  if (htmlUrl) {
    const res = await fetch(htmlUrl);
    const html = await res.text();
    fs.writeFileSync(path.join(outputDir, "index.html"), html, "utf8");
    console.log("Saved Dashboard HTML to stitch-output/dashboard-page/index.html");
  }

  const imageUrl = await screen.getImage();
  if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(path.join(outputDir, "preview.png"), buffer);
    console.log("Saved Dashboard preview to stitch-output/dashboard-page/preview.png");
  }
}

main().catch(console.error);

