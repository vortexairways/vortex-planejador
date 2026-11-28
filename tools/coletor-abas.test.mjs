import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

// Leitura das abas Hangares, Hubs, Frota e Voos (revisão do Codex, 28/11/2026): uma aba ainda carregando não pode
// passar por lista completa, e toda recusa deixa o motivo em __vortexRecusado para o erro da sincronização.
const source = readFileSync(new URL("../coletor/extensao-chrome/leitura-vortex.js", import.meta.url), "utf8");
const readerSource = source.slice(0, source.indexOf("async function section(")) + "\nreadCompany;";

function page(section, { body = "", nodes = {} } = {}) {
  const window = {};
  const document = {
    body: { innerText: ["Vortex Airways", section, body].join("\n") },
    querySelectorAll(selector) {
      if (selector === "h1") return [{ innerText: "Vortex Airways" }];
      if (selector === '[role="tab"]') return [{ innerText: section, getAttribute: () => "true" }];
      return nodes[selector] ?? [];
    },
  };
  const location = { origin: "https://pilops.com", pathname: "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1" };
  const read = vm.runInNewContext(readerSource, { document, location, window });
  return { window, read: () => JSON.parse(JSON.stringify(read(section, false)) ?? "null") };
}

const hangar = (icao, lines) => ({ innerText: [icao, ...lines].join("\n"), getAttribute: () => icao });

test("Hangares: lê matrícula → aeroporto quando as vagas ocupadas batem com as matrículas", () => {
  const cards = [hangar("SBGR", ["2/2 Vagas", "NABC12", "NXYZ34"]), hangar("LEMD", ["0/2 Vagas"]), hangar("KRDU", ["1 / 3 vagas", "NQWE56"])];
  const { read, window } = page("Hangares", { nodes: { '[role="button"][aria-label]': cards } });
  assert.deepEqual(read(), { NABC12: "SBGR", NXYZ34: "SBGR", NQWE56: "KRDU" });
  assert.equal(window.__vortexRecusado, null);
});

test("Hangares: recusa enquanto as matrículas ainda carregam (2/2 Vagas com uma matrícula só)", () => {
  const cards = [hangar("SBGR", ["2/2 Vagas", "NABC12"])];
  const { read, window } = page("Hangares", { nodes: { '[role="button"][aria-label]': cards } });
  assert.equal(read(), null);
  assert.match(window.__vortexRecusado, /^hangares: SBGR com 2 vagas ocupadas e 1 matrículas \| linha: SBGR \| 2\/2 Vagas \| NABC12$/);
  assert.equal(page("Hangares").read(), null);
});

test("Hangares: nenhuma matrícula em hangar nenhum é lista carregando, não frota fora dos hangares", () => {
  const cards = [hangar("SBGR", ["0/2 Vagas"]), hangar("LEMD", [])];
  const { read, window } = page("Hangares", { nodes: { '[role="button"][aria-label]': cards } });
  assert.equal(read(), null);
  assert.match(window.__vortexRecusado, /^hangares: nenhuma matrícula nos hangares/);
});

test("Hubs: recusa com o motivo quando a contagem não bate com o total da página", () => {
  const link = code => ({ href: "https://pilops.com/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1/hubs/" + code, innerText: code + " Hub" });
  const nodes = { 'a[href*="/hubs/"]': [link("SBGR"), link("LEMD")] };
  assert.deepEqual(page("Hubs", { body: "HUBS\n2", nodes }).read(), ["SBGR", "LEMD"]);
  const short = page("Hubs", { body: "HUBS\n3", nodes });
  assert.equal(short.read(), null);
  assert.equal(short.window.__vortexRecusado, "hubs: 2 hubs lidos, a página diz 3");
});

test("Frota: recusa com o motivo quando o total da página não aparece", () => {
  const button = { innerText: "NABC12\nSBGR\n80%" };
  const img = { alt: "Aircraft Test Plane", closest: () => button };
  const ok = page("Frota", { body: "FROTA\n1", nodes: { 'img[alt^="Aircraft "]': [img] } });
  assert.equal(ok.read().reportedFleet, 1);
  const missing = page("Frota", { nodes: { 'img[alt^="Aircraft "]': [img] } });
  assert.equal(missing.read(), null);
  assert.equal(missing.window.__vortexRecusado, "frota: a página não mostra o total da frota");
});

const flight = ["Boeing 737", "NABC12", "@piloto", "Rota", "SBGR", "LEMD", "Data: Nov 07, 2026", "08:27", "5.000 nm", "39.063,77 lbs",
  "P$ 4,616,708.05"];

test("Voos: lê o histórico e recusa a lista vazia (ainda carregando) com o motivo", () => {
  const full = page("Voos", { body: ["Histórico de voos", ...flight, "Voos ativos"].join("\n") });
  assert.deepEqual(full.read().map(f => [f.prefix, f.origin, f.destination, f.date, f.minutes, f.fuel, f.revenue]),
    [["NABC12", "SBGR", "LEMD", "2026-11-07", 507, 39064, 4616708.05]]);
  const empty = page("Voos", { body: "Histórico de voos\nVoos ativos" });
  assert.equal(empty.read(), null);
  assert.match(empty.window.__vortexRecusado, /^voos: nenhum voo concluído no histórico/);
  const none = page("Voos", { body: "Carregando…" });
  assert.equal(none.read(), null);
  assert.equal(none.window.__vortexRecusado, "voos: a página não mostra o Histórico de voos");
});
