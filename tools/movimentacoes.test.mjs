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

const network = new Set(routes.map(route => route.origin));
const plane = airport => ({ prefix: "N12345", airport });
const arrival = (origin, destination, day, pilot) =>
  ({ prefix: "N12345", origin, destination, date: "2026-11-" + day, pilot });

test("a posição atual encerra o aviso mesmo quando o retorno ainda não consta no histórico", () => {
  const departure = arrival("AAAA", "ZZZZ", "10", "Primeiro");
  assert.equal(movements.outsideAircraft([plane("ZZZZ")], [departure], network)[0].arrival, departure);
  assert.equal(movements.outsideAircraft([plane("BBBB")], [departure], network).length, 0);
});

test("uma nova saída reabre o aviso somente para o voo da ocorrência atual", () => {
  const old = arrival("AAAA", "ZZZZ", "10", "Primeiro");
  const returned = arrival("ZZZZ", "BBBB", "11", "Retorno");
  const current = arrival("BBBB", "ZZZZ", "12", "Atual");
  const outside = movements.outsideAircraft([plane("ZZZZ")], [old, current, returned], network);
  assert.equal(outside.length, 1);
  assert.equal(outside[0].arrival, current);
  assert.equal(movements.outsideAircraft([plane("ZZZZ")], [old, returned], network)[0].arrival, null);
});

test("histórico incompleto ou ambíguo mantém o aviso da aeronave sem atribuir piloto", () => {
  const first = arrival("AAAA", "ZZZZ", "12", "Primeiro");
  const returned = arrival("ZZZZ", "BBBB", "12", "Retorno");
  const second = arrival("BBBB", "ZZZZ", "12", "Outro");
  for (const flights of [[], [first, returned], [first, second], [{ ...first, prefix: "N9999" }]]) {
    const outside = movements.outsideAircraft([plane("ZZZZ")], flights, network);
    assert.equal(outside.length, 1);
    assert.equal(outside[0].arrival, null);
  }
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
