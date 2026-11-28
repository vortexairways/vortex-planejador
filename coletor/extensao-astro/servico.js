// Extensão do dono da Vortex. O botão "Sincronizar Vortex (dono)" do planejador pede:
//   1. a leitura da Vortex no PilOps (frota, hangares, hubs, rotas, pilotos e os 10 últimos voos), com o mesmo
//      leitor do coletor do Rafael (leitura-vortex.js), e a publicação da parte pública em docs/dados.json:
//      frota ao vivo e voos novos SEM receita nem combustível; as variações percentuais e o consumo de referência,
//      que só o histórico privado calcula, ficam como estavam;
//   2. a leitura da aba Vagas (carga e passageiros, que só o dono vê) e a publicação em docs/vagas.json.
// Os dois arquivos saem juntos, num commit só (publicacao-github.js; revisão do Codex, 28/11/2026).
// leitura-vortex.js, dados.js, publicacao.js e publicacao-github.js são cópias geradas por
// tools/empacotar-extensao-vagas.ps1.
import "./leitura-vortex.js";
import { buildSnapshot, routesNote } from "./dados.js";
import { publicFuel, publicSnapshot } from "./publicacao.js";
import { newerThan, publishTogether } from "./publicacao-github.js";

const { company, readVortex } = globalThis.VortexReader;
const site = "https://vortexairways.github.io";
const repo = "vortexairways/vortex-planejador";
let busy = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class Failure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function remember(result) {
  const last = { at: new Date().toISOString(), ok: result.ok, message: result.message };
  await chrome.storage.local.set(result.sample ? { last, sample: result.sample } : { last });
  await chrome.action.setBadgeText({ text: result.ok ? "OK" : "!" });
  await chrome.action.setTitle({ title: "Vortex · " + result.message });
}

// ---- Vagas ----
async function loaded(tabId) {
  for (let i = 0; i < 60; i++) {
    if ((await chrome.tabs.get(tabId)).status === "complete") return;
    await wait(500);
  }
}

async function readStands(tabId) {
  await loaded(tabId);
  let last = { state: "loading" };
  for (let i = 0; i < 60; i++) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["leitura.js"] });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId },
        func: () => globalThis.VortexStandsReader.readPage(document) });
      last = result || last;
      if (last.state === "ok") return last;
    } catch { /* A página ainda está carregando ou trocou de aba. */ }
    await wait(500);
  }
  if (last.state === "columns") throw new Error("a tabela de vagas mudou de colunas (" + (last.head || []).join(", ") + ")");
  if (last.state === "row") throw new Error("uma linha da tabela de vagas veio num formato inesperado: " + last.text);
  throw new Error("a aba Vagas não carregou por completo" + (Number.isInteger(last.total) ? " (" + last.seen + " de " + last.total + ")" : ""));
}

// ---- GitHub ----
const githubMessages = {
  refused: "O GitHub recusou o token (inválido ou vencido). Gere outro e cole nas opções da extensão.",
  readOnly: "O token não pode gravar no repositório " + repo + ". Ele precisa de acesso a esse repositório com Contents: Read and write.",
};

// A parte pública montada com as mesmas regras do coletor do Rafael (dados.js + publicacao.js).
function liveData(reading, previous, now) {
  if (!previous) throw new Failure("format", "O dados.json do planejador não foi encontrado no GitHub.");
  const built = buildSnapshot(reading, previous, now);
  if (!built) throw new Failure("format", "A leitura da Vortex veio incompleta ou inválida. Nada foi publicado.");
  const next = publicSnapshot(built.snapshot);
  // Variações e consumo de referência saem do histórico privado: ficam como estavam. Renda em P$ nunca é publicada.
  // O consumo reaproveitado passa pela mesma regra do público (3 voos ou mais, arredondado; revisão do Codex, 28/11).
  if (previous.revenueMonitor) next.revenueMonitor = previous.revenueMonitor;
  if (previous.fuelStats) next.fuelStats = publicFuel(previous.fuelStats);
  delete next.revenueEstimates;
  if (next.flights.some(flight => "revenue" in flight || "fuel" in flight || "payload" in flight)) {
    throw new Failure("format", "A publicação incluiria receita ou combustível de voo. Nada foi publicado.");
  }
  return { next, report: built.report };
}

