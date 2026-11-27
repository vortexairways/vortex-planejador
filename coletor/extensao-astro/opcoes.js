"use strict";
const $ = id => document.getElementById(id);
const when = iso => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

async function show() {
  const { token, last, sample } = await chrome.storage.local.get(["token", "last", "sample"]);
  $("status").textContent = token ? "Token salvo neste Chrome." : "Nenhum token salvo.";
  $("result").textContent = last ? "Última sincronização (" + when(last.at) + "): " + last.message : "";
  $("sample").textContent = sample ? JSON.stringify(sample, null, 2) : "Ainda não há amostra.";
}

$("save").addEventListener("click", async () => {
  const token = $("token").value.trim();
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
    $("status").textContent = "Isso não parece um token do GitHub (começa com github_pat_).";
    return;
  }
  await chrome.storage.local.set({ token });
  $("token").value = "";
  await show();
});

$("forget").addEventListener("click", async () => {
  await chrome.storage.local.remove("token");
  await show();
});

$("sync").addEventListener("click", async () => {
  $("sync").disabled = true;
  $("result").textContent = "Lendo a aba Vagas no PilOps…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "sync" });
    $("result").textContent = result?.message || "Sem resposta da extensão.";
  } finally {
    $("sync").disabled = false;
    const { sample } = await chrome.storage.local.get("sample");
    if (sample) $("sample").textContent = JSON.stringify(sample, null, 2);
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("sample").textContent);
  $("copy").textContent = "Copiada";
  setTimeout(() => { $("copy").textContent = "Copiar amostra"; }, 1500);
});

void show();
