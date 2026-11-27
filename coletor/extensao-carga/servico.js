"use strict";

// Serviço da extensão Vortex · Carga. O botão "Encher no PilOps" do planejador manda a rota, a aeronave,
// o combustível planejado e o que levar (passageiros, carga ou os dois). O serviço acha uma aba do PilOps
// logada neste Chrome (ou abre uma em segundo plano), pede à ponte daquela aba que encha o voo aberto e,
// depois de gravar, recarrega as abas do PilOps: a página guarda a lista de cargas na memória e a
// regravaria por cima se não fosse recarregada.
const planner = "https://vortexairways.github.io/";
const pilops = "https://pilops.com/";
let busy = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ask(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return null; }
}

async function hasToken(tabId, ms) {
  const end = Date.now() + ms;
  do {
    if ((await ask(tabId, { type: "status" }))?.token) return true;
    await wait(500);
  } while (Date.now() < end);
  return false;
}

async function pilopsTabs() {
  return (await chrome.tabs.query({ url: pilops + "*" })).filter(tab => tab.url?.startsWith(pilops));
}

// Prefere a aba do voo aberto; senão qualquer aba do aplicativo do PilOps (a página inicial do site não chama a API).
async function pickTab() {
  const tabs = await pilopsTabs();
  return tabs.find(tab => /\/app\/activeflight/.test(tab.url)) || tabs.find(tab => /\/app(\/|$)/.test(tab.url)) || null;
}

// Todas as abas do PilOps, não só a do voo: uma aba em outra tela pode ter o voo antigo em memória e, ao ir
// para o voo sem recarregar, a página regravaria a lista de cargas antiga por cima.
async function reloadPilopsTabs(except) {
  for (const tab of await pilopsTabs()) {
    if (tab.id !== except) await chrome.tabs.reload(tab.id).catch(() => {});
  }
}

async function show(text, badge) {
  await chrome.action.setTitle({ title: "Vortex · Carga" + (text ? " · " + text : "") }).catch(() => {});
  await chrome.action.setBadgeText({ text: badge ?? "" }).catch(() => {});
}

async function fill(request) {
  if (busy) return { ok: false, code: "busy" };
  busy = true;
  // Chamadas periódicas mantêm o serviço acordado enquanto a aba lê as páginas de ofertas.
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 15000);
  let opened = null;
  try {
    await show("enchendo o voo…", "…");
    let tab = await pickTab();
    if (!tab) tab = opened = await chrome.tabs.create({ url: pilops + "pt-BR/app", active: false });
    let ready = await hasToken(tab.id, opened ? 30000 : 1500);
    if (!ready && !opened) {
      // Aba aberta antes de instalar a extensão, ou parada há muito tempo: recarregar faz a página chamar o PilOps de novo.
      await chrome.tabs.reload(tab.id);
      ready = await hasToken(tab.id, 30000);
    }
    if (!ready) return { ok: false, code: "no-pilops" };
    let result = await ask(tab.id, { type: "encher", request });
    if (result?.code === "auth" && !result.wrote) {
      await chrome.tabs.reload(tab.id);
      result = (await hasToken(tab.id, 30000)) ? await ask(tab.id, { type: "encher", request }) : { ok: false, code: "no-pilops" };
    }
    if (!result) return { ok: false, code: "no-pilops" };
    if (result.wrote) await reloadPilopsTabs(opened?.id);
    return result;
  } finally {
    clearInterval(keepAlive);
    busy = false;
    if (opened) await chrome.tabs.remove(opened.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "progresso") return false;
  const info = message.info || {};
  const text = info.step === "ofertas" ? "lendo ofertas " + info.page + "/" + info.pages
    : info.step === "gravar" ? "colocando " + info.count + " ofertas no voo" : info.step === "conferir" ? "conferindo" : "lendo o voo";
  void show(text, "…");
  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (!sender.url?.startsWith(planner)) return false;
  if (message?.type === "ping") {
    reply({ ok: true, version: chrome.runtime.getManifest().version, busy });
    return false;
  }
  if (message?.type === "encher") {
    const request = { origin: message.origin, destination: message.destination, registration: message.registration ?? null,
      fuel: message.fuel ?? null, mode: message.mode };
    fill(request).then(async result => {
      await show(result.ok ? "pronto: " + (result.added?.length ?? 0) + " ofertas" : "não deu: " + result.code, result.ok ? "OK" : "!");
      reply(result);
    }, async error => {
      await show("erro", "!");
      reply({ ok: false, code: "internal", detail: String(error?.message || error).slice(0, 200) });
    });
    return true;
  }
  return false;
});
