// Extensão Vortex · Carga: enchimento automático do voo aberto no PilOps, testado contra um PilOps simulado
// com o formato real das respostas (voo atual, ofertas em páginas de 20 e a gravação da lista do voo).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const file = name => new URL("../" + name, import.meta.url);
const text = name => readFileSync(file(name), "utf8").replace(/\r\n/g, "\n");
const plain = value => JSON.parse(JSON.stringify(value));

const context = vm.createContext({ URLSearchParams, setTimeout });
vm.runInContext(text("docs/cargas.js"), context);
vm.runInContext(text("coletor/extensao-carga/enchimento.js"), context);
const { VortexLoad, VortexFill } = vm.runInContext("({ VortexLoad, VortexFill })", context);

const now = () => Date.parse("2026-11-27T12:00:00Z");
const future = "2026-12-01T00:00:00.000Z";
let sequence = 0;
const offer = (type, destination, weight, price, extra = {}) => ({
  id: "g" + (++sequence), type, location: "SUMU", destination, weight, price, quantity: 1, expirationDate: future,
  flightId: null, user: null, allowedAircraftCategories: [], routeId: null, goodsClass: "DEFAULT", ...extra,
});
const pax = (destination, quantity, weight, price, extra = {}) => offer("PASSENGER", destination, weight, price, { quantity, ...extra });
const flight = (extra = {}) => ({
  id: "voo1", from: "SUMU", to: null, startedAt: null,
  aircraft: { registration: "NZ66EU", fuel: 10000, type: { cargo: 30000, pax: 10, fuelCapacity: 40000, category: "AIRLINERS" } },
  goods: [], ...extra,
});
const request = (extra = {}) => ({ origin: "SUMU", destination: "SBCG", registration: "NZ66EU", fuel: null, mode: "ambos", ...extra });

// PilOps simulado: filtra como o servidor (origem, destino, tipo, peso máximo), pagina de 20 em 20 e grava a
// lista do voo; "taken" são ofertas que outro piloto pega entre a leitura e a gravação.
function pilops(state, offers, { taken = [], onCurrent } = {}) {
  const calls = [];
  let currentCalls = 0;
  const api = async (path, body) => {
    calls.push({ path, body: body ? plain(body) : null });
    if (path === "/flight/current") {
      currentCalls++;
      onCurrent?.(state, currentCalls);
      return plain(state);
    }
    if (path === "/goods/flight/sync") {
      if (state.startedAt) throw new VortexFill.FillError("api", { status: 400, message: "flight_already_started" });
      const errors = [];
      state.goods = body.goods.flatMap(id => {
        const known = state.goods.find(item => item.id === id) || offers.find(item => item.id === id);
        if (taken.includes(id)) {
          errors.push({ id, reason: "goods_in_another_flight" });
          known.flightId = "outro";
          return [];
        }
        known.flightId = state.id;
        return [known];
      });
      return { errors };
    }
    const match = /^\/goods\/([A-Z0-9]+)\?(.*)$/.exec(path);
    assert.ok(match, "chamada inesperada: " + path);
    const query = new URLSearchParams(match[2]);
    const list = offers.filter(item => item.location === match[1] &&
      (!query.get("destination") || item.destination === query.get("destination")) &&
      (!query.get("type") || item.type === query.get("type")) &&
      (!query.get("weightMax") || item.weight <= Number(query.get("weightMax"))));
    const page = Number(query.get("page")), limit = Number(query.get("limit"));
    return { data: plain(list.slice((page - 1) * limit, page * limit)),
      pagination: { page, limit, total: list.length, totalPages: Math.ceil(list.length / limit) } };
  };
  return { api, calls, posts: () => calls.filter(call => call.body) };
}
const run = (fake, extra) => VortexFill.run({ api: fake.api, now, wait: async () => {} }, request(extra));

