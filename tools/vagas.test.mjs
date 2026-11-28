import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const file = path => new URL("../" + path, import.meta.url);
const reader = vm.runInNewContext(readFileSync(file("coletor/extensao-astro/leitura.js"), "utf8") + "\nVortexStandsReader;");
const stands = vm.runInNewContext(readFileSync(file("docs/vagas.js"), "utf8") + "\nVortexStands;");
const plain = value => JSON.parse(JSON.stringify(value));

test("leitor entende os números das barras de carga e passageiros", () => {
  assert.equal(reader.number("1.234"), 1234);
  assert.equal(reader.number("1,234"), 1234);
  assert.equal(reader.number("12,5"), 12.5);
  assert.equal(reader.number("3,5k"), 3500);
  assert.deepEqual(plain(reader.amount("1.234 / 5.000 lbs")), { text: "1.234 / 5.000 lbs", unit: "lb", value: 1234, max: 5000, pct: 24.7 });
  assert.deepEqual(plain(reader.amount("12 de 40")), { text: "12 de 40", value: 12, max: 40, pct: 30 });
  assert.deepEqual(plain(reader.amount("80%")), { text: "80%", pct: 80 });
  assert.deepEqual(plain(reader.amount("Lotada 300/300")), { text: "Lotada 300/300", value: 300, max: 300, pct: 100, full: true });
  assert.deepEqual(plain(reader.amount("", 0.25)), { text: "", pct: 25 });
  assert.equal(reader.amount("—"), null);
  assert.equal(reader.amount(""), null);
});

test("leitor entende a tabela que o dono vê (print do Astro, 27/11/2026)", () => {
  assert.deepEqual(plain(reader.amount("0 lbs / 90.000 lbs\n0%")), { text: "0 lbs / 90.000 lbs 0%", unit: "lb", value: 0, max: 90000, pct: 0 });
  assert.deepEqual(plain(reader.amount("0lbs/90.000lbs 0%")), { text: "0lbs/90.000lbs 0%", unit: "lb", value: 0, max: 90000, pct: 0 });
  assert.deepEqual(plain(reader.amount("320 / 1500 Passageiros 21%")), { text: "320 / 1500 Passageiros 21%", value: 320, max: 1500, pct: 21 });
  assert.deepEqual(plain(reader.routesOf("0 / 10", "UTAA")), { codes: [], destinations: [], count: 0, limit: 10, text: "0 / 10" });
});

test("leitor converte validade e rotas da vaga", () => {
  assert.equal(reader.expiry("18d 19h restantes\n16 dez 2026"), "2026-12-16");
  assert.equal(reader.expiry("3 fev. 2027"), "2027-02-03");
  assert.equal(reader.routesOf("—", "LEMD"), null);
  assert.deepEqual(plain(reader.routesOf("VTX0090 LEMD → KRDU", "LEMD")),
    { codes: ["VTX0090"], destinations: ["KRDU"], count: 1, text: "VTX0090 LEMD → KRDU" });
});

const data = {
  capturedAt: "2026-11-27T15:00:00Z",
  stands: [
    { code: "LEMD-C-01", airport: "LEMD", size: "large", cargo: { value: 4000, max: 10000, pct: 40, unit: "lb" }, pax: { value: 120, max: 200, pct: 60 },
      routes: { codes: ["VTX0090"], destinations: ["KRDU"] } },
    { code: "LEMD-C-02", airport: "LEMD", size: "medium", cargo: { pct: 50, max: 2000, unit: "kg" }, pax: { value: 30, max: 30, pct: 100, full: true }, routes: null },
    { code: "KRDU-C-01", airport: "KRDU", size: "small", cargo: null, pax: null, routes: null },
    { code: "ruim", airport: "lemd" },
  ],
};

