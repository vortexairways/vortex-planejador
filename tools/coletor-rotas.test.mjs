import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Exercita a leitura da aba Rotas que as extensões injetam no PilOps, na visão do admin (Rafael: carga e
// passageiros com "—") e em formatos possíveis da visão do dono (Astro: números, botões depois do status,
// total "N / M rotas", status num seletor). Em 28/11/2026 a página do dono foi recusada pela 2.0.6.
const source = readFileSync(new URL("../coletor/extensao-chrome/leitura-vortex.js", import.meta.url), "utf8");
const readerSource = source.slice(0, source.indexOf("async function section(")) + "\nreadCompany;";

function route(origin, destination, { status = "Ativo", owner = false, after = [], select = null, visible = true } = {}) {
  const text = [origin, destination, "", "VTX0000", "", origin + " para " + destination,
    owner ? "0 lbs / 90.000 lbs\n0%" : "—", owner ? "0 / 1500 Passageiros\n0%" : "—",
    ...(select ? select.options : [status]), ...after].join("\n");
  const selects = select ? [{ selectedOptions: [{ text: select.chosen }] }] : [];
  const row = { innerText: text, querySelectorAll: s => (s === "select" ? selects : []), querySelector: s => (s === "select" ? selects[0] ?? null : null) };
  return {
    innerText: "VTX0000", getClientRects: () => (visible ? [{}] : []),
    parentElement: { firstElementChild: { innerText: origin + "  " + destination } }, closest: () => row,
  };
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

test("sem o total na página, aceita só depois de quatro leituras com o mesmo número de rotas", () => {
  const { read, window } = page([route("ENTC", "HLLM"), route("HLLM", "ENTC")]);
  for (let i = 0; i < 3; i++) assert.equal(read(), null);
  assert.match(window.__vortexRecusado, /não mostra o total \(2 códigos/);
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
