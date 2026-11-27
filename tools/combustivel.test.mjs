import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const fuel = vm.runInNewContext(readFileSync(new URL("../docs/combustivel.js", import.meta.url), "utf8") + "\nVortexFuel;");
const fleet = JSON.parse(readFileSync(new URL("../docs/dados.json", import.meta.url), "utf8")).fleet;

test("toda aeronave da frota publicada tem ficha de combustível", () => {
  for (const plane of fleet) assert.ok(fuel.info(plane.model), "sem ficha: " + plane.model);
});

test("sem histórico, previsão usa o catálogo: viagem + 45 minutos de reserva, arredondando para cima", () => {
  const md11 = fuel.estimate("Douglas MD-11", 315); // 17.500 lb/h × 6 h = 105.000
  assert.equal(md11.fuel, 105000);
  assert.equal(md11.overTank, false); assert.equal(md11.source, "catalogue");
  assert.equal(fuel.estimate("Embraer E195", 61).fuel, 8500); // 4.800 × 106/60 = 8.480
  assert.equal(fuel.estimate("Embraer E195", 600).overTank, true);
  assert.equal(fuel.estimate("Modelo desconhecido", 60), null);
  assert.equal(fuel.estimate("Douglas MD-11", null), null);
});

test("histórico da Vortex vale antes do catálogo: gasto da rota, depois consumo medido", () => {
  const model = { perHour: 12000, count: 30 };
  const route = fuel.estimate("Douglas MD-11", 315, { route: { fuel: 70000, count: 10 }, model });
  assert.equal(route.fuel, 79000); assert.equal(route.source, "route"); assert.equal(route.count, 10); // 70.000 + 9.000
  const measured = fuel.estimate("Douglas MD-11", 315, { model });
  assert.equal(measured.fuel, 72000); assert.equal(measured.source, "model"); assert.equal(measured.burn, 12000); // 12.000 × 6 h
  assert.equal(fuel.estimate("Douglas MD-11", 315, { model: { perHour: 0, count: 1 } }).source, "catalogue");
  const unknown = fuel.estimate("Modelo novo", 60, { model: { perHour: 6000, count: 2 } });
  assert.equal(unknown.fuel, 10500); assert.equal(unknown.tank, null); assert.equal(unknown.overTank, false);
});

test("tanque e limite combinado seguem o Mercado de Aeronaves do PilOps", () => {
  const md11 = fuel.info("Douglas MD-11");
  assert.equal(md11.tank, 256900); assert.equal(md11.limit, 361323);
  for (const plane of fleet) { const item = fuel.info(plane.model); assert.ok(item.limit > item.tank, plane.model); }
});
