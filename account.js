"use strict";
const el = id => document.getElementById(id);
const featureLabels = { question: "智能问数", fill: "信披填报", ppt: "PPT", quarterly: "季报", personalRules: "个人规则" };
const roleLabels = { member: "同事", admin: "账号管理员", maintainer: "公共维护人（预留）" };
const statusLabels = { active: "正常", pending: "待激活", disabled: "已停用" };
let identity, users = [], editingId = null;
let activationToken = new URLSearchParams(location.hash.slice(1)).get("token") || "";
if (activationToken) history.replaceState(null, "", window.WenshuCloudPage("/activate"));
const text = (id, value) => { el(id).textContent = value; };
function notice(value, error = false) { text("notice", value); el("notice").classList.toggle("error", error); }
async function request(url, body) {
  const headers = identity ? { "X-Account-User": identity.user.id } : {};
  const response = await fetch(url, body ? { method: "POST", headers: { ...headers, "Content-Type": "application/json", ...(identity ? { "X-CSRF-Token": identity.csrf } : {}) }, body: JSON.stringify(body) } : { headers });
  const value = await response.json();
  if (!response.ok) { if (response.status === 401 && identity) location.replace(window.WenshuCloudPage("/login")); throw Error(value.error || "请求失败"); }
  return value;
}
async function submit(form, fn) { const button = form.querySelector("button[type=submit]"); button.disabled = true; notice(""); try { await fn(); } catch (e) { notice(e.message, true); } finally { button.disabled = false; } }
function checkboxes(id, labels, selected) { const box = el(id); box.querySelectorAll("label").forEach(n => n.remove()); for (const [value, label] of Object.entries(labels)) { const row = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.value = value; input.checked = selected.includes(value); row.append(input, document.createTextNode(label)); box.append(row); } }
const selected = id => [...el(id).querySelectorAll("input:checked")].map(n => n.value);
function invitation(result, name) { el("invitationPanel").hidden = false; text("invitationDescription", `${name} · 到期：${new Date(result.expiresAt).toLocaleString("zh-CN")}`); el("invitationLink").value = location.origin + window.WenshuCloudPage("/activate") + "#token=" + result.activationToken; el("invitationPanel").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
const tag = label => { const n = document.createElement("span"); n.className = "account-tag"; n.textContent = label; return n; };
async function loadUsers() {
  ({ users } = await request("/api/admin/users"));
  const body = el("usersBody"); body.replaceChildren();
  for (const user of users) {
    const row = document.createElement("tr");
    const cells = Array.from({ length: 5 }, () => document.createElement("td")); row.append(...cells);
    cells[0].textContent = user.displayName; const small = document.createElement("small"); small.textContent = user.username; cells[0].append(small);
    cells[1].textContent = statusLabels[user.status];
    cells[2].append(...user.roles.map(r => tag(roleLabels[r]))); const permissions = document.createElement("small"); permissions.textContent = user.permissions.map(p => featureLabels[p]).join("、") || "未开放业务功能"; cells[2].append(permissions);
    cells[3].textContent = `任务 ${user.usage.tasks} · 提交 ${user.usage.messages}`; const usage = document.createElement("small"); usage.textContent = `请求 ${user.usage.requests} · 失败 ${user.usage.failures} · 上传 ${(user.usage.uploadBytes / 1048576).toFixed(1)} MB · Token ${user.usage.modelTokens?.totalTokens ?? "待上报"}`; cells[3].append(usage);
    const action = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", async () => { b.disabled = true; try { await fn(); } catch (e) { notice(e.message, true); } finally { b.disabled = false; } }); cells[4].append(b); };
    action("调整权限", () => { editingId = user.id; text("editUsername", user.username); el("editDisplayName").value = user.displayName; checkboxes("editRoles", roleLabels, user.roles); checkboxes("editPermissions", featureLabels, user.permissions); el("editDialog").showModal(); });
    action(user.status === "disabled" ? "恢复" : "停用", async () => { if (!confirm(`确认${user.status === "disabled" ? "恢复" : "停用"} ${user.displayName}？停用将终止该账号的运行连接。`)) return; await request(`/api/admin/users/${user.id}/update`, { status: user.status === "disabled" ? (user.activatedAt ? "active" : "pending") : "disabled" }); await loadUsers(); });
    action(user.status === "pending" ? "重发激活" : "重置密码", async () => { if (!confirm(`为 ${user.displayName} 生成新的激活 / 重置链接？原密码和登录会话将失效。`)) return; const result = await request(`/api/admin/users/${user.id}/reset`, {}); invitation(result, user.displayName); await loadUsers(); });
    action("撤销登录", async () => { await request(`/api/admin/users/${user.id}/revoke`, {}); notice("已撤销该账号的全部登录会话。"); });
    body.append(row);
  }
  const { events } = await request("/api/admin/audit");
  const actions = { bootstrap: "建立初始管理员", user_created: "创建账号", user_updated: "修改账号/权限", login: "登录", activate: "激活账号", reset: "完成密码重置", password_reset_issued: "发出重置链接", sessions_revoked: "撤销登录会话", password_changed: "修改密码" };
  el("auditList").replaceChildren(...events.map(e => { const li = document.createElement("li"), name = id => users.find(u => u.id === id)?.displayName || "系统"; li.textContent = `${new Date(e.at).toLocaleString("zh-CN")} · ${name(e.actorId)} · ${actions[e.action] || e.action} · ${name(e.targetId)}`; return li; }));
}
async function initialize() {
  const page = "/" + (location.pathname.split("/").pop() || "").replace(/.html$/, "");
  if (["/login", "/setup", "/activate"].includes(page)) {
    const mode = await request("/api/auth/mode"); if (page === "/login" && mode.needsSetup) { location.replace(window.WenshuCloudPage("/setup")); return; } if (page === "/setup" && !mode.needsSetup) { location.replace(window.WenshuCloudPage("/login")); return; }
    el("accessPanel").hidden = false; const isLogin = page === "/login", isSetup = page === "/setup";
    text("accessTitle", isLogin ? "登录" : isSetup ? "建立管理员账号" : "设置你的密码"); text("accessDescription", isSetup ? "首次使用，由本机操作者建立一位账号管理员。" : isLogin ? "使用管理员分配的账号进入工作台。" : "激活账号或完成密码重置，随后使用账号和密码登录。"); text("accessSubmit", isLogin ? "登录" : isSetup ? "建立管理员" : "保存密码");
    el("usernameField").hidden = !isLogin && !isSetup; el("username").required = isLogin || isSetup; el("nameField").hidden = !isSetup; el("displayName").required = isSetup; el("repeatField").hidden = isLogin; el("repeatPassword").required = !isLogin;
    el("password").autocomplete = isLogin ? "current-password" : "new-password"; if (!isLogin) { el("password").minLength = 12; text("passwordHint", "密码长度 12–128 个字符，建议使用易记的长密码。"); }
    if (page === "/activate" && !activationToken) { notice("链接缺少有效激活信息，请向管理员索取新链接。", true); el("accessSubmit").disabled = true; }
    el("accessForm").addEventListener("submit", e => { e.preventDefault(); submit(e.target, async () => {
      if (!isLogin && el("password").value !== el("repeatPassword").value) throw Error("两次密码不一致");
      const payload = { username: el("username").value, displayName: el("displayName").value, password: el("password").value, token: activationToken };
      await request(isLogin ? "/api/auth/login" : isSetup ? "/api/auth/setup" : "/api/auth/activate", payload); activationToken = ""; if (isLogin) localStorage.setItem("gf.account.login", String(Date.now())); location.replace(window.WenshuCloudPage(isLogin ? "/" : "/login"));
    }); }); return;
  }
  identity = await request("/api/auth/me"); el("accountNav").hidden = false;
  el("logout").addEventListener("click", async () => { await request("/api/auth/logout", {}); localStorage.setItem("gf.account.logout", JSON.stringify({ userId: identity.user.id, at: Date.now() })); location.replace(window.WenshuCloudPage("/login")); });
  window.addEventListener("storage", e => { if (["gf.account.login", "gf.account.logout"].includes(e.key)) location.replace(window.WenshuCloudPage("/login")); });
  if (page === "/admin") {
    if (!identity.user.roles.includes("admin")) { notice("此账号没有账号管理权限。", true); return; }
    el("adminPanel").hidden = false; checkboxes("newRoles", roleLabels, ["member"]); checkboxes("newPermissions", featureLabels, Object.keys(featureLabels));
    el("createForm").addEventListener("submit", e => { e.preventDefault(); submit(e.target, async () => { const name = el("newDisplayName").value; const result = await request("/api/admin/users", { username: el("newUsername").value, displayName: name, roles: selected("newRoles"), permissions: selected("newPermissions") }); invitation(result, name); el("newUsername").value = ""; el("newDisplayName").value = ""; await loadUsers(); }); });
    el("refreshUsers").addEventListener("click", () => loadUsers().catch(e => notice(e.message, true)));
    el("copyInvitation").addEventListener("click", async () => { try { await navigator.clipboard.writeText(el("invitationLink").value); notice("链接已复制，请交给对应同事。"); } catch { el("invitationLink").select(); notice("请复制已选中的链接。"); } });
    el("cancelEdit").addEventListener("click", () => el("editDialog").close());
    el("editForm").addEventListener("submit", e => { e.preventDefault(); submit(e.target, async () => { await request(`/api/admin/users/${editingId}/update`, { displayName: el("editDisplayName").value, roles: selected("editRoles"), permissions: selected("editPermissions") }); el("editDialog").close(); await loadUsers(); }); });
    await loadUsers(); return;
  }
  el("profilePanel").hidden = false; text("profileName", `${identity.user.displayName} · ${identity.user.username}`); text("profilePermissions", "可用功能：" + identity.user.permissions.map(p => featureLabels[p]).join("、")); text("profileUsage", `已创建 ${identity.usage.tasks} 个任务，提交 ${identity.usage.messages} 次处理请求。模型 Token：${identity.usage.modelTokens?.totalTokens ?? "等待供应商上报"}。`);
  el("passwordForm").addEventListener("submit", e => { e.preventDefault(); submit(e.target, async () => { if (el("newPassword").value !== el("confirmNewPassword").value) throw Error("两次新密码不一致"); await request("/api/auth/password", { oldPassword: el("oldPassword").value, password: el("newPassword").value }); location.replace(window.WenshuCloudPage("/login")); }); });
}
initialize().catch(e => { if (/\/(account|admin)\.html$/.test(location.pathname)) location.replace(window.WenshuCloudPage("/login")); else notice(e.message, true); });
