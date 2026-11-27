import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fuelStats, percentageMonitor, publicSnapshot, revenueEstimates } from "../coletor/publicacao.mjs";
import { buildSnapshot } from "../coletor/dados.mjs";

// fuel: combustível utilizado no voo (as "lbs" do histórico do PilOps).
const flight = (date, revenue, fuel = 100, model = "Test Plane") => ({ pilot: "Piloto", prefix: "NABCDE", model,
  origin: "LEMD", destination: "KRDU", date, minutes: 60, nm: 3000, revenue, fuel });
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

test("variação compara o P$ por voo com a mediana anterior, sem publicar a referência absoluta", () => {
  const result = percentageMonitor([flight("2026-11-10", 180), flight("2026-11-09", 200)]);
  assert.equal(result.groups[0].change, -0.1); assert.equal(result.groups[0].state, "queda"); audit(result);
  // O combustível gasto não entra na conta: mesma receita com outro consumo continua estável.
  const stable = percentageMonitor([flight("2026-11-10", 200, 50), flight("2026-11-09", 200, 100)]);
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

test("voos antigos com o combustível em payload viram fuel no arquivo privado", () => {
  const { fuel, ...legacy } = flight("2026-11-09", 200, 1234);
  const raw = buildSnapshot({ ...base, flights: [{ ...legacy, payload: 1234 }] }, null).snapshot;
  assert.equal(raw.flights[0].fuel, 1234); assert.equal("payload" in raw.flights[0], false);
  const next = buildSnapshot({ ...base, flights: [flight("2026-11-10", 180, 999)] }, { ...raw, flights: [{ ...legacy, payload: 1234 }] }).snapshot;
  assert.deepEqual(next.flights.map(f => f.fuel), [999, 1234]);
  assert.ok(next.flights.every(f => !("payload" in f)));
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
    perFlight: 200, perHour: 200 });
  const model = result.models.find(item => item.model === "Test Plane");
  assert.deepEqual({ ...model }, { model: "Test Plane", count: 3, perNm: 0.07, perHour: 200 });
  const text = JSON.stringify(result);
  assert.ok(!text.includes("Piloto") && !text.includes("2026-11") && !text.includes("NABCDE"));
  audit(result);
  const many = Array.from({ length: 12 }, (_, i) => flight("2026-10-" + String(10 + i), i < 2 ? 1000 : 100));
  assert.equal(revenueEstimates(many).routes[0].count, 10);
  assert.equal(revenueEstimates(many).routes[0].perFlight, 100);
});

test("consumo publicado vem do combustível utilizado, sem voo, piloto ou data", () => {
  const flights = [flight("2026-11-10", 300, 9000), flight("2026-11-09", 100, 12000), flight("2026-11-08", 0, 6000),
    { ...flight("2026-11-07", 200, 500), minutes: 20 }, flight("2026-11-06", 400, 30000, "Outro modelo")];
  const result = fuelStats(flights);
  const model = result.models.find(item => item.model === "Test Plane");
  // Traslado entra no consumo do modelo; voo de menos de 30 minutos não.
  assert.deepEqual({ ...model }, { model: "Test Plane", count: 3, perHour: 9000, perNm: 3 });
  const route = result.routes.find(item => item.model === "Test Plane");
  // Na rota, só voos pagos (inclusive o curto): mediana de 500, 9000 e 12000.
  assert.deepEqual({ ...route }, { origin: "LEMD", destination: "KRDU", model: "Test Plane", count: 3, fuel: 9000 });
  assert.equal(fuelStats([{ ...flight("2026-11-10", 100), fuel: undefined, payload: 4321 }]).routes[0].fuel, 4321);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("Piloto") && !text.includes("2026-11") && !text.includes("NABCDE"));
  audit(result);
});

test("sincronização do dono: publica voos novos sem receita e o coletor do Rafael os junta ao histórico", async () => {
  const { withPublished } = await import("../coletor/dados.mjs");
  const privateSnapshot = buildSnapshot({ ...base, flights: [flight("2026-11-10", 200, 90)] }, null, new Date("2026-11-10T12:00:00Z")).snapshot;
  const published = publicSnapshot(privateSnapshot);
  // O dono lê a Vortex (com o P$ e o combustível que a página mostra) partindo do dados.json público, como em extensao-astro/servico.js.
  const owner = buildSnapshot({ ...base, flights: [flight("2026-11-11", 210, 95), flight("2026-11-10", 200, 90)] }, published,
    new Date("2026-11-11T12:00:00Z"));
  assert.ok(owner);
  const ownerPublished = publicSnapshot(owner.snapshot);
  audit(ownerPublished);
  assert.ok(ownerPublished.flights.every(item => !("fuel" in item) && !("revenue" in item)));
  assert.deepEqual(ownerPublished.flights.map(item => item.date).sort(), ["2026-11-10", "2026-11-11"]);
  // O Rafael sincroniza depois: o voo do dono entra no histórico privado sem P$, e o antigo continua com o P$.
  const merged = withPublished(privateSnapshot, ownerPublished);
  assert.equal(merged.flights.length, 2);
  assert.equal(merged.flights.find(item => item.date === "2026-11-10").revenue, 200);
  assert.ok(!("revenue" in merged.flights.find(item => item.date === "2026-11-11")));
  // Se o voo ainda estiver entre os 10 últimos, a nova leitura devolve o P$ a ele.
  const reread = buildSnapshot({ ...base, flights: [flight("2026-11-11", 210, 95)] }, merged, new Date("2026-11-11T13:00:00Z")).snapshot;
  assert.equal(reread.flights.filter(item => item.date === "2026-11-11").length, 1);
  assert.equal(reread.flights.find(item => item.date === "2026-11-11").revenue, 210);
});
