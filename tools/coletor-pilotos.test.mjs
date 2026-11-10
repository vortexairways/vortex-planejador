import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Exercita a função que a extensão injeta, com a lista visível antes/depois da paginação do PilOps.
const source = readFileSync(new URL("../coletor/extensao-chrome/coletor.js", import.meta.url), "utf8");
const readerSource = source.slice(0, source.indexOf("async function section(")) + "\nreadCompany;";
const row = (name, admin = false) => ["@" + name, ...(admin ? ["Admin"] : []), "BR", "78:40", "00:00", "Nov 10, 2026"].join("\n");

function fixture(shown = 10, expected = 11) {
  const state = { scrolled: 0, body: "" };
  const fill = count => {
    state.body = ["@Titanocs", "Vortex Airways", "Painel de pilotos", expected + " pilotos cadastrados",
      "Nickname", "Horas Totais de Voo", "Horas na Empresa", "Data de Entrada",
      ...Array.from({ length: count }, (_, i) => row(i === 10 ? "nassis89" : "piloto" + i, i === 0)),
      "Close drawer"].join("\n");
  };
  fill(shown);
  const sentinel = { scrollIntoView() { state.scrolled++; } };
  const panelHeading = { innerText: "Painel de pilotos", parentElement: { parentElement: { lastElementChild: sentinel } } };
  const document = {
    body: { get innerText() { return state.body; } },
    querySelectorAll(selector) {
      if (selector === "h1") return [{ innerText: "Vortex Airways" }];
      if (selector === '[role="tab"]') return [{ innerText: "Pilotos", getAttribute: () => "true" }];
      if (selector === "h2") return [panelHeading];
      return [];
    },
  };
  const location = { origin: "https://pilops.com", pathname: "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1" };
  return { state, fill, location, read: vm.runInNewContext(readerSource, { document, location }) };
}

test("não aceita os dez primeiros de onze e solicita a próxima página", () => {
  const f = fixture();
  assert.equal(f.read("Pilotos", false), null);
  assert.equal(f.state.scrolled, 1);
  f.fill(11);
  const pilots = f.read("Pilotos", false);
  assert.equal(pilots.length, 11);
  assert.equal(pilots[10].name, "nassis89");
  assert.equal(pilots[10].joined, "2026-11-10");
  assert.equal(pilots[10].totalMinutes, 4720);
  assert.equal(pilots[10].companyMinutes, 0);
});

test("lista completa de dez não pede outra página e preserva Admin", () => {
  const f = fixture(10, 10);
  const pilots = f.read("Pilotos", false);
  assert.equal(pilots.length, 10);
  assert.equal(pilots[0].role, "ADMIN");
  assert.equal(f.state.scrolled, 0);
});

test("quantidade acima do total ou horas incompletas continuam recusadas", () => {
  const extra = fixture(11, 10);
  assert.equal(extra.read("Pilotos", false), null);
  const broken = fixture(10, 10);
  broken.state.body = broken.state.body.replace("78:40", "--:--");
  assert.equal(broken.read("Pilotos", false), null);
});

test("leitura nunca é aplicada a outra companhia ou origem", () => {
  const f = fixture(10, 10);
  f.location.pathname = "/pt-BR/app/companies/outra";
  assert.equal(f.read("Pilotos", false), null);
  f.location.origin = "https://example.com";
  assert.equal(f.read("Pilotos", false), null);
});
