import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Exercita a leitura da aba Rotas que as extensões injetam no PilOps, na visão do admin (Rafael: carga e
// passageiros com "—") e em formatos possíveis da visão do dono (Astro: números, botões depois do status,
// total "N / M rotas", status num seletor). Em 28/11/2026 a página do dono foi recusada pela 2.0.6; na revisão do
// Codex (28/11) entraram: seis leituras estáveis sem total, contagem zerada em qualquer recusa e linha com um
// código só (um cartão com várias rotas daria o status da vizinha).
const source = readFileSync(new URL("../coletor/extensao-chrome/leitura-vortex.js", import.meta.url), "utf8");
const readerSource = source.slice(0, source.indexOf("async function section(")) + "\nreadCompany;";

// Nó de mentira com o mínimo do DOM que a leitura usa: contains (o próprio nó ou um descendente) e parentElement.
function node(props, children = []) {
  const self = { ...props, parentElement: null, contains: x => x === self || children.some(child => child.contains(x)) };
  for (const child of children) child.parentElement = self;
  return self;
}

function route(origin, destination, { status = "Ativo", owner = false, after = [], select = null, visible = true, code = "VTX0000" } = {}) {
  const text = [origin, destination, "", code, "", origin + " para " + destination,
    owner ? "0 lbs / 90.000 lbs\n0%" : "—", owner ? "0 / 1500 Passageiros\n0%" : "—",
    ...(select ? select.options : [status]), ...after].join("\n");
  const selects = select ? [{ selectedOptions: [{ text: select.chosen }] }] : [];
  const vtx = node({ innerText: code, getClientRects: () => (visible ? [{}] : []) });
  const wrapper = node({ firstElementChild: { innerText: origin + "  " + destination } }, [vtx]);
  const row = node({ innerText: text, querySelectorAll: s => (s === "select" ? selects : []) }, [wrapper]);
  // Na página real (28/11) a linha é o cartão .rounded-lg; card() troca isso por um cartão com várias rotas.
  vtx.closest = () => vtx.card ?? row;
  return Object.assign(vtx, { row });
}

// Um cartão .rounded-lg com várias rotas dentro (o caso que a revisão do Codex reproduziu).
function card(routes) {
  const shared = node({ innerText: routes.map(r => r.row.innerText).join("\n"), querySelectorAll: () => [] }, routes.map(r => r.row));
  for (const r of routes) r.card = shared;
  return routes;
}

function page(codes, total) {
  const window = {};
  const document = {
    body: { innerText: ["Vortex Airways", "Rotas", "Rotas de Vortex Airways", ...(total ? [total] : []), "Rota", "Descrição", "Status"].join("\n") },
    querySelectorAll(selector) {
      if (selector === "h1") return [{ innerText: "Vortex Airways" }];
      if (selector === '[role="tab"]') return [{ innerText: "Rotas", getAttribute: () => "true" }];
      if (selector === "p") return codes;
      return [];
    },
  };
  const location = { origin: "https://pilops.com", pathname: "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1" };
  const read = vm.runInNewContext(readerSource, { document, location, window });
  // Cópia em JSON: os arrays criados dentro do vm são de outro "realm" e o deepStrictEqual os estranha.
  return { window, read: () => JSON.parse(JSON.stringify(read("Rotas", false))) };
}

test("visão do admin: lê as rotas ativas e ignora as inativas e a cópia escondida do layout de celular", () => {
  const codes = [route("ENTC", "HLLM"), route("UUWW", "ENTC", { status: "Inativo" }), route("ENTC", "HLLM", { visible: false })];
  assert.deepEqual(page(codes, "2 rotas").read(), [{ origin: "ENTC", destination: "HLLM", code: "VTX0000" }]);
});

test("visão do dono: números em carga e passageiros, botões depois do status e total com limite", () => {
  const codes = [route("ENTC", "HLLM", { owner: true, after: ["Editar", "Excluir"] }),
    route("GCTS", "ENTC", { owner: true, status: "Inativo", after: ["Editar"] })];
  const { read, window } = page(codes, "2 / 60 rotas");
  assert.deepEqual(read().map(r => r.origin + "-" + r.destination), ["ENTC-HLLM"]);
  assert.equal(window.__vortexRecusado, null);
});

test("status num seletor vale pela opção escolhida, não pelo texto de todas as opções", () => {
  const codes = [route("ENTC", "HLLM", { select: { options: ["Ativo", "Inativo"], chosen: "Inativo" } }),
    route("HLLM", "GCTS", { select: { options: ["Ativo", "Inativo"], chosen: "Ativo" } })];
  assert.deepEqual(page(codes, "2 rotas").read().map(r => r.origin), ["HLLM"]);
});

test("PilOps em inglês: Active conta e Inactive fica de fora", () => {
  const codes = [route("ENTC", "HLLM", { status: "Active" }), route("HLLM", "GCTS", { status: "Inactive" })];
  assert.deepEqual(page(codes, "2 rotas").read().map(r => r.origin), ["ENTC"]);
});

test("cartão com várias rotas: cada código usa a própria linha, não o status da vizinha", () => {
  const codes = card([route("ENTC", "HLLM", { code: "VTX0001" }), route("HLLM", "GCTS", { status: "Inativo", code: "VTX0002" }),
    route("GCTS", "ENTC", { code: "VTX0003" })]);
  assert.deepEqual(page(codes, "3 rotas").read().map(r => r.code), ["VTX0001", "VTX0003"]);
});

test("sem o total na página, aceita só depois de seis leituras com o mesmo número de rotas", () => {
  const { read, window } = page([route("ENTC", "HLLM"), route("HLLM", "ENTC")]);
  for (let i = 0; i < 5; i++) assert.equal(read(), null);
  assert.match(window.__vortexRecusado, /não mostra o total \(2 códigos/);
  assert.equal(read().length, 2);
});

test("sem o total, uma recusa zera a contagem: a lista precisa de seis leituras estáveis de novo", () => {
  const codes = [route("ENTC", "HLLM", { status: "Pausada" }), route("HLLM", "ENTC")];
  const { read, window } = page(codes);
  for (let i = 0; i < 5; i++) assert.equal(read(), null);
  assert.equal(read(), null);
  assert.match(window.__vortexRecusado, /^rotas: status não encontrado/);
  codes[0] = route("ENTC", "HLLM");
  for (let i = 0; i < 5; i++) {
    assert.equal(read(), null, "leitura " + (i + 1) + " depois da recusa");
    assert.match(window.__vortexRecusado, /não mostra o total/);
  }
  assert.equal(read().length, 2);
});

test("sem o total, a lista que cresce durante as leituras recomeça a contagem", () => {
  const codes = [route("ENTC", "HLLM")];
  const { read } = page(codes);
  for (let i = 0; i < 4; i++) assert.equal(read(), null);
  codes.push(route("HLLM", "ENTC"));
  for (let i = 0; i < 5; i++) assert.equal(read(), null);
  assert.equal(read().length, 2);
});

test("recusa com o motivo: lista incompleta e linha sem status", () => {
  let p = page([route("ENTC", "HLLM")], "48 rotas");
  assert.equal(p.read(), null);
  assert.equal(p.window.__vortexRecusado, "rotas: 1 códigos visíveis, a página diz 48 rotas");
  p = page([route("ENTC", "HLLM", { status: "Pausada" })], "1 rota");
  assert.equal(p.read(), null);
  assert.match(p.window.__vortexRecusado, /^rotas: status não encontrado \| linha: ENTC \| HLLM \| VTX0000 .*Pausada$/);
});
