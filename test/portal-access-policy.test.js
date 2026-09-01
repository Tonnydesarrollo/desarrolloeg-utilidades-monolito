import assert from "node:assert/strict";
import test from "node:test";
import {
  canUsePortalView,
  canViewAllForPortalView,
  resolvePortalAccessProfile,
} from "../src/modules/home/portalAccessPolicy.js";

test("perfiles administrativos conservan alcance global segun puesto", () => {
  const director = resolvePortalAccessProfile({ puesto: "DIRECTOR GENERAL" });
  const mejora = resolvePortalAccessProfile({ puesto: "MEJORA CONTINUA" });
  const gerente = resolvePortalAccessProfile({ puesto: "GERENTE GENERAL" });

  assert.equal(director.role, "admin");
  assert.equal(director.allPermissions, true);
  assert.equal(mejora.role, "admin");
  assert.equal(mejora.allPermissions, true);
  assert.equal(gerente.role, "admin");
  assert.equal(gerente.allPermissions, false);
  assert.equal(canUsePortalView({ accessProfile: gerente }, "calendario", "edit"), true);
  assert.equal(canUsePortalView({ accessProfile: gerente }, "calendario", "delete"), false);
  assert.equal(canViewAllForPortalView({ accessProfile: gerente }, "calendario"), true);
});

test("capacitador queda limitado a vistas propias salvo informacion de sucursales y lectura de notas", () => {
  const profile = resolvePortalAccessProfile({ puesto: "CAPACITADOR" });
  const user = { accessProfile: profile };

  assert.equal(profile.role, "capacitador");
  assert.equal(canUsePortalView(user, "capacitaciones", "edit"), true);
  assert.equal(canViewAllForPortalView(user, "capacitaciones"), false);
  assert.equal(canUsePortalView(user, "constancias-faltantes", "create"), false);
  assert.equal(canUsePortalView(user, "crear constancias por capacitador", "create"), true);
  assert.equal(canViewAllForPortalView(user, "informacion de sucursales"), true);
  assert.equal(canUsePortalView(user, "notas", "delete"), true);
  assert.equal(canViewAllForPortalView(user, "notas"), true);
});