test("enche com a melhor combinação, desconta o combustível planejado e guarda o que já está a bordo", async () => {
  const aboard = offer("CARGO", "SBCG", 1000, 5000, { id: "ja-a-bordo" });
  const state = flight({ goods: [aboard] });
  const best1 = offer("CARGO", "SBCG", 8500, 80000), best2 = offer("CARGO", "SBCG", 8500, 80000);
  const offers = [
    offer("CARGO", "SBCG", 9000, 90000), best1, best2,
    offer("CARGO", "SBCG", 100, 99000, { blocked: true }),
    offer("CARGO", "SBGL", 100, 99000),
    offer("CARGO", "SBCG", 100, 99000, { allowedAircraftCategories: ["JETS"] }),
    offer("CARGO", "SBCG", 100, 99000, { flightId: "outro-voo" }),
    offer("CARGO", "SBCG", 100, 99000, { user: { id: "u" } }),
    offer("CARGO", "SBCG", 100, 99000, { expirationDate: "2026-11-27T12:03:00Z" }),
  ];
  const fake = pilops(state, offers);
  // Limite 30.000 − combustível planejado 12.000 (maior que os 10.000 do tanque) − 1.000 a bordo = 17.000 livres.
  const result = plain(await run(fake, { fuel: 12000 }));
  assert.equal(result.ok, true);
  assert.equal(result.freeWeight, 17000);
  assert.equal(result.fuel, 12000);
  assert.equal(result.fuelSource, "plano");
  assert.equal(result.payout, 160000);
  assert.equal(result.ratioFirstPayout, 90000, "pegar o melhor P$/lb primeiro daria só a oferta de 9.000 lb");
  assert.deepEqual(result.added, [{ type: "CARGO", weight: 8500, seats: 0, price: 80000 }, { type: "CARGO", weight: 8500, seats: 0, price: 80000 }]);
  assert.equal(result.kept, 1);
  assert.equal(fake.posts().length, 1, "grava uma vez só");
  assert.deepEqual(fake.posts()[0].body, { flightId: "voo1", goods: ["ja-a-bordo", best1.id, best2.id] });
  assert.deepEqual(plain(state.goods.map(item => item.id)), ["ja-a-bordo", best1.id, best2.id]);
  assert.equal(result.lost, 0);
  assert.equal(result.wrote, true);
});

test("o combustível do tanque vale quando é maior que o planejado, e o planejado não passa do tanque cheio", async () => {
  const fake = pilops(flight(), [offer("CARGO", "SBCG", 25000, 1000)]);
  const result = await run(fake, { fuel: 5000 });
  assert.equal(result.fuel, 10000);
  assert.equal(result.fuelSource, "tanque");
  assert.equal(result.added.length, 0, "25.000 lb não cabem em 20.000 livres");
  const full = await run(pilops(flight(), []), { fuel: 99000 });
  assert.equal(full.fuel, 40000, "o planejado é limitado à capacidade do tanque");
});

test("só passageiros respeita os assentos livres e pede só passageiros ao PilOps", async () => {
  const state = flight({ goods: [pax("SBCG", 4, 700, 3000, { id: "quatro" })] });
  const five = pax("SBCG", 5, 900, 5000), threeA = pax("SBCG", 3, 500, 3500), threeB = pax("SBCG", 3, 520, 3400);
  const fake = pilops(state, [five, threeA, threeB, offer("CARGO", "SBCG", 100, 9999)]);
  const result = plain(await run(fake, { mode: "passageiros" }));
  assert.equal(result.freeSeats, 6);
  assert.equal(result.addedSeats, 6);
  assert.equal(result.payout, 6900);
  assert.ok(fake.calls.filter(call => call.path.startsWith("/goods/SUMU?")).every(call => call.path.includes("type=PASSENGER")));
  assert.deepEqual(fake.posts()[0].body.goods, ["quatro", threeA.id, threeB.id]);
});

test("só carga deixa os passageiros de fora", async () => {
  const fake = pilops(flight(), [pax("SBCG", 2, 300, 50000), offer("CARGO", "SBCG", 300, 1000)]);
  const result = plain(await run(fake, { mode: "carga" }));
  assert.deepEqual(result.added.map(item => item.type), ["CARGO"]);
  assert.ok(fake.calls.filter(call => call.path.startsWith("/goods/SUMU?")).every(call => call.path.includes("type=CARGO")));
});

