import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const times = vm.runInNewContext(readFileSync(new URL("../docs/tempos.js", import.meta.url), "utf8") + "\nVortexTimes;");
const plane = { model: "Boeing 787-10 Dreamliner" };
const flight = (minutes, extra = {}) => ({ origin: "LEMD", destination: "KRDU", model: plane.model,
  date: "2026-11-10", minutes, ...extra });
const args = { origin: "LEMD", destination: "KRDU", plane, miles: 3450, performance: { speed: 488 } };

test("usa duração concluída no PilOps, com quantidade e data da referência", () => {
  const result = times.estimate({ ...args, flights: [flight(525)] });
  assert.equal(result.minutes, 525); assert.equal(result.source, "pilops");
  assert.equal(result.count, 1); assert.equal(result.lastDate, "2026-11-10");
});

test("não mistura direção, rota ou variante de aeronave", () => {
  for (const change of [{ origin: "KRDU", destination: "LEMD" }, { destination: "EFHK" },
    { model: "Boeing 787-9 Dreamliner" }, { model: "Douglas MD-11" }]) {
    assert.equal(times.estimate({ ...args, flights: [flight(525, change)] }).source, "catalog");
  }
  assert.equal(times.estimate({ ...args, flights: [flight(525, { model: "  BOEING  787-10 DREAMLINER " })] }).source, "pilops");
});

test("mediana reduz efeito de um voo excepcional e calcula número par de amostras", () => {
  assert.equal(times.estimate({ ...args, flights: [flight(500), flight(510), flight(2000)] }).minutes, 510);
  assert.equal(times.estimate({ ...args, flights: [flight(500), flight(511)] }).minutes, 506);
});

test("limita aos dez voos mais recentes sem alterar o histórico original", () => {
  const flights = Array.from({ length: 11 }, (_, index) => flight(index ? 500 : 2000,
    { date: "2026-11-" + String(index + 1).padStart(2, "0") }));
  const original = JSON.stringify(flights);
  const result = times.estimate({ ...args, flights });
  assert.equal(result.minutes, 500); assert.equal(result.count, 10); assert.equal(result.lastDate, "2026-11-11");
  assert.equal(JSON.stringify(flights), original);
});

test("ignora durações e datas inválidas; traslados concluídos também servem de referência", () => {
  const invalid = [0, null, -1, "525", NaN, Infinity, 2881].map(value => flight(value));
  invalid.push(flight(525, { date: "2026-02-30" }), null);
  assert.equal(times.estimate({ ...args, flights: invalid }).source, "catalog");
  assert.equal(times.estimate({ ...args, flights: [...invalid, flight(525, { paid: false })] }).minutes, 525);
});

test("histórico dispensa coordenadas ou perfil; sem histórico não inventa duração", () => {
  assert.equal(times.estimate({ ...args, miles: null, performance: null, flights: [flight(525)] }).minutes, 525);
  for (const change of [{ plane: null }, { performance: null }, { miles: null }, { performance: { speed: 0 } }]) {
    assert.equal(times.estimate({ ...args, ...change }).minutes, null);
  }
  assert.equal(times.estimate(args).source, "catalog");
});

test("planos somam cada trecho e identificam combinação de PilOps com catálogo", () => {
  const actual = times.estimate({ ...args, flights: [flight(525)] }), fallback = times.estimate(args);
  const mixed = times.summary([actual, fallback]);
  assert.equal(mixed.minutes, actual.minutes + fallback.minutes); assert.equal(mixed.source, "mixed");
  assert.equal(mixed.count, 1); assert.equal(times.summary([actual]).source, "pilops");
  assert.equal(times.summary([actual, { minutes: null, source: "catalog" }]).minutes, null);
  assert.equal(times.summary([]).minutes, null);
});

test("registros conferidos preservam referências diferentes para 787-10 e MD-11", () => {
  const data = JSON.parse(readFileSync(new URL("../docs/dados.json", import.meta.url), "utf8"));
  const known = data.flights.filter(f => f.origin === "LEMD" && f.destination === "KRDU" &&
    (f.date === "2026-11-10" && f.pilot === "Titanocs" || f.date === "2026-11-07" && f.pilot === "astronauta"));
  assert.equal(times.estimate({ ...args, flights: known }).minutes, 525);
  assert.equal(times.estimate({ ...args, flights: known, plane: { model: "Douglas MD-11" } }).minutes, 507);
});

test("interface remove importação e consultas SimBrief", () => {
  const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../docs/planner.js", import.meta.url), "utf8");
  assert.ok(!/simbrief|Pilot ID|Importar último plano/i.test(html));
  assert.ok(!/xml.fetcher|tempos-simbrief.json|renderSimBrief|loadSimBrief/.test(planner));
});
