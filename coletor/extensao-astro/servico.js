// Extensão do dono da Vortex. O botão "Sincronizar Vortex (dono)" do planejador pede:
//   1. a leitura da Vortex no PilOps (frota, hangares, hubs, rotas, pilotos e os 10 últimos voos), com o mesmo
//      leitor do coletor do Rafael (leitura-vortex.js), e a publicação da parte pública em docs/dados.json:
//      frota ao vivo e voos novos SEM receita nem combustível; as variações percentuais e o consumo de referência,
//      que só o histórico privado calcula, ficam como estavam;
//   2. a leitura da aba Vagas (carga e passageiros, que só o dono vê) e a publicação em docs/vagas.json.
// leitura-vortex.js, dados.js e publicacao.js são cópias geradas por tools/empacotar-extensao-vagas.ps1.
import "./leitura-vortex.js";
import { buildSnapshot } from "./dados.js";
import { publicSnapshot } from "./publicacao.js";

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
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const fromBase64 = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, "")), c => c.charCodeAt(0)));

async function github(path, token, options = {}) {
  return fetch("https://api.github.com/repos/" + repo + "/" + path, { ...options, cache: "no-store", headers: {
    Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28",
    ...(options.body ? { "Content-Type": "application/json" } : {}) } });
}

const tokenRefused = () => new Failure("token", "O GitHub recusou o token (inválido ou vencido). Gere outro e cole nas opções da extensão.");

async function current(path, token) {
  const response = await github("contents/" + path + "?ref=main", token);
  if (response.status === 401) throw tokenRefused();
  if (response.status === 404) return { sha: undefined, data: null };
  if (!response.ok) throw new Failure("github", "O GitHub respondeu " + response.status + " ao consultar " + path + ".");
  const body = await response.json();
  return { sha: body.sha, data: JSON.parse(fromBase64(body.content)) };
}

// Grava um arquivo do site. "build" recebe o conteúdo atual e devolve o novo; se o arquivo mudar no GitHub
// durante o envio (por exemplo, o Rafael sincronizou), lê de novo e refaz.
async function write(path, token, message, build) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, data } = await current(path, token);
    const next = build(data);
    const saved = await github("contents/" + path, token, { method: "PUT", body: JSON.stringify({
      message, content: base64(JSON.stringify(next, null, 1) + "\n"), branch: "main", ...(sha ? { sha } : {}) }) });
    if (saved.ok) return next;
    if (saved.status === 409 || saved.status === 422) { await wait(1500); continue; }
    if (saved.status === 401) throw tokenRefused();
    if (saved.status === 403 || saved.status === 404) {
      throw new Failure("token", "O token não pode gravar no repositório " + repo + ". Ele precisa de acesso a esse repositório com Contents: Read and write.");
    }
    throw new Failure("github", "O GitHub respondeu " + saved.status + " ao gravar " + path + ".");
  }
  throw new Failure("github", path + " mudou no GitHub durante o envio três vezes seguidas. Tente de novo.");
}

// A parte pública montada com as mesmas regras do coletor do Rafael (dados.js + publicacao.js).
function liveData(reading, previous, now) {
  if (!previous) throw new Failure("format", "O dados.json do planejador não foi encontrado no GitHub.");
  const built = buildSnapshot(reading, previous, now);
  if (!built) throw new Failure("format", "A leitura da Vortex veio incompleta ou inválida. Nada foi publicado.");
  const next = publicSnapshot(built.snapshot);
  // Variações e consumo de referência saem do histórico privado: ficam como estavam. Renda em P$ nunca é publicada.
  for (const key of ["revenueMonitor", "fuelStats"]) if (previous[key]) next[key] = previous[key];
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
    tab = await chrome.tabs.create({ url: company, active: false });
    let reading;
    try {
      reading = await readVortex(tab.id);
    } catch (error) {
      throw new Failure("login", "Não deu para ler a Vortex no PilOps (" + error.message + "). Confira se o PilOps está logado neste Chrome.");
    }
    const notes = [...reading.notes];
    let stands = null, sample = null;
    try {
      stands = await readStands(tab.id);
      sample = stands.sample;
    } catch (error) { notes.push("Vagas: " + error.message + "."); }

    const now = new Date();
    let report;
    const dados = await write("docs/dados.json", token, "Vortex ao vivo · sincronizada pelo dono em " + stamp(now.toISOString()), previous => {
      const live = liveData(reading, previous, now);
      report = live.report;
      return live.next;
    });

    let vagas = null;
    if (stands && stands.withValues) {
      vagas = await write("docs/vagas.json", token, "Vagas da Vortex · sincronizadas em " + stamp(now.toISOString()),
        () => ({ version: 1, capturedAt: now.toISOString(), total: stands.total, stands: stands.stands }));
    } else if (stands) {
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