test("recusa sem gravar: voo iniciado, sem voo, outra origem, outro destino ou outra aeronave", async () => {
  const cases = [
    [flight({ startedAt: "2026-11-27T11:00:00Z" }), {}, "started"],
    [flight({ from: "SBGL" }), {}, "origin"],
    [flight({ to: "SBGL" }), {}, "destination"],
    [flight(), { registration: "PRABC" }, "aircraft"],
  ];
  for (const [state, extra, code] of cases) {
    const fake = pilops(state, [offer("CARGO", "SBCG", 100, 1000)]);
    await assert.rejects(run(fake, extra), error => error.code === code);
    assert.equal(fake.posts().length, 0, code);
  }
  const empty = { api: async () => null, now };
  await assert.rejects(VortexFill.run(empty, request()), error => error.code === "no-flight");
  await assert.rejects(VortexFill.run(empty, request({ mode: "tudo" })), error => error.code === "request");
  assert.deepEqual(plain(VortexFill.failure(new VortexFill.FillError("origin", { from: "SBGL", origin: "SUMU" }))),
    { ok: false, code: "origin", from: "SBGL", origin: "SUMU" });
});

test("não grava se o voo mudou entre a leitura das ofertas e a gravação", async () => {
  const fake = pilops(flight(), [offer("CARGO", "SBCG", 100, 1000)], {
    onCurrent: (state, count) => { if (count === 2) state.aircraft.fuel = 15000; },
  });
  await assert.rejects(run(fake), error => error.code === "changed");
  assert.equal(fake.posts().length, 0);
});

test("se outro piloto pega uma oferta no meio do caminho, a segunda rodada usa o espaço que sobrou", async () => {
  const a = offer("CARGO", "SBCG", 6000, 60000), b = offer("CARGO", "SBCG", 4000, 40000), c = offer("CARGO", "SBCG", 4000, 30000);
  const state = flight({ aircraft: { registration: "NZ66EU", fuel: 0, type: { cargo: 10000, pax: 0, category: "AIRLINERS" } } });
  const fake = pilops(state, [a, b, c, offer("CARGO", "SBCG", 3000, 20000)], { taken: [b.id] });
  const result = plain(await run(fake));
  assert.equal(fake.posts().length, 2);
  assert.deepEqual(fake.posts()[1].body.goods, [a.id, c.id]);
  assert.equal(result.payout, 90000);
  assert.equal(result.refused, 0);
  assert.deepEqual(result.reasons, ["goods_in_another_flight"]);
});

test("se todas as escolhidas foram pegas por outro piloto, a segunda rodada escolhe outras", async () => {
  const a = offer("CARGO", "SBCG", 5000, 50000), b = offer("CARGO", "SBCG", 5000, 50000), c = offer("CARGO", "SBCG", 5000, 20000);
  const state = flight({ aircraft: { registration: "NZ66EU", fuel: 0, type: { cargo: 10000, pax: 0, category: "AIRLINERS" } } });
  const fake = pilops(state, [a, b, c], { taken: [a.id, b.id] });
  const result = plain(await run(fake));
  assert.equal(fake.posts().length, 2);
  assert.deepEqual(fake.posts()[1].body.goods, [c.id]);
  assert.equal(result.payout, 20000);
});

test("PilOps recusando a gravação vira erro claro, com aviso de que houve tentativa", async () => {
  const fake = pilops(flight(), [offer("CARGO", "SBCG", 100, 1000)]);
  const api = async (path, body) => {
    if (body) throw new VortexFill.FillError("api", { status: 400, message: "company_suspended" });
    return fake.api(path, body);
  };
  await assert.rejects(VortexFill.run({ api, now, wait: async () => {} }, request()),
    error => error.code === "write" && error.data.wrote === true && error.data.message === "company_suspended");
});

test("lê todas as páginas de ofertas do destino", async () => {
  const offers = Array.from({ length: 45 }, (_, index) => offer("CARGO", "SBCG", 100 + index, 1000 + index));
  const fake = pilops(flight(), offers);
  const result = await run(fake);
  assert.equal(fake.calls.filter(call => call.path.startsWith("/goods/SUMU?")).length, 3);
  assert.equal(result.read, 45);
  assert.equal(result.offered, 45);
  assert.equal(result.added.length, 45, "todas cabem em 20.000 lb");
  assert.ok(fake.calls.every(call => !call.path.startsWith("/goods/SUMU?") || call.path.includes("destination=SBCG")));
});

