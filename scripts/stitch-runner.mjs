import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { stitch } from "@google/stitch-sdk";

// Load .env.stitch if exists
const envStitchPath = path.resolve(process.cwd(), ".env.stitch");
if (fs.existsSync(envStitchPath)) {
  dotenv.config({ path: envStitchPath });
}

export async function getOrCreateProject(title = "Desarrollo EG - Portal Redesign") {
  const projects = await stitch.projects();
  let project = projects.find((p) => p.data?.title === title || p.data?.name === title);
  if (!project) {
    console.log(`Creating project "${title}" in Stitch...`);
    project = await stitch.createProject(title);
    console.log(`Project created successfully with ID: ${project.id}`);
  } else {
    console.log(`Found existing project "${title}" (ID: ${project.id})`);
  }
  return project;
}

export async function generateScreen({ project, title, prompt, deviceType = "DESKTOP" }) {
  console.log(`Generating screen "${title}" on project ${project.id}...`);
  console.log(`Prompt: ${prompt.slice(0, 150)}...`);
  const screen = await project.generate(prompt, deviceType);
  console.log(`Screen generated with ID: ${screen.id}`);
  return screen;
}

export async function downloadScreenHtml(screen, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const htmlUrl = await screen.getHtml();
  console.log(`HTML Download URL: ${htmlUrl}`);
  if (htmlUrl) {
    const res = await fetch(htmlUrl);
    const text = await res.text();
    const filePath = path.join(outputDir, `${screen.id}.html`);
    fs.writeFileSync(filePath, text, "utf8");
    console.log(`Saved HTML to ${filePath}`);
    return { filePath, text };
  }
  return null;
}

// CLI runner
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const action = process.argv[2] || "list";
  if (action === "list") {
    const projects = await stitch.projects();
    console.log("Stitch Projects:", projects.map(p => ({ id: p.id, title: p.data?.title || p.data?.name })));
  } else if (action === "create") {
    const title = process.argv[3] || "Desarrollo EG - Portal Redesign";
    const proj = await getOrCreateProject(title);
    console.log("Ready:", proj.id);
  }
}

