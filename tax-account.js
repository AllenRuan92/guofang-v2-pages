"use strict";
// Shared account session; tax credentials remain on the server.
window.WenshuTaxReady = (async () => {
  const page = p => window.WenshuCloudPage ? window.WenshuCloudPage(p) : p === "/" ? "/" : p;
  const expired = () => { document.body.hidden = true; location.replace(page("/login")); };
  const response = await fetch('/api/auth/me');
  if (!response.ok) { expired(); return null; }
  const identity = await response.json();
  window.WenshuTaxFetch = async (url, options = {}) => {
    const headers = new Headers(options.headers || {}); headers.set('X-Account-User', identity.user.id);
    if (options.method && options.method.toUpperCase() !== 'GET') headers.set('X-CSRF-Token', identity.csrf);
    const r = await fetch(url, { ...options, headers });
    if (r.status === 401 || r.headers.get('X-Account-Changed') === '1') expired();
    return r;
  };
  const status = await window.WenshuTaxFetch('/api/tax/status');
  if (!status.ok) { document.body.textContent = '此账号未获税务助手权限，请联系账号管理员。'; document.body.hidden = false; return null; }
  const config = await status.json();
  const bar = document.createElement('div'); bar.className = 'account-toolbar';
  const name = document.createElement('strong'); name.textContent = identity.user.displayName; bar.append(name);
  for (const [label, target] of [['返回问数与信披', '/'], ['我的账户', '/account']]) { const link = document.createElement('a'); link.textContent = label; link.href = page(target); bar.append(link); }
  const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = '退出';
  logout.onclick = async () => { const r = await window.WenshuTaxFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.ok) { localStorage.setItem('gf.account.logout', JSON.stringify({ userId: identity.user.id, at: Date.now() })); expired(); } }; bar.append(logout); document.body.prepend(bar);
  window.addEventListener('storage', e => { if (e.key === 'gf.account.logout') { try { if (JSON.parse(e.newValue).userId === identity.user.id) expired(); } catch {} } });
  const verify = async () => { try { await window.WenshuTaxFetch('/api/auth/me'); } catch {} }; window.addEventListener('focus', verify); setInterval(verify, 60000);
  window.WenshuTax = { ...config, identity, namespace: 'gf.' + identity.storageNamespace + '.' + identity.user.id + '.tax' };
  window.WenshuTaxRequest = async (path, value, signal) => {
    const r = await window.WenshuTaxFetch('/api/tax/' + path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const data = await r.json(); if (!r.ok || data.success !== true) { const error = new Error(data.error || '税务操作未完成，请刷新核对'); error.status = r.status; throw error; } return data.data;
  };
  document.body.hidden = false;
  return window.WenshuTax;
})();
