import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildSnapshot } from "../coletor/dados.mjs";

const data = {
  reportedFleet: 1, fleet: [{ prefix: "NABCDE", model: "Test Plane", airport: "LEMD", base: "LEMD", status: "Em uso" }],
  hubs: ["LEMD"], routes: [{ origin: "LEMD", destination: "KRDU", code: "VTX0001" }], flights: [],
};
const flight = { origin: "LEMD", destination: "KRDU", pilot: "Piloto", model: "Test Plane", status: "Em voo" };
const oldDay = new Date("2026-11-10T12:00:00Z");
const newDay = new Date("2026-11-10T12:10:00Z");
const activity = vm.runInNewContext(readFileSync(new URL("../docs/atividade.js", import.meta.url), "utf8") + "\nVortexActivity;");

test("voos em andamento ficam separados do histórico e não entram no contador de concluídos", () => {
  const built = buildSnapshot({ ...data, activeFlights: [flight] }, null, oldDay);
  assert.equal(built.snapshot.activeFlights.length, 1);
  assert.equal(built.snapshot.flights.length, 0);
  assert.equal(built.snapshot.activeFlightsCapturedAt, oldDay.toISOString());
  assert.equal(built.report.activeFlightsRead, true);
});

test("falha ou leitura parcial conserva a lista anterior e seu horário; zero validado a limpa", () => {
  const previous = buildSnapshot({ ...data, activeFlights: [flight] }, null, oldDay).snapshot;
  for (const invalid of [undefined, null, [{ ...flight, origin: "" }], [flight, flight]]) {
    const built = buildSnapshot({ ...data, activeFlights: invalid }, previous, newDay);
    assert.deepEqual(built.snapshot.activeFlights, [flight]);
    assert.equal(built.snapshot.activeFlightsCapturedAt, oldDay.toISOString());
  }
  const cleared = buildSnapshot({ ...data, activeFlights: [] }, previous, newDay);
  assert.deepEqual(cleared.snapshot.activeFlights, []);
  assert.equal(cleared.snapshot.activeFlightsCapturedAt, newDay.toISOString());
});

test("após vinte minutos o voo deixa de ser apresentado como informação recente", () => {
  assert.equal(activity.liveState(oldDay.toISOString(), new Date("2026-11-10T12:20:00Z")), "recent");
  assert.equal(activity.liveState(oldDay.toISOString(), new Date("2026-11-10T12:20:01Z")), "stale");
  assert.equal(activity.liveState(null, newDay), "unknown");
  assert.equal(activity.liveState("inválido", newDay), "unknown");
  assert.equal(activity.liveState("2026-11-11T12:00:00Z", newDay), "unknown");
});

test("leitor da visão geral confere total, pares de aeroporto e nome antes de aceitar", () => {
  const source = readFileSync(new URL("../coletor/extensao-chrome/coletor.js", import.meta.url), "utf8");
  const state = { expected: 1, origin: "LEMD -> KRDU" };
  const card = { get innerText() { return state.origin + "\n@Piloto - Test Plane\nRastrear\n1h 5m\nEm voo"; },
    querySelectorAll: () => [{ get innerText() { return state.origin; } }, { innerText: "@Piloto - Test Plane" }] };
  const panel = { get innerText() { return state.expected + " ativos"; }, querySelectorAll: () => state.expected === 0 ? [] : [card] };
  const document = { body: { innerText: "" }, querySelectorAll: selector => selector === "h1" ? [{ innerText: "Vortex Airways" }]
    : selector === '[role="tab"]' ? [{ innerText: "Visão Geral", getAttribute: () => "true" }]
    : selector === "h3" ? [{ innerText: "Voos ao vivo", closest: () => panel }] : [] };
  const location = { origin: "https://pilops.com", pathname: "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1" };
  const read = vm.runInNewContext(source.slice(0, source.indexOf("async function section(")) + "\nreadCompany;", { document, location });
  assert.equal(read("Visão Geral", false).length, 1);
  state.expected = 2;
  assert.equal(read("Visão Geral", false), null);
  state.expected = 1; state.origin = "Rota incompleta";
  assert.equal(read("Visão Geral", false), null);
  state.expected = 0;
  assert.equal(read("Visão Geral", false).length, 0);
});
