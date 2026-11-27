import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const load = vm.runInNewContext(readFileSync(new URL("../docs/cargas.js", import.meta.url), "utf8") + "\nVortexLoad;");
const base = {
  limit: 15, fuel: 4, tank: 5, seatLimit: 2, loadedWeight: 1, loadedSeats: 1,
  loadedPayout: 4, costs: 8, minutes: 120, text: "",
};

test("compara combinações inteiras e supera a seleção só por valor por peso", () => {
  const result = load.simulate({ ...base, text: "6 | 0 | 19\n5 | 0 | 15\n5 | 1 | 15" });
  assert.deepEqual([...result.items], [2, 3]);
  assert.equal(result.gross, 34);
  assert.equal(result.net, 26);
  assert.equal(result.perHour, 13);
  assert.equal(result.remainingWeight, 0);
  assert.equal(result.remainingSeats, 0);
});

test("preserva assentos ocupados e respeita os limites de tanque e peso", () => {
  const result = load.simulate({ ...base, text: "3 | 2 | 100\n11 | 0 | 90\n5 | 1 | 8" });
  assert.deepEqual([...result.items], [3]);
  assert.equal(result.remainingWeight, 5);
  assert.equal(load.simulate({ ...base, fuel: 6 }).error, "tank");
  assert.equal(load.simulate({ ...base, loadedSeats: 3 }).error, "seats");
  assert.equal(load.simulate({ ...base, loadedWeight: 12 }).error, "weight");
});

test("aceita decimais com vírgula e evita arredondamento no limite", () => {
  const result = load.simulate({ ...base, limit: 5.3, text: "0,1 | 0 | 1,25\n0,2 | 0 | 1,75" });
  assert.deepEqual([...result.items], [1, 2]);
  assert.equal(result.gross, 7);
  assert.equal(result.net, -1);
  assert.equal(result.perHour, -.5);
  assert.equal(result.remainingWeight, 0);
});

test("mantém o líquido desconhecido sem custos e identifica linhas inválidas", () => {
  const grossOnly = load.simulate({ ...base, costs: null, text: "1\t0\t2" });
  assert.equal(grossOnly.gross, 6);
  assert.equal(grossOnly.net, null);
  assert.equal(grossOnly.perHour, null);
  assert.equal(load.simulate({ ...base, text: "1 | 0 | 2\n\n2 | 0 | 1,200" }).line, 3);
  assert.equal(load.simulate({ ...base, text: "1 | 0 | 1\n".repeat(201) }).error, "lot-limit");
});
