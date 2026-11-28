import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Exercita a leitura da aba Rotas que as extensões injetam no PilOps, na visão do admin (Rafael: carga e
// passageiros com "—") e na visão do dono (Astro: números, "Vaga lotada", total "N / M rotas" e o status numa
// chave liga/desliga sem texto, visto na 2.0.10 em 28/11/2026). Na revisão do Codex (28/11) entraram: seis leituras
// estáveis sem total, contagem zerada em qualquer recusa e linha com um código só. Na segunda revisão (28/11): a
// estabilidade compara as rotas (não só quantas), dois totais diferentes valem como nenhum e o resultado diz o total.
const source = readFileSync(new URL("../coletor/extensao-chrome/leitura-vortex.js", import.meta.url), "utf8");
const readerSource = source.slice(0, source.indexOf("async function section(")) + "\nreadCompany;";

// Nó de mentira com o mínimo do DOM que a leitura usa: contains (o próprio nó ou um descendente) e parentElement.
function node(props, children = []) {
  const self = { ...props, parentElement: null, contains: x => x === self || children.some(child => child.contains(x)) };
  for (const child of children) child.parentElement = self;
  return self;
}

// toggle: true/false põe uma chave role="switch" (aria-checked) no lugar do selo de status, como na visão do dono.
function route(origin, destination, { status = "Ativo", owner = false, after = [], select = null, visible = true, code = "VTX0000",
  toggle = null } = {}) {
  const text = [origin, destination, "", code, "", origin + " para " + destination,
    owner ? "108.272\nLBS" : "—", owner ? "1.773\nPAX" : "—",
    ...(select ? select.options : toggle !== null ? [] : [status]), ...after].join("\n");
  const selects = select ? [{ selectedOptions: [{ text: select.chosen }] }] : [];
  const attributes = { role: "switch", type: "button", "aria-checked": String(toggle), "data-state": toggle ? "checked" : "unchecked" };
  const switches = toggle === null ? [] : [{ tagName: "BUTTON", innerText: "", getAttribute: name => attributes[name] ?? null }];
  const vtx = node({ innerText: code, getClientRects: () => (visible ? [{}] : []) });
  const wrapper = node({ firstElementChild: { innerText: origin + "  " + destination } }, [vtx]);
  const row = node({ innerText: text,
    querySelectorAll: s => (s === "select" ? selects : s === '[role="switch"]' || s.startsWith("button") ? switches : []) }, [wrapper]);
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

// totals: um texto ("2 rotas") ou vários (outro painel na mesma página). tab.selected troca a aba aberta.
function page(codes, totals, tab = { selected: "true" }) {
  const window = {};
  const document = {
    body: { innerText: ["Vortex Airways", "Rotas", "Rotas de Vortex Airways", ...[totals ?? []].flat(), "Rota", "Descrição", "Status"].join("\n") },
    querySelectorAll(selector) {
      if (selector === "h1") return [{ innerText: "Vortex Airways" }];
      if (selector === '[role="tab"]') return [{ innerText: "Rotas", getAttribute: () => tab.selected, click() {} }];
      if (selector === "p") return codes;
      return [];
    },
  };
  const location = { origin: "https://pilops.com", pathname: "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1" };
  const read = vm.runInNewContext(readerSource, { document, location, window });
  let total;
  // Cópia em JSON: os arrays criados dentro do vm são de outro "realm" e o deepStrictEqual os estranha.
  return {
    window, total: () => total,
    read: () => {
      const result = JSON.parse(JSON.stringify(read("Rotas", false)) ?? "null");
      if (result === null) return null;
      total = result.total;
      return result.routes;
    },
  };
}

test("visão do admin: lê as rotas ativas e ignora as inativas e a cópia escondida do layout de celular", () => {
  const codes = [route("ENTC", "HLLM"), route("UUWW", "ENTC", { status: "Inativo" }), route("ENTC", "HLLM", { visible: false })];
  const p = page(codes, "2 rotas");
  assert.deepEqual(p.read(), [{ origin: "ENTC", destination: "HLLM", code: "VTX0000" }]);
  assert.equal(p.total(), 2, "lista confirmada pelo total da página");
});

test("visão do dono: números em carga e passageiros, botões depois do status e total com limite", () => {
  const codes = [route("ENTC", "HLLM", { owner: true, after: ["Editar", "Excluir"] }),
    route("GCTS", "ENTC", { owner: true, status: "Inativo", after: ["Editar"] })];
  const { read, window } = page(codes, "2 / 60 rotas");
  assert.deepEqual(read().map(r => r.origin + "-" + r.destination), ["ENTC-HLLM"]);
  assert.equal(window.__vortexRecusado, null);
});

test("visão do dono (Astro, 2.0.10): status numa chave liga/desliga sem texto e \"Vaga lotada\" na linha", () => {
  const codes = [route("LEMD", "EFHK", { owner: true, toggle: true, after: ["Vaga lotada"], code: "VTX0090" }),
    route("EFHK", "LEMD", { owner: true, toggle: false, code: "VTX0091" })];
  const p = page(codes, "2 / 60 rotas");
  assert.deepEqual(p.read(), [{ origin: "LEMD", destination: "EFHK", code: "VTX0090" }]);
  assert.equal(p.total(), 2);
});

test("visão do dono (Astro, 2.0.11): \"Vaga lotada\" no lugar do status vira rota incerta, não recusa", () => {
  // Página real do Astro: "LEMD | EFHK | VTX0090 | Madrid para Helsinki | 108.272 | LBS | 1.773 | PAX | Vaga lotada",
  // sem controle nenhum na linha; na visão do admin o VTX0090 está "Ativo".
  const codes = [route("LEMD", "EFHK", { owner: true, status: "Vaga lotada", code: "VTX0090" }),
    route("ENTC", "HLLM", { owner: true }), route("EFHK", "LEMD", { owner: true, status: "Inativo" })];
  const p = page(codes, "3 / 60 rotas");
  assert.deepEqual(p.read(), [{ origin: "LEMD", destination: "EFHK", code: "VTX0090", uncertain: true },
    { origin: "ENTC", destination: "HLLM", code: "VTX0000" }]);
  assert.equal(p.total(), 3);
});

test("linha sem status, sem vaga e sem chave: a recusa mostra os controles da linha para o diagnóstico", () => {
  const p = page([route("LEMD", "EFHK", { owner: true, status: "Em análise" })], "1 / 60 rotas");
  assert.equal(p.read(), null);
  assert.match(p.window.__vortexRecusado, /^rotas: status não encontrado \(controles: nenhum\) \| linha: LEMD \| EFHK \| VTX0000/);
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

test("sem o total na página, aceita só depois de seis leituras com as mesmas rotas, e não confirma a lista", () => {
  const p = page([route("ENTC", "HLLM"), route("HLLM", "ENTC")]);
  for (let i = 0; i < 5; i++) assert.equal(p.read(), null);
  assert.match(p.window.__vortexRecusado, /não mostra o total \(2 códigos/);
  assert.equal(p.read().length, 2);
  assert.equal(p.total(), null, "sem total: quem monta os dados não deixa a lista apagar a malha publicada");
});

test("sem o total, mesmo número de rotas mas rotas diferentes recomeça a contagem (segunda revisão do Codex)", () => {
  const codes = [route("ENTC", "HLLM", { code: "VTX0001" }), route("HLLM", "ENTC", { code: "VTX0002" })];
  const { read } = page(codes);
  for (let i = 0; i < 5; i++) assert.equal(read(), null);
  codes[1] = route("HLLM", "GCTS", { code: "VTX0003" });
  for (let i = 0; i < 5; i++) assert.equal(read(), null, "leitura " + (i + 1) + " depois da troca");
  assert.deepEqual(read().map(r => r.code), ["VTX0001", "VTX0003"]);
});

test("dois totais diferentes na página valem como nenhum: a lista precisa das seis leituras", () => {
  const p = page([route("ENTC", "HLLM"), route("HLLM", "ENTC")], ["2 rotas", "3 rotas"]);
  for (let i = 0; i < 5; i++) assert.equal(p.read(), null);
  assert.equal(p.read().length, 2);
  assert.equal(p.total(), null);
});

test("sem o total, sair da aba Rotas zera a contagem", () => {
  const tab = { selected: "true" };
  const { read, window } = page([route("ENTC", "HLLM")], null, tab);
  for (let i = 0; i < 4; i++) assert.equal(read(), null);
  tab.selected = "false";
  assert.equal(read(), null);
  assert.equal(window.__vortexRotas, null);
  tab.selected = "true";
  for (let i = 0; i < 5; i++) assert.equal(read(), null, "leitura " + (i + 1) + " depois de voltar à aba");
  assert.equal(read().length, 1);
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
  assert.match(p.window.__vortexRecusado, /^rotas: status não encontrado \(controles: nenhum\) \| linha: ENTC \| HLLM \| VTX0000 .*Pausada$/);
});
