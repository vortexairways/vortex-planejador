import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { percentageMonitor, publicSnapshot, revenueEstimates } from "../coletor/publicacao.mjs";
import { buildSnapshot } from "../coletor/dados.mjs";

const flight = (date, revenue, payload = 100, model = "Test Plane") => ({ pilot: "Piloto", prefix: "NABCDE", model,
  origin: "LEMD", destination: "KRDU", date, minutes: 60, nm: 3000, revenue, payload });
const base = { capturedAt: "2026-11-10T12:00:00Z", reportedFleet: 1,
  fleet: [{ prefix: "NABCDE", model: "Test Plane", airport: "LEMD", base: "LEMD", status: "Disponivel" }],
  hubs: ["LEMD"], routes: [{ origin: "LEMD", destination: "KRDU", code: "VTX0001" }], pilots: [], flights: [],
};
const forbidden = new Set(["revenue", "payload", "price", "activeFlights", "activeFlightsCapturedAt", "balance", "value", "reference"]);
function audit(value) {
  if (Array.isArray(value)) return value.forEach(audit);
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbidden.has(key), "campo privado publicado: " + key); audit(child);
  }
}

test("JSON público exclui valores, cargas, voos em andamento e campos imprevistos", () => {
  const source = { ...base, balance: 9876543.21, activeFlights: [{ pilot: "Sigilo" }], activeFlightsCapturedAt: base.capturedAt,
    flights: [flight("2026-11-10", 53123.47)] };
  const safe = publicSnapshot(source);
  audit(safe);
  assert.equal(safe.flights.length, 1); assert.equal(safe.flights[0].paid, true);
  assert.ok(!JSON.stringify(safe).includes("53123.47"));
  assert.ok(!JSON.stringify(safe).includes("Sigilo"));
});

test("variação ajusta pela carga e usa a mediana anterior, sem publicar a referência absoluta", () => {
  const result = percentageMonitor([flight("2026-11-10", 180), flight("2026-11-09", 200)]);
  assert.equal(result.groups[0].change, -0.1); assert.equal(result.groups[0].state, "queda"); audit(result);
  const stable = percentageMonitor([flight("2026-11-10", 100, 50), flight("2026-11-09", 200, 100)]);
  assert.equal(stable.groups[0].change, 0);
  const rise = percentageMonitor([flight("2026-11-10", 240), flight("2026-11-09", 200)]);
  assert.equal(rise.groups[0].change, 0.2); assert.equal(rise.groups[0].state, "alta");
});

test("comparações não misturam modelos nem incluem traslados sem receita", () => {
  const result = percentageMonitor([flight("2026-11-10", 0), flight("2026-11-09", 200), flight("2026-11-08", 100, 100, "Outro modelo")]);
  assert.equal(result.readCount, 2); assert.equal(result.groups.length, 2);
  assert.ok(result.groups.every(group => group.change === null && group.state === "unico"));
});

test("uma coleta posterior não recoloca valores financeiros nem voos em andamento na publicação", () => {
  const raw = buildSnapshot({ ...base, flights: [flight("2026-11-09", 200)] }, null).snapshot;
  const next = buildSnapshot({ ...base, activeFlights: [{ pilot: "Sigilo" }], flights: [flight("2026-11-10", 180)] }, raw).snapshot;
  const safe = publicSnapshot(next); audit(safe);
  assert.equal(safe.flights.length, 2); assert.equal(safe.revenueMonitor.groups[0].change, -0.1);
  assert.equal(next.flights[0].revenue, 180); assert.equal("activeFlights" in next, false);
});

test("sem cache local, reler um voo já público o enriquece sem duplicar o histórico", () => {
  const previous = publicSnapshot({ ...base, flights: [flight("2026-11-09", 200)] });
  const next = buildSnapshot({ ...base, flights: [flight("2026-11-09", 200), flight("2026-11-10", 180)] }, previous);
  assert.equal(next.snapshot.flights.length, 2); assert.equal(next.report.flightsAdded, 1);
  audit(publicSnapshot(next.snapshot));
});

test("catálogo publicado não contém preços e a interface não oferece valores ou voos em andamento", () => {
  const catalog = readFileSync(new URL("../docs/aeronaves.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
  const planner = readFileSync(new URL("../docs/planner.js", import.meta.url), "utf8");
  assert.ok(!catalog.includes("price") && !catalog.includes("P$"));
  assert.ok(!html.includes('id="live-card"'));
  assert.ok(!planner.includes("flight.revenue") && !planner.includes("flight.payload") && !planner.includes("money("));
});

test("renda estimada publica só medianas por rota e modelo, sem piloto, data ou voo individual", () => {
  const flights = [flight("2026-11-10", 300, 100), flight("2026-11-09", 100, 100), flight("2026-11-08", 200, 50),
    flight("2026-11-07", 0, 100), flight("2026-11-06", 900, 100, "Outro modelo")];
  const result = revenueEstimates(flights);
  const route = result.routes.find(item => item.model === "Test Plane");
  assert.deepEqual({ ...route }, { origin: "LEMD", destination: "KRDU", model: "Test Plane", count: 3,
    perFlight: 200, perHour: 200, perLb: 3, lbs: 100 });
  const model = result.models.find(item => item.model === "Test Plane");
  assert.equal(model.perLbNm, 0.001); assert.equal(model.lbs, 100);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("Piloto") && !text.includes("2026-11") && !text.includes("NABCDE"));
  audit(result);
  const many = Array.from({ length: 12 }, (_, i) => flight("2026-10-" + String(10 + i), i < 2 ? 1000 : 100));
  assert.equal(revenueEstimates(many).routes[0].count, 10);
  assert.equal(revenueEstimates(many).routes[0].perFlight, 100);
});