test("VortexLoad.best devolve as posições escolhidas na lista recebida", () => {
  const result = plain(VortexLoad.best([
    { weight: 6, seats: 0, payout: 60 }, { weight: 5, seats: 0, payout: 45 }, { weight: 5, seats: 0, payout: 45 },
  ], 10, 0));
  assert.deepEqual(result.indexes, [1, 2]);
  assert.equal(result.payout, 90);
  assert.equal(result.ratioFirstPayout, 60);
  assert.equal(result.weight, 10);
});

test("pagina.js pega o token das chamadas da página ao apiv2 e não mexe em outras", async () => {
  const posted = [];
  const listeners = [];
  class FakeXhr { open() {} setRequestHeader() {} }
  const window = {
    fetch: async () => "resposta", postMessage: (data, origin) => posted.push({ data, origin }),
    addEventListener: (name, listener) => listeners.push(listener),
  };
  const page = vm.createContext({ window, Headers, Request, URL, XMLHttpRequest: FakeXhr, location: { origin: "https://pilops.com" } });
  vm.runInContext(text("coletor/extensao-carga/pagina.js"), page);
  const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhIn0.assinatura-de-teste";
  assert.equal(await window.fetch("https://example.com/x", { headers: { Authorization: "Bearer " + "x".repeat(40) } }), "resposta");
  assert.equal(posted.length, 0);
  await window.fetch("https://apiv2.pilops.com/user", { headers: { "Content-Type": "application/json", Authorization: "Bearer " + token } });
  await window.fetch("https://apiv2.pilops.com/flight/current", { headers: { Authorization: "Bearer " + token } });
  assert.deepEqual(plain(posted), [{ data: { vortexCarga: "token", token }, origin: "https://pilops.com" }]);
  const xhr = new FakeXhr();
  xhr.open("GET", "https://apiv2.pilops.com/user");
  xhr.setRequestHeader("Authorization", "Bearer " + token + "2");
  assert.equal(posted.at(-1).data.token, token + "2");
  listeners.forEach(listener => listener({ source: window, data: { vortexCarga: "pedir" } }));
  assert.equal(posted.length, 3);
});

test("extensão: ID fixo igual ao do planejador, cópia do otimizador e zip em dia", () => {
  const manifest = JSON.parse(text("coletor/extensao-carga/manifest.json"));
  const der = Buffer.from(manifest.key, "base64");
  const id = [...createHash("sha256").update(der).digest("hex").slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
  assert.match(text("docs/planner.js"), new RegExp(`const fillExtension = "${id}";`));
  assert.deepEqual(manifest.externally_connectable.matches, ["https://vortexairways.github.io/*"]);
  assert.deepEqual(manifest.host_permissions, ["https://pilops.com/*"]);
  assert.equal(manifest.permissions, undefined, "não pede permissões além do PilOps");
  assert.deepEqual(manifest.content_scripts.map(script => [script.world ?? "ISOLATED", script.js]),
    [["MAIN", ["pagina.js"]], ["ISOLATED", ["cargas.js", "enchimento.js", "ponte.js"]]]);
  assert.equal(text("coletor/extensao-carga/cargas.js"), text("docs/cargas.js"), "cargas.js desatualizado; rode tools/empacotar-extensao-carga.ps1");
  // O zip é gravado sem compressão (tools/empacotar-extensao-carga.ps1), então cada arquivo aparece inteiro dentro dele.
  const zip = readFileSync(file("docs/extensao-carga.zip"));
  for (const name of readdirSync(file("coletor/extensao-carga/"))) {
    const content = text("coletor/extensao-carga/" + name);
    assert.ok([content, content.replace(/\n/g, "\r\n")].some(form => zip.includes(Buffer.from(form))),
      name + " está desatualizado no zip; rode tools/empacotar-extensao-carga.ps1");
  }
});
