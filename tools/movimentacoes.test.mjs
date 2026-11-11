import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const movements = vm.runInNewContext(readFileSync(new URL("../docs/movimentacoes.js", import.meta.url), "utf8") + "\nVortexMovements;");
const routes = [{ origin: "AAAA", destination: "BBBB" }, { origin: "BBBB", destination: "CCCC" }];
const classify = (origin, destination) => movements.classify({ origin, destination }, routes);

test("retorno de fora da malha para aeroporto com rota recebe aprovação", () => {
  assert.equal(classify("ZZZZ", "AAAA"), "return");
});

test("voo que deixa aeronave fora da malha recebe advertência", () => {
  assert.equal(classify("AAAA", "ZZZZ"), "outside");
  assert.equal(classify("YYYY", "ZZZZ"), "outside");
});

test("traslado entre aeroportos da malha é neutro", () => {
  assert.equal(classify("BBBB", "AAAA"), "reposition");
});

test("rota cadastrada não recebe advertência, mesmo em destino sem rota de partida", () => {
  assert.equal(classify("AAAA", "BBBB"), "registered");
  assert.equal(classify("BBBB", "CCCC"), "registered");
});

test("chegar a destino sem rota de partida não basta para ser retorno útil à malha", () => {
  assert.equal(classify("ZZZZ", "CCCC"), "outside");
});

test("regressão: os dois resgates de Titanocs recebem aprovação e ficam fora das advertências", () => {
  const data = JSON.parse(readFileSync(new URL("../docs/dados.json", import.meta.url), "utf8"));
  for (const [origin, destination] of [["DAAG", "LPMT"], ["OSDI", "OTHH"]]) {
    const flight = data.flights.find(f => f.pilot === "Titanocs" && f.origin === origin && f.destination === destination);
    assert.ok(flight, `Voo de retorno ${origin} → ${destination} presente no histórico`);
    assert.equal(movements.classify(flight, data.routes), "return");
  }
  const outgoing = data.flights.find(f => f.origin === "LEMD" && f.destination === "LEXJ");
  assert.ok(outgoing);
  assert.equal(movements.classify(outgoing, data.routes), "outside");
});
