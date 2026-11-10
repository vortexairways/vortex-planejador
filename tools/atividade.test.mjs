import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const activity = vm.runInNewContext(readFileSync(new URL("../docs/atividade.js", import.meta.url), "utf8") + "\nVortexActivity;");
const config = activity.read({ start: "2026-11-01" });

test("primeira janela tem 30 dias inclusivos e prazo inclui o dia atual", () => {
  const window = activity.period(config, "2026-11-10");
  assert.equal(window.start, "2026-11-01");
  assert.equal(window.end, "2026-11-30");
  assert.equal(window.next, "2026-12-01");
  assert.equal(window.daysRemaining, 21);
  assert.equal(activity.period(config, "2026-11-30").daysRemaining, 1);
});

test("renova exatamente após 30 dias e não por mês de calendário", () => {
  const next = activity.period(config, "2026-12-01");
  assert.equal(next.start, "2026-12-01");
  assert.equal(next.end, "2026-12-30");
  assert.equal(next.daysRemaining, 30);
  const third = activity.period(config, "2026-12-31");
  assert.equal(third.start, "2026-12-31");
  assert.equal(third.end, "2027-01-29");
});

test("voo no último dia conta na janela anterior e zera no início da próxima", () => {
  const flights = [
    { pilot: "A", date: "2026-11-30", minutes: 60 },
    { pilot: "B", date: "2026-12-01", minutes: 70 },
    { pilot: "B", date: "2026-12-31", minutes: 80 },
    { pilot: "C", date: "2026-12-01", minutes: 0 },
    { pilot: "D", date: "2026-11-31", minutes: 10 },
  ];
  const previous = activity.counts(activity.period(config, "2026-11-30"), flights, "2026-11-30");
  assert.equal(previous.get("A"), 1);
  assert.equal(previous.get("B"), undefined);
  const current = activity.counts(activity.period(config, "2026-12-01"), flights, "2026-12-01");
  assert.equal(current.get("A"), undefined);
  assert.equal(current.get("B"), 1);
  assert.equal(current.get("C"), undefined);
  assert.equal(current.get("D"), undefined);
});

test("conta todos os voos concluídos do histórico da companhia, sem depender do desafio semanal", () => {
  const totals = activity.counts(activity.period(config, "2026-11-10"), [
    { pilot: "A", date: "2026-11-01", minutes: 45, revenue: 0 },
    { pilot: "A", date: "2026-11-10", minutes: 60, revenue: 100 },
    { pilot: "A", date: "2026-10-31", minutes: 45 },
  ], "2026-11-10");
  assert.equal(totals.get("A"), 2);
});

test("usa Brasília para a virada de dia mesmo com navegador em outro fuso", () => {
  assert.equal(activity.today(new Date("2026-12-01T02:59:59Z")), "2026-11-30");
  assert.equal(activity.today(new Date("2026-12-01T03:00:00Z")), "2026-12-01");
});

test("configuração inválida ou janela futura não atribui ausência de voos", () => {
  assert.equal(activity.read({ start: "2026-02-30" }), null);
  assert.equal(activity.read(null), null);
  assert.equal(activity.period(null, "2026-11-10"), null);
  const future = activity.period(config, "2026-10-31");
  assert.equal(future.active, false);
  assert.equal(activity.counts(future, [{ pilot: "A", date: "2026-10-31", minutes: 60 }], "2026-10-31").size, 0);
});
