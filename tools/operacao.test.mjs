import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const operation = vm.runInNewContext(readFileSync(new URL("../docs/operacao.js", import.meta.url), "utf8") + "\nVortexOperation;");
const routes = [
  { origin: "LEMD", destination: "KRDU", code: "VTX0001" },
  { origin: "SBRF", destination: "SBGL", code: "VTX0001" },
];
const config = { title: { pt: "Operação", en: "Operation" }, start: "2026-11-09", end: "2026-11-15", goal: 10, routes };
const flight = (pilot, date, route = routes[0], extra = {}) =>
  ({ ...route, pilot, date, revenue: 100, minutes: 60, ...extra });

test("conta apenas voos pagos das rotas em destaque dentro das datas inclusivas", () => {
  const progress = operation.progress(operation.read(config, routes), [
    flight("A", "2026-11-08"), flight("A", "2026-11-09"), flight("A", "2026-11-15"),
    flight("A", "2026-11-16"), flight("A", "2026-11-10", routes[0], { revenue: 0 }),
    flight("A", "2026-11-10", routes[0], { minutes: 0 }),
    flight("A", "2026-11-10", { origin: "KRDU", destination: "LEMD" }),
  ]);
  assert.equal(progress.completed.length, 2);
  assert.equal(progress.ranking[0].flights, 2);
});

test("desempata pela variedade e mantém posições compartilhadas em empates completos", () => {
  const progress = operation.progress(operation.read(config, routes), [
    flight("B", "2026-11-10"), flight("B", "2026-11-11"),
    flight("A", "2026-11-10"), flight("A", "2026-11-11", routes[1]),
    flight("C", "2026-11-10"), flight("C", "2026-11-11", routes[1]),
  ]);
  assert.equal(JSON.stringify(progress.ranking.map(p => [p.name, p.rank])), JSON.stringify([["A", 1], ["C", 1], ["B", 3]]));
});

test("operações antigas com rota removida exibem o problema e excluem essa rota da contagem", () => {
  const parsed = operation.read(config, [routes[0]]);
  assert.equal(parsed.routes[1].route, null);
  assert.equal(operation.progress(parsed, [flight("A", "2026-11-10", routes[1])]).completed.length, 0);
});

test("configuração incompleta ou com datas inválidas não interrompe o restante do planejador", () => {
  for (const invalid of [null, {}, { ...config, start: "2026-02-30" }, { ...config, end: "2026-11-01" },
    { ...config, goal: 0 }, { ...config, routes: [null] }, { ...config, routes: [routes[0], routes[0]] }]) {
    assert.equal(operation.read(invalid, routes), null);
  }
});

test("mensagem bilíngue mantém o mesmo voo, duração estimada e convite a voos individuais", () => {
  const text = operation.share({ legs: [routes[0]], plane: { prefix: "NLFTDW", model: "Boeing 787-10 Dreamliner" },
    pilot: "Titanocs", miles: 3450, minutes: 450, url: "https://vortexairways.github.io/vortex-planejador/" });
  assert.ok(text.indexOf("Meu voo pela Vortex") < text.indexOf("My Vortex flight"));
  assert.equal(text.split("LEMD → KRDU").length - 1, 2);
  assert.equal(text.split("NLFTDW").length - 1, 2);
  assert.ok(text.includes("≈ 7h30"));
  assert.ok(text.includes("seus próprios voos") && text.includes("your own flights"));
  assert.ok(text.length <= 2000);
});

test("sem aeronave ou coordenadas, o compartilhamento não inventa duração ou distância", () => {
  const text = operation.share({ legs: [routes[0]], minutes: null, miles: null, url: "https://example.com/" });
  assert.ok(!text.includes("estimated duration"));
  assert.ok(!text.includes("null") && !text.includes("undefined"));
});
