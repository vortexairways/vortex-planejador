import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const times = vm.runInNewContext(readFileSync(new URL("../docs/tempos.js", import.meta.url), "utf8") + "\nVortexTimes;", { URL, URLSearchParams });
const now = Date.parse("2026-11-11T12:00:00Z");
const ofp = { fetch: { status: "Success", userid: "private" }, params: { time_generated: "2026-11-10T12:34:11Z" },
  origin: { icao_code: "LEMD" }, destination: { icao_code: "KRDU" }, aircraft: { icaocode: "B78X", reg: "private" },
  times: { est_block: "08:44:57", est_time_enroute: "08:16:57", sched_block: "08:40:00" },
  crew: { name: "private" }, fuel: { plan_ramp: "private" }, weights: { payload: "private" }, text: { plan_html: "private" } };
const record = times.readOFP(ofp);
const args = { origin: "LEMD", destination: "KRDU", plane: { model: "Boeing 787-10 Dreamliner" },
  performance: { speed: 490 }, miles: 3450, references: [record], now };

test("lê o bloco estimado do SimBrief v2, sem confundir tempo no ar ou bloco agendado", () => {
  assert.equal(record.blockSeconds, 31497);
  assert.equal(record.enrouteSeconds, 29817);
  assert.equal(times.estimate(args).minutes, 525);
  assert.equal(times.estimate(args).source, "simbrief");
  assert.ok(!JSON.stringify(record).includes("private"));
  assert.equal(Object.keys(record).length, 6);
});

test("aceita durações legadas em segundos e rejeita formatos ambíguos", () => {
  assert.equal(times.seconds("31497"), 31497);
  assert.equal(times.seconds(31497), 31497);
  for (const invalid of [null, "", true, "8:45", "08:60:00", "08:00:60", -1, "1e3"]) assert.equal(times.seconds(invalid), null);
  assert.equal(times.readOFP({ ...ofp, times: { est_block: "31497" }, params: { time_generated: "1794314051" } }).blockSeconds, 31497);
});

test("não aplica tempo a outra direção, rota, variante ou modelo genérico", () => {
  for (const change of [{ origin: "KRDU", destination: "LEMD" }, { destination: "EFHK" },
    { plane: { model: "Douglas MD-11" } }, { plane: { model: "Boeing 787-9 Dreamliner" } },
    { plane: { model: "Boeing 737 MAX" } }, { plane: null }]) {
    assert.equal(times.estimate({ ...args, ...change }).source, "catalog");
  }
});

test("plano vencido ou futuro não substitui estimativa; sem perfil não inventa tempo", () => {
  assert.equal(times.estimate({ ...args, now: Date.parse("2026-12-11T12:34:11Z") }).source, "catalog");
  assert.equal(times.estimate({ ...args, now: Date.parse("2026-11-09T12:34:11Z") }).source, "catalog");
  assert.equal(times.estimate({ ...args, references: [], performance: null }).minutes, null);
  assert.equal(times.estimate({ ...args, references: [], miles: null }).minutes, null);
  assert.equal(times.estimate({ ...args, miles: null, performance: null }).minutes, 525);
});

test("prioriza plano mais recente e sanitiza novamente referências salvas", () => {
  const newer = { ...record, blockSeconds: 32000, generatedAt: "2026-11-11T10:00:00Z", secret: "private" };
  const saved = times.records([record, newer, ofp, null]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].blockSeconds, 32000);
  assert.ok(!JSON.stringify(saved).includes("private"));
  assert.equal(times.estimate({ ...args, references: [record, newer] }).minutes, 534);
});

test("respostas de erro, duração ausente e datas inválidas não derrubam o planejador", () => {
  for (const invalid of [null, {}, { ...ofp, fetch: { status: "Error" } }, { ...ofp, times: {} },
    { ...ofp, times: { est_block: "00:00:00" } }, { ...ofp, params: { time_generated: "1e300" } },
    { ...ofp, aircraft: { icaocode: "<script>" } }, { ...ofp, params: { time_generated: "invalid" } }]) {
    assert.equal(times.readOFP(invalid), null);
  }
});

test("soma por trecho e identifica planos com fontes mistas e trechos sem tempo", () => {
  const actual = times.estimate(args), fallback = times.estimate({ ...args, destination: "EFHK" });
  const mixed = times.summary([actual, fallback]);
  assert.equal(mixed.minutes, actual.minutes + fallback.minutes);
  assert.equal(mixed.source, "mixed"); assert.equal(mixed.count, 1);
  assert.equal(times.summary([actual]).source, "simbrief");
  assert.equal(times.summary([actual, { minutes: null, source: "catalog" }]).minutes, null);
  assert.equal(times.summary([]).minutes, null);
});

test("endpoint envia o identificador somente ao SimBrief, com cliente e JSON v2", () => {
  const id = new URL(times.endpoint("12345"));
  assert.equal(id.origin, "https://www.simbrief.com"); assert.equal(id.searchParams.get("userid"), "12345");
  assert.equal(id.searchParams.get("json"), "v2"); assert.equal(id.searchParams.get("client"), "vortex-planejador-1.0");
  const username = new URL(times.endpoint("name+alias&test"));
  assert.equal(username.searchParams.get("username"), "name+alias&test");
  assert.equal(username.searchParams.size, 3);
  assert.equal(times.endpoint(""), null); assert.equal(times.endpoint("a\nb"), null);
});

test("referência publicada coincide com os tempos conferidos, sem ID nem plano completo", () => {
  const data = JSON.parse(readFileSync(new URL("../docs/tempos-simbrief.json", import.meta.url), "utf8"));
  const published = times.records(data.references);
  assert.equal(published[0].blockSeconds, 31497);
  assert.equal(JSON.stringify(data.references), JSON.stringify(published));
  assert.ok(!JSON.stringify(data).includes("1325103"));
});
