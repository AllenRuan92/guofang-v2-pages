"use strict";
// Published only in the account Pages build. Tokens never enter URLs or localStorage.
(() => {
  const nativeFetch = window.fetch.bind(window), cfg = window.WENSHU_CLOUD;
  const key = "guofang.cloud.session." + cfg.apiOrigin;
  let token = sessionStorage.getItem(key) || "";
  const blobs = new Map();
  const endpoint = value => new URL(String(value), location.href);
  const isApi = url => url.pathname.startsWith("/api/");
  async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", "Bearer " + token);
    return nativeFetch(cfg.apiOrigin + url.pathname + url.search, { ...options, headers, credentials: "omit", cache: "no-store" });
  }
  async function preview(url) {
    if (!blobs.has(url)) blobs.set(url, (async () => {
      const r = await apiFetch(endpoint(url)); if (!r.ok) throw Error("预览暂不可用");
      return URL.createObjectURL(await r.blob());
    })());
    return blobs.get(url);
  }
  async function images(value) {
    if (typeof value === "string" && /^\/api\/(?:ppt|quarterly)\/(?:template-preview|output-preview)\//.test(value)) return preview(value);
    if (Array.isArray(value)) return Promise.all(value.map(images));
    if (value && typeof value === "object") { const result = {}; for (const [k,v] of Object.entries(value)) result[k] = await images(v); return result; }
    return value;
  }
  window.fetch = async (input, options = {}) => {
    const url = endpoint(input);
    if (!isApi(url)) return nativeFetch(input, options);
    const response = await apiFetch(url, options);
    if (url.pathname === "/api/auth/login" && response.ok) {
      const data = await response.clone().json(); token = data.token || "";
      if (token) sessionStorage.setItem(key, token);
    }
    if (url.pathname === "/api/auth/logout" || url.pathname === "/api/auth/password" && response.ok || response.status === 401) {
      sessionStorage.removeItem(key); token = "";
      for (const p of blobs.values()) p.then(URL.revokeObjectURL).catch(() => {}); blobs.clear();
    }
    if (response.headers.get("content-type")?.includes("application/json") && response.ok) {
      const data = await images(await response.json());
      return new Response(JSON.stringify(data), { status: response.status, headers: response.headers });
    }
    return response;
  };
  window.EventSource = class {
    constructor(url) {
      this.controller = new AbortController(); this.readyState = 0;
      setTimeout(() => this.start(url), 0);
    }
    async start(url) {
      try {
        const r = await window.fetch(url, { signal: this.controller.signal }); if (!r.ok) throw Error("事件连接中断");
        this.readyState = 1; this.onopen?.({});
        const reader = r.body.getReader(), decoder = new TextDecoder(); let buffer = "";
        while (!this.controller.signal.aborted) {
          const item = await reader.read(); if (item.done) break;
          buffer += decoder.decode(item.value, { stream: true }).replace(/\r\n/g,"\n");
          let at;
          while ((at=buffer.indexOf("\n\n"))>=0) {
            const frame=buffer.slice(0,at);buffer=buffer.slice(at+2);
            const data=frame.split("\n").filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trimStart()).join("\n");
            if(data)this.onmessage?.({data});
          }
        }
        if (!this.controller.signal.aborted) this.onerror?.({});
      } catch { if (!this.controller.signal.aborted) this.onerror?.({}); }
    }
    close() { this.readyState=2;this.controller.abort(); }
  };
  document.addEventListener("click",async event=>{
    const link=event.target.closest("a"); if(!link)return;
    const url=endpoint(link.getAttribute("href")); if(!url.pathname.startsWith("/api/download/"))return;
    event.preventDefault();
    try {
      const r=await window.fetch(url.pathname); if(!r.ok)throw Error("下载失败，请重新登录后重试");
      const object=URL.createObjectURL(await r.blob()), a=document.createElement("a");a.href=object;
      const match=/filename\*=UTF-8''([^;]+)/i.exec(r.headers.get("content-disposition")||"");
      a.download=match?decodeURIComponent(match[1]):link.getAttribute("download")||"report";a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);
    } catch(e) { window.showToast?.(e.message,"error"); }
  },true);
})();
