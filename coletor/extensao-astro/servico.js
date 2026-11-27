"use strict";
// Extensão do dono da Vortex: o botão "Sincronizar vagas" do planejador pede a leitura da aba Vagas no PilOps
// (que só o dono vê com carga e passageiros) e a publicação de docs/vagas.json no GitHub do planejador.
const stand = "https://pilops.com/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1?tab=stands";
const site = "https://vortexairways.github.io";
const repo = "vortexairways/vortex-planejador";
const target = "docs/vagas.json";
let busy = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class Failure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function remember(result) {
  const last = { at: new Date().toISOString(), ok: result.ok, message: result.message, count: result.count ?? null,
    withValues: result.withValues ?? null };
  await chrome.storage.local.set(result.sample ? { last, sample: result.sample } : { last });
  await chrome.action.setBadgeText({ text: result.ok ? "OK" : "!" });
  await chrome.action.setTitle({ title: "Vortex · Vagas · " + result.message });
}

async function loaded(tabId) {
  for (let i = 0; i < 60; i++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
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
    } catch { /* A página ainda está carregando ou trocou de endereço. */ }
    await wait(500);
  }
  if (last.state === "page") throw new Failure("login", "O PilOps não abriu a página da Vortex. Entre no PilOps neste Chrome e tente de novo.");
  if (last.state === "columns") throw new Failure("format", "A tabela de vagas mudou de colunas (" + (last.head || []).join(", ") + ").");
  if (last.state === "row") throw new Failure("format", "Uma linha da tabela de vagas veio num formato inesperado: " + last.text);
  throw new Failure("loading", "A aba Vagas não carregou por completo" +
    (Number.isInteger(last.total) ? " (" + last.seen + " de " + last.total + " vagas)" : "") + ".");
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function github(path, token, options = {}) {
  return fetch("https://api.github.com/repos/" + repo + "/" + path, { ...options, cache: "no-store", headers: {
    Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28",
    ...(options.body ? { "Content-Type": "application/json" } : {}) } });
}

async function publish(snapshot, token) {
  const stamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })
    .format(new Date(snapshot.capturedAt));
  const content = base64(JSON.stringify(snapshot, null, 1) + "\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await github("contents/" + target + "?ref=main", token);
    if (current.status === 401) throw new Failure("token", "O GitHub recusou o token (inválido ou vencido). Gere outro e cole nas opções da extensão.");
    if (!current.ok && current.status !== 404) throw new Failure("github", "O GitHub respondeu " + current.status + " ao consultar " + target + ".");
    const sha = current.ok ? (await current.json()).sha : undefined;
    const saved = await github("contents/" + target, token, { method: "PUT", body: JSON.stringify({
      message: "Vagas da Vortex · sincronizadas em " + stamp, content, branch: "main", ...(sha ? { sha } : {}) }) });
    if (saved.ok) return;
    if (saved.status === 409 || saved.status === 422) { await wait(1000); continue; }
    if (saved.status === 401) throw new Failure("token", "O GitHub recusou o token (inválido ou vencido). Gere outro e cole nas opções da extensão.");
    if (saved.status === 403 || saved.status === 404) {
      throw new Failure("token", "O token não pode gravar no repositório " + repo + ". Ele precisa de acesso a esse repositório com Contents: Read and write.");
    }
    throw new Failure("github", "O GitHub respondeu " + saved.status + " ao gravar " + target + ".");
  }
  throw new Failure("github", "O arquivo de vagas mudou no GitHub durante o envio. Tente de novo.");
}

async function sync() {
  if (busy) return { ok: false, code: "busy", message: "Já há uma sincronização em andamento." };
  busy = true;
  let tab;
  try {
    await chrome.action.setBadgeText({ text: "…" });
    tab = await chrome.tabs.create({ url: stand, active: false });
    const reading = await readStands(tab.id);
    const capturedAt = new Date().toISOString();
    if (!reading.withValues) {
      const result = { ok: false, code: "owner", count: reading.total, withValues: 0, sample: reading.sample,
        message: "As " + reading.total + " vagas foram lidas, mas carga e passageiros vieram vazios (—). Só o dono da companhia vê esses números; nada foi publicado." };
      await remember(result);
      return result;
    }
    const { token } = await chrome.storage.local.get("token");
    if (!token) throw new Failure("token", "Falta o token do GitHub. Abra as opções da extensão (clique no ícone dela) e cole o token.");
    const snapshot = { version: 1, capturedAt, total: reading.total, stands: reading.stands };
    await publish(snapshot, token);
    const result = { ok: true, code: "ok", count: reading.total, withValues: reading.withValues, sample: reading.sample, data: snapshot,
      message: reading.total + " vagas publicadas (" + reading.withValues + " com carga ou passageiros)." };
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
