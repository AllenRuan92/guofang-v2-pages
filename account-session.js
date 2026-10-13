"use strict";
window.WenshuAccount = {
  identity: null,
  storageKey(key) { return this.identity ? `gf.${this.identity.storageNamespace}.${this.identity.user.id}.${key}` : key; },
  expired() { document.getElementById("appShell").hidden = true; location.replace(window.WenshuCloudPage("/login")); },
  async fetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("X-Account-User", this.identity.user.id);
    if (options.method && options.method.toUpperCase() !== "GET") headers.set("X-CSRF-Token", this.identity.csrf);
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.headers.get("x-account-changed") === "1") this.expired();
    return response;
  }
};
window.WenshuAccount.ready = (async () => {
  const shell = document.getElementById("appShell"); shell.hidden = true;
  const response = await fetch("/api/auth/me"); if (!response.ok) { window.WenshuAccount.expired(); return false; }
  const identity = await response.json(); window.WenshuAccount.identity = identity;
  window.WenshuAccount.verify = async () => {
    try { const r = await window.WenshuAccount.fetch("/api/auth/me"); if (r.ok) { const current = await r.json(); if (current.user.id !== identity.user.id || current.csrf !== identity.csrf) window.WenshuAccount.expired(); } } catch { /* Recheck when the connection returns. */ }
  };
  const bar = document.createElement("div"); bar.className = "account-toolbar";
  const name = document.createElement("strong"); name.textContent = identity.user.displayName;
  const detail = document.createElement("span"); detail.className = "account-detail"; detail.textContent = "任务与文件仅本人可见";
  const space = document.createElement("span"); space.className = "account-spacer";
  bar.append(name, detail, space);
  const link = (label, href) => { const a = document.createElement("a"); a.href = window.WenshuCloudPage(href); a.textContent = label; bar.append(a); };
  link("我的账户", "/account"); if (identity.user.roles.includes("admin")) link("用户管理", "/admin");
  if (identity.user.permissions.includes("tax")) {
    link("税务助手", "/tax/index.html");
    const taxLink = document.createElement("a"); taxLink.className = "mode-button tax-entry"; taxLink.href = window.WenshuCloudPage("/tax/index.html"); taxLink.textContent = "税务助手"; document.querySelector(".mode-nav").append(taxLink);
  }
  const logout = document.createElement("button"); logout.textContent = "退出"; logout.type = "button"; logout.addEventListener("click", async () => { const r = await window.WenshuAccount.fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (r.ok) { localStorage.setItem("gf.account.logout", JSON.stringify({ userId: identity.user.id, at: Date.now() })); window.WenshuAccount.expired(); } }); bar.append(logout); document.body.prepend(bar); document.body.classList.add("has-account");
  for (const id of ["settingsButton", "headerSettingsButton"]) document.getElementById(id).hidden = true;
  document.querySelector(".isolation-note span:last-child").textContent = "当前账号独立工作区";
  document.querySelectorAll(".mode-button").forEach(b => { const allowed = identity.user.permissions.includes(b.dataset.mode); b.disabled = !allowed; if (!allowed) b.title = "此账号未获该功能权限"; });
  for (const id of ["skillButton", "headerSkillButton"]) document.getElementById(id).hidden = !identity.user.permissions.includes("personalRules");
  document.getElementById("templateManagerButton").hidden = !identity.user.permissions.some(p => ["ppt", "quarterly"].includes(p));
  const enabled = identity.user.permissions.some(p => ["question", "fill", "ppt", "quarterly"].includes(p));
  if (!enabled) { location.replace(window.WenshuCloudPage(identity.user.permissions.includes("tax") ? "/tax/index.html" : identity.user.roles.includes("admin") ? "/admin" : "/account")); return false; }
  window.addEventListener("storage", e => { if (e.key === "gf.account.logout") { try { if (JSON.parse(e.newValue).userId === identity.user.id) window.WenshuAccount.expired(); } catch {} } });
  window.addEventListener("storage", e => { if (e.key === "gf.account.login") window.WenshuAccount.verify(); });
  window.addEventListener("focus", () => window.WenshuAccount.verify());
  setInterval(() => window.WenshuAccount.verify(), 60000);
  shell.hidden = false; return true;
})();
