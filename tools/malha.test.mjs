import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../docs/malha.js", import.meta.url), "utf8");
const network = vm.runInNewContext(source + "\nVortexNetwork;");
const route = (origin, destination) => ({ origin, destination, code: "VTX1000" });
const outward = route("LTAI", "OTHH");
const reverse = route("OTHH", "LTAI");
const connection = [route("OTHH", "LEMD"), route("LEMD", "LTAI")];
const distances = new Map([
  ["LTAI-OTHH", 1273], ["LEMD-OTHH", 2878], ["LEMD-LTAI", 1615],
  ["EFHK-OTHH", 2426], ["EFHK-LTAI", 1400],
]);
const distance = (from, to) => distances.get([from, to].sort().join("-")) ?? null;
const kinds = options => Array.from(options, option => option.kind);

test("ida e volta oferece a inversa cadastrada e uma conexão de menor distância", () => {
  const viaHelsinki = [route("OTHH", "EFHK"), route("EFHK", "LTAI")];
  const { options } = network.returnOptions(outward, [outward, reverse, ...connection, ...viaHelsinki], distance);
  assert.deepEqual(kinds(options), ["direct", "connection"]);
  assert.equal(network.pathLabel(options[1].legs), "LTAI → OTHH → EFHK → LTAI");
});

test("sem volta direta, respeita o alcance em cada trecho e identifica o traslado", () => {
  const { options, reverse: registered } = network.returnOptions(outward, [outward, ...connection], distance, (_, miles) => miles <= 2000);
  assert.equal(registered, undefined);
  assert.deepEqual(kinds(options), ["ferry"]);
  assert.equal(options[0].legs.at(-1).code, "Traslado");
  assert.equal(network.pathLabel(options[0].legs), "LTAI → OTHH → LTAI");
  assert.equal(network.returnOptions(outward, [outward], distance, (_, miles) => miles < 1273).options.length, 0);
});

test("nova ligação fecha apenas circuitos que a utilizam e respeita o sentido das rotas", () => {
  const extra = route("LEMD", "OTHH");
  const routes = [outward, extra];
  const completed = network.newCircuits(reverse, routes, distance);
  assert.equal(completed.length, 1);
  assert.equal(network.pathLabel(completed[0]), "OTHH → LTAI → OTHH");
  assert.equal(network.newCircuits(reverse, [extra], distance).length, 0);
  assert.equal(routes.length, 2);
});

test("Congonhas destaca o código dos modelos revisados na chegada e na partida", () => {
  assert.equal(network.airportReview(route("SBSP", "LTAI"), "Boeing 787-10 Dreamliner").code, "E");
  assert.equal(network.airportReview(route("LTAI", "SBSP"), "Airbus A330neo").code, "E");
  assert.equal(network.airportReview(route("LTAI", "SBSP"), "McDonnell Douglas MD-11").code, "D");
  assert.equal(network.airportReview(route("LTAI", "SBSP"), "Airbus A320neo").code, null);
  assert.equal(network.airportReview(outward, "Airbus A330"), null);
});

test("link compartilhado preserva o traslado e rejeita trechos inválidos ou desconexos", () => {
  const known = code => ["LTAI", "OTHH", "LEMD"].includes(code);
  const parse = (value, from = "LTAI", to = "OTHH") =>
    network.readSharedPlan(value, [outward, ...connection], from, to, known);
  assert.equal(parse("LTAI-OTHH,F:OTHH-LTAI")[1].code, "Traslado");
  assert.equal(parse("F:OTHH-LTAI", "OTHH", "LTAI")[0].code, "Traslado");
  assert.equal(parse("LTAI-OTHH,OTHH-LEMD,LEMD-LTAI")[2], connection[1]);
  for (const invalid of ["LTAI-OTHH,F:LEMD-LTAI", "LTAI-OTHH,OTHH-LTAI", "LTAI-OTHH,F:OTHH-ZZZZ"]) {
    assert.equal(parse(invalid), null);
  }
});
