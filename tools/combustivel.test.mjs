import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const fuel = vm.runInNewContext(readFileSync(new URL("../docs/combustivel.js", import.meta.url), "utf8") + "\nVortexFuel;");
const fleet = JSON.parse(readFileSync(new URL("../docs/dados.json", import.meta.url), "utf8")).fleet;

test("toda aeronave da frota publicada tem ficha de combustível", () => {
  for (const plane of fleet) assert.ok(fuel.info(plane.model), "sem ficha: " + plane.model);
});

test("previsão soma viagem e 45 minutos de reserva, arredondando para cima", () => {
  const md11 = fuel.estimate("Douglas MD-11", 315); // 17.500 lb/h × 6 h = 105.000
  assert.equal(md11.fuel, 105000);
  assert.equal(md11.overTank, false);
  assert.equal(fuel.estimate("Embraer E195", 61).fuel, 8500); // 4.800 × 106/60 = 8.480
  assert.equal(fuel.estimate("Embraer E195", 600).overTank, true);
  assert.equal(fuel.estimate("Modelo desconhecido", 60), null);
  assert.equal(fuel.estimate("Douglas MD-11", null), null);
});
