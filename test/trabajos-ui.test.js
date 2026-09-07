import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const view = fs.readFileSync(new URL("../src/modules/trabajos/trabajos.ejs", import.meta.url), "utf8");
const shellCss = fs.readFileSync(new URL("../src/public/ui/portal-shell.css", import.meta.url), "utf8");

test("trabajos agrupa empresas contraidas y permite editar estatus y documentacion", () => {
  assert.match(view, /<details class="company-group">/);
  assert.doesNotMatch(view, /<details class="company-group" open/);
  assert.match(view, /data-status/);
  assert.match(view, /data-save-docs/);
  assert.match(view, /workTraining/);
});

test("el boton de menu permanece anclado a la esquina izquierda", () => {
  const menuRule = shellCss.match(/body\.portal-shell \.portal-app-menu \{[\s\S]*?\}/)?.[0] || "";
  assert.match(menuRule, /left:\s*18px/);
  assert.doesNotMatch(menuRule, /calc\(/);
});