const stamp = iso => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })
  .format(new Date(iso));

async function sync() {
  if (busy) return { ok: false, code: "busy", message: "Já há uma sincronização em andamento." };
  busy = true;
  let tab;
  try {
    await chrome.action.setBadgeText({ text: "…" });
    const { token } = await chrome.storage.local.get("token");
    if (!token) throw new Failure("token", "Falta o token do GitHub. Abra as opções da extensão (clique no ícone dela) e cole o token.");
    const started = Date.now();
    tab = await chrome.tabs.create({ url: company, active: false });
    let reading;
    try {
      reading = await readVortex(tab.id);
    } catch (error) {
      throw new Failure("login", "Não deu para ler a Vortex no PilOps (" + error.message + "). Confira se o PilOps está logado neste Chrome.");
    }
    const notes = [...reading.notes];
    let stands = null, sample = null;
    const standsStarted = Date.now();
    try {
      stands = await readStands(tab.id);
      sample = stands.sample;
    } catch (error) { notes.push("Vagas: " + error.message + "."); }

    const now = new Date();
    let report, vagasKept = null;
    // Dados e vagas lidos da mesma versão do site e publicados juntos: ou entram os dois, ou nenhum.
    const { files } = await publishTogether({ repo, token, ...githubMessages,
      message: "Vortex ao vivo · sincronizada pelo dono em " + stamp(now.toISOString()),
      build: async read => {
        const previous = await read("docs/dados.json");
        if (newerThan(previous, started)) {
          throw new Failure("newer", "Outra sincronização publicou uma leitura mais nova da Vortex (" + stamp(previous.capturedAt) +
            ") enquanto esta lia o PilOps. Nada foi gravado por cima: o site já está em dia.");
        }
        const live = liveData(reading, previous, now);
        report = live.report;
        const out = { "docs/dados.json": live.next };
        vagasKept = null;
        if (stands && stands.withValues) {
          const theirs = await read("docs/vagas.json");
          if (newerThan(theirs, standsStarted)) vagasKept = theirs.capturedAt;
          else out["docs/vagas.json"] = { version: 1, capturedAt: now.toISOString(), total: stands.total, stands: stands.stands };
        }
        return out;
      } });
    const dados = files["docs/dados.json"], vagas = files["docs/vagas.json"] || null;
    if (routesNote(report)) notes.push(routesNote(report));
    if (vagasKept) notes.push("Vagas: ficaram as do site (" + stamp(vagasKept) + "), mais novas que esta leitura.");
    else if (stands && !stands.withValues) {
      notes.push("Vagas: as barras de carga e passageiros vieram vazias (—), então não foram publicadas. Só o dono da companhia vê esses números.");
    }

    const parts = [dados.fleet.length + " aeronaves", dados.routes.length + " rotas",
      report.pilotsRead ? dados.pilots.length + " pilotos" : "pilotos mantidos",
      report.flightsRead ? report.flightsAdded + (report.flightsAdded === 1 ? " voo novo" : " voos novos") : "voos não lidos",
      vagas ? vagas.total + " vagas" : "vagas não publicadas"];
    const result = { ok: true, code: "ok", dados, vagas, sample, notes,
      message: "Vortex publicada: " + parts.join(", ") + "." + (notes.length ? " Avisos: " + notes.join(" ") : "") };
    await remember(result);
    return result;
  } catch (error) {
    const result = { ok: false, code: error.code || "error", message: error.message || String(error) };
    await remember(result).catch(() => {});
    return result;
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    busy = false;
  }
}

async function status() {
  const { token, last } = await chrome.storage.local.get(["token", "last"]);
  return { ok: true, version: chrome.runtime.getManifest().version, token: Boolean(token), last: last || null };
}

// Só o planejador publicado no GitHub Pages pode pedir a sincronização.
chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (sender.origin !== site || !String(sender.url || "").startsWith(site + "/vortex-planejador/")) return false;
  if (message?.type === "ping") { status().then(reply); return true; }
  if (message?.type === "sync") { sync().then(reply); return true; }
  return false;
});

// A página de opções da própria extensão também pode sincronizar.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "sync") return false;
  sync().then(reply);
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