test("planejador soma as vagas da origem e prefere as ligadas à rota", () => {
  const read = stands.read(data);
  assert.equal(read.stands.length, 3);
  const airport = plain(stands.forRoute(read, { origin: "LEMD", destination: "SBGL", code: "VTX0001" }));
  assert.equal(airport.basis, "airport");
  assert.equal(airport.count, 2);
  // 4.000 lb + 50% de 2.000 kg (2.204,6 lb).
  assert.equal(Math.round(airport.cargo.value), 6205);
  assert.equal(airport.pax.value, 150);
  assert.equal(airport.pax.full, 1);
  const linked = plain(stands.forRoute(read, { origin: "LEMD", destination: "KRDU", code: "VTX0090" }));
  assert.equal(linked.basis, "route");
  assert.equal(linked.count, 1);
  assert.equal(linked.cargo.value, 4000);
  assert.equal(stands.forRoute(read, { origin: "SBGL", destination: "LEMD" }).count, 0);
  assert.equal(stands.read({ stands: [] }), null);
});

test("ocupação estimada respeita assentos e peso livre do avião", () => {
  const summary = stands.forRoute(stands.read(data), { origin: "LEMD", destination: "KRDU", code: "VTX0090" });
  assert.deepEqual(plain(stands.fill(summary, { seats: 100, room: 3000 })), { seats: 100, cargo: 3000 });
  assert.deepEqual(plain(stands.fill(summary, { seats: 300, room: 9000 })), { seats: 120, cargo: 4000 });
  assert.deepEqual(plain(stands.fill(summary, { seats: null, room: null })), { seats: null, cargo: null });
});

test("extensão do dono: ID fixo usado pelo planejador e só o site pode chamá-la", () => {
  const manifest = JSON.parse(readFileSync(file("coletor/extensao-astro/manifest.json")));
  const hash = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
  const id = [...hash].map(n => String.fromCharCode(97 + parseInt(n, 16))).join("");
  assert.match(readFileSync(file("docs/planner.js"), "utf8"), new RegExp('standsExtension = "' + id + '"'));
  assert.deepEqual(manifest.externally_connectable.matches, ["https://vortexairways.github.io/*"]);
  assert.deepEqual(manifest.host_permissions, ["https://pilops.com/*", "https://api.github.com/*"]);
});

test("o pacote baixado pelo dono traz a versão atual de cada arquivo da extensão", () => {
  // O zip é gravado sem compressão (tools/empacotar-extensao-vagas.ps1), então cada arquivo aparece inteiro dentro dele.
  const zip = readFileSync(file("docs/extensao-vagas.zip"));
  for (const name of readdirSync(file("coletor/extensao-astro/"))) {
    // O Git pode trocar o fim de linha (LF/CRLF) da cópia de trabalho; as duas formas valem.
    const text = readFileSync(file("coletor/extensao-astro/" + name), "utf8").replace(/\r\n/g, "\n");
    assert.ok([text, text.replace(/\n/g, "\r\n")].some(form => zip.includes(Buffer.from(form))), name + " está desatualizado no zip; rode tools/empacotar-extensao-vagas.ps1");
  }
});

test("a extensão do dono usa as mesmas regras de leitura e publicação do coletor do Rafael", () => {
  // Cópias feitas por tools/empacotar-extensao-vagas.ps1; se divergirem, o dono publicaria com regras velhas.
  const same = (copy, canonical) => assert.equal(readFileSync(file(copy), "utf8").replace(/\r\n/g, "\n"),
    readFileSync(file(canonical), "utf8").replace(/\r\n/g, "\n"), copy + " desatualizado; rode tools/empacotar-extensao-vagas.ps1");
  same("coletor/extensao-astro/leitura-vortex.js", "coletor/extensao-chrome/leitura-vortex.js");
  same("coletor/extensao-astro/dados.js", "coletor/dados.mjs");
  same("coletor/extensao-astro/publicacao.js", "coletor/publicacao.mjs");
  same("coletor/extensao-astro/publicacao-github.js", "coletor/publicacao-github.mjs");
});
