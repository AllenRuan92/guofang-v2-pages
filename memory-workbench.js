"use strict";

const memoryUI = { data: null, editing: null, loading: null, timer: null, request: 0, organizer: null, organizerTimer: null };
const memorySceneNames = { question: "问数", fill: "信披", ppt: "PPT", quarterly: "季报" };
function memoryKey(task) { return task.threadId || task.id; }
function memoryLabel(e) { return (memoryUI.data?.specs[e.key]?.label || e.key) + "：" + e.value + (/decimals$/.test(e.key) ? " 位" : ""); }
function memoryScope(e) { return (e.scope.fundName ? e.scope.fundName + " · " : "") + (e.scope.scenes.length === 4 ? "全部场景" : e.scope.scenes.map(s => memorySceneNames[s]).join("、")); }
async function memoryPost(action, body) { return (await api("/api/memory/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).data; }
async function loadMemories() {
  const [memories, organizer] = await Promise.all([api("/api/memory"), api("/api/memory/organizer")]);
  memoryUI.data = memories.data; memoryUI.organizer = organizer.data; renderMemories(); renderOrganizer();
}
function renderOrganizer() {
  const data = memoryUI.organizer; if (!data) return;
  $("memoryOrganizerEnabled").checked = data.enabled;
  $("memoryOrganizerRun").disabled = !data.enabled || data.running || !data.queued || !data.remaining;
  $("memoryOrganizerStatus").textContent = (data.enabled ? data.running ? "正在整理" : data.queued ? "有 " + data.queued + " 项等待空闲时整理" : "等待新的展示要求" : "已暂停，不采集新内容、不保存未完成结果") + " · 今日剩余 " + data.remaining + " 次";
  $("memoryOrganizerJobs").innerHTML = data.jobs.map(j => '<li><span>' + escapeHtml(j.message) + '</span>' + (data.enabled && data.remaining && ["failed", "interrupted"].includes(j.status) && j.attempts < 2 ? '<button type="button" class="small-action" data-organizer-retry="' + j.id + '">重试</button>' : '') + '</li>').join("");
  $("memoryOrganizerJobs").querySelectorAll("[data-organizer-retry]").forEach(b => b.onclick = () => organizerAction({ action: "retry", jobId: b.dataset.organizerRetry }));
}
async function organizerAction(body) {
  try { await memoryPost("organizer", body); await loadMemories(); }
  catch (e) { showToast(e.message, "error"); }
}
function pollOrganizer() {
  clearTimeout(memoryUI.organizerTimer);
  if (!$("memoryDialog").open) return;
  memoryUI.organizerTimer = setTimeout(async () => {
    try { await loadMemories(); } catch { $("memoryOrganizerStatus").textContent = "暂时无法读取整理状态，请稍后重试"; }
    pollOrganizer();
  }, 3000);
}
function renderMemories() {
  if (!memoryUI.data) return;
  const query = $("memorySearch").value.trim().toLowerCase(), scene = $("memorySceneFilter").value;
  const entries = memoryUI.data.entries.filter(e => (!query || (memoryLabel(e) + memoryScope(e)).toLowerCase().includes(query)) && (!scene || e.scope.scenes.includes(scene)));
  $("memoryCount").textContent = memoryUI.data.entries.filter(e => e.state === "active").length + " 条已记住 · " + memoryUI.data.entries.filter(e => e.state === "pending").length + " 条待采纳";
  $("memoryEntries").innerHTML = entries.length ? entries.map(e => '<article class="memory-entry"><div><span class="memory-state">' + (e.state === "active" ? "已记住" : "待采纳") + '</span><h3>' + escapeHtml(memoryLabel(e)) + '</h3><p>' + escapeHtml(memoryScope(e)) + '</p><details><summary>来源与更新时间</summary><p>' + escapeHtml(e.source?.text || "手动添加") + '</p>' + (e.source?.evidence || []).map(v => '<blockquote>' + escapeHtml(v.quote) + '</blockquote>').join("") + '<small>' + escapeHtml(formatTime(e.updatedAt)) + '</small></details></div><div class="memory-entry-actions">' + (e.state === "pending" ? '<button type="button" class="small-action" data-memory-accept="' + e.id + '">采纳</button>' : '') + '<button type="button" class="small-action" data-memory-edit="' + e.id + '">修改</button><button type="button" class="small-action" data-memory-forget="' + e.id + '">' + (e.source?.kind === "background" && e.state === "pending" ? "忽略并不再建议" : "忘记") + '</button></div></article>').join("") : '<div class="memory-empty"><strong>在对话中告诉我你的习惯</strong><p>例如：以后关于基金业绩，保留 2 位小数。</p><p>明确的展示偏好会自动保存。只说“这次”则仅用于当前任务。</p></div>';
  $("memoryEntries").querySelectorAll("[data-memory-edit]").forEach(b => b.onclick = () => editMemory(b.dataset.memoryEdit));
  for (const action of ["accept", "forget"]) $("memoryEntries").querySelectorAll("[data-memory-" + action + "]").forEach(b => b.onclick = async () => {
    const entry = memoryUI.data.entries.find(e => e.id === b.dataset[action === "accept" ? "memoryAccept" : "memoryForget"]);
    try { await memoryPost("change", { action, id: entry.id, version: entry.version }); await loadMemories(); await refreshTaskMemory(activeTask()); showToast(action === "forget" ? "已忘记，以后不再自动使用。原始对话和文件仍保留。" : "已采纳，后续相关回答自动使用。"); }
    catch (e) { showToast(e.message, "error"); }
  });
}
function editMemory(key) {
  memoryUI.editing = memoryUI.data.entries.find(e => e.id === key) || null;
  const entry = memoryUI.editing;
  $("memoryEditor").classList.remove("is-hidden");
  $("memoryEditorTitle").textContent = entry ? "修改偏好" : "添加偏好";
  $("memoryType").innerHTML = Object.entries(memoryUI.data.specs).map(([key,s]) => '<option value="' + key + '">' + escapeHtml(s.label) + '</option>').join("");
  $("memoryType").value = entry?.key || "performance.decimals";
  $("memoryFund").value = entry?.scope.fundName || "";
  document.querySelectorAll("[name=memoryScope]").forEach(el => el.checked = !entry || entry.scope.scenes.includes(el.value));
  renderMemoryValue(entry?.value); $("memoryEditor").scrollIntoView({ block: "nearest" });
}
function renderMemoryValue(value) {
  const spec = memoryUI.data.specs[$("memoryType").value];
  $("memoryValueField").innerHTML = '<span>偏好内容</span>' + (spec.values ? '<select id="memoryValue">' + spec.values.map(v => '<option>' + escapeHtml(v) + '</option>').join("") + '</select>' : spec.type === "decimals" ? '<input id="memoryValue" type="number" min="0" max="6" value="2" />' : '<textarea id="memoryValue" rows="3" maxlength="600" placeholder="描述表达风格或排版习惯"></textarea>');
  if (value !== undefined) $("memoryValue").value = value;
}
async function saveMemoryEditor() {
  const existing = memoryUI.editing;
  try {
    await memoryPost("change", { action: "save", id: existing?.id, version: existing?.version, key: $("memoryType").value, value: $("memoryValue").value,
      scope: { fundName: $("memoryFund").value, scenes: [...document.querySelectorAll("[name=memoryScope]:checked")].map(e => e.value) } });
    $("memoryEditor").classList.add("is-hidden"); await loadMemories(); await refreshTaskMemory(activeTask()); showToast("偏好已保存，下一轮相关回答自动采用。");
  } catch (e) { showToast(e.message, "error"); }
}
async function openMemories() { openDialog("memoryDialog"); try { await loadMemories(); pollOrganizer(); } catch(e) { $("memoryEntries").textContent = "记忆读取失败：" + e.message; } }
function memoryReceiptMarkup(result) {
  return '<div class="memory-receipt">' + (result.notices || []).map(n => '<span>' + escapeHtml(n) + '</span>').join("") + '<button type="button" class="small-action" data-open-memory>查看 / 修改</button>' + (result.undoId ? '<button type="button" class="small-action" data-memory-undo="' + result.undoId + '">撤销</button>' : '') + '</div>';
}
function bindMemoryReceipts(root) {
  root.querySelectorAll("[data-open-memory]").forEach(b => b.onclick = openMemories);
  root.querySelectorAll("[data-memory-undo]").forEach(b => b.onclick = async () => {
    try { await memoryPost("change", { action: "undo", undoId: b.dataset.memoryUndo }); b.disabled = true; b.textContent = "已撤销"; await refreshTaskMemory(activeTask()); showToast("已撤销这次长期偏好修改。"); }
    catch (e) { showToast(e.message, "error"); }
  });
}
async function captureMemoryMessage(task, text) {
  if (!wenshuPreferenceIntent(text)) return false;
  task.memoryRequestId = "memory-request-" + crypto.randomUUID();
  setBusy(true, task);
  try {
    const result = await memoryPost("capture", { text, requestId: task.memoryRequestId, taskId: task.id, threadId: task.threadId, mode: task.mode });
    if (!result.handled) {
      if (result.notices?.length) { task.memoryNotice = result; if(task.id===state.activeTaskId) renderTaskMemory(task); }
      return false;
    }
    if (task.id === state.activeTaskId) { $("messageInput").value = ""; resizeComposer(); }
    await refreshTaskMemory(task);
    // Failed classification has no saved message, so show its honest response locally.
    if (!task.turns.some(t => t.memoryReceipt?.undoId && t.memoryReceipt.undoId === result.undoId) && !task.memory?.task.messages?.some(m => m.text === text && m.response.message === result.message)) {
      const turn = newTurn("memory-local-" + Date.now(), task); Object.assign(turn, { user: text, status: "completed", completedAt: Date.now(), memoryReceipt: result }); turn.assistant.push({ id: turn.id, text: result.message }); task.turns.push(turn);
    }
    renderTaskAfterEvent(task, { forceScroll: true }); persistTasks(); return true;
  } catch(e) { showToast("偏好未能保存：" + e.message, "error"); return true; }
  finally { setBusy(false, task); }
}
async function refreshTaskMemory(task) {
  if (!task) return;
  const key = memoryKey(task);
  const data = (await api("/api/memory/task?taskId=" + encodeURIComponent(key) + "&mode=" + encodeURIComponent(task.mode))).data;
  if (key !== memoryKey(task)) return;
  task.memory = data;
  let changed = false;
  for (const m of data.task.messages || []) if (!task.turns.some(t => t.id === m.id)) {
    changed = true;
    const turn = newTurn(m.id, task); Object.assign(turn, { user: m.text, userAt: Date.parse(m.at), startedAt: Date.parse(m.at), status: "completed", completedAt: Date.parse(m.at), memoryReceipt: m.response }); turn.assistant.push({ id: m.id, text: m.response.message }); task.turns.push(turn);
  }
  task.turns.sort((a,b) => (a.startedAt || a.userAt || 0) - (b.startedAt || b.userAt || 0));
  if (task.id === state.activeTaskId) { renderTaskMemory(task); if (changed) renderMessages({}, task); }
}
function renderTaskMemory(task) {
  const data = task.memory;
  $("memoryNotice").classList.toggle("is-hidden", !task.memoryNotice);
  $("memoryNotice").innerHTML = task.memoryNotice ? memoryReceiptMarkup(task.memoryNotice) : "";
  bindMemoryReceipts($("memoryNotice"));
  $("taskMemorySummary").textContent = data ? (data.entries.length ? "本任务可用 " + data.entries.length + " 条偏好" : "展示偏好 · 自动匹配，也可在对话中告诉我") : "正在读取偏好…";
  $("taskMemoryEntries").innerHTML = data ? data.entries.map(e => '<li><span>' + escapeHtml(e.label) + (e.temporary ? ' <small>仅本任务</small>' : '') + '</span>' + (e.temporary ? '<button class="small-action" type="button" data-clear-temporary="' + e.id + '">清除</button>' : '') + '</li>').join("") : "";
  $("taskMemoryStage").textContent = data?.task.stage || "尚未开始";
  $("taskMemoryLastRequest").textContent = data?.task.lastRequest || "基金、报告期间和资料跟随各自任务保存。";
  if (document.activeElement !== $("taskMemoryFund")) $("taskMemoryFund").value = data?.context.fundName || "";
  $("taskMemoryEntries").querySelectorAll("[data-clear-temporary]").forEach(b => b.onclick = async () => { try { await memoryPost("task", { taskId: memoryKey(task), removeId: b.dataset.clearTemporary }); await refreshTaskMemory(task); } catch(e) { showToast(e.message,"error"); } });
}
function scheduleTaskMemory() {
  clearTimeout(memoryUI.timer);
  const task = activeTask(); if (!task) return;
  renderTaskMemory(task);
  memoryUI.timer = setTimeout(() => refreshTaskMemory(task).catch(e => { if (task.id === state.activeTaskId) $("taskMemorySummary").textContent = "偏好读取失败：" + e.message; }), 250);
}
function bindMemoryWorkbench() {
  $("memoryOrganizerEnabled").onchange = () => organizerAction({ action: "toggle", enabled: $("memoryOrganizerEnabled").checked });
  $("memoryOrganizerRun").onclick = () => organizerAction({ action: "run" });
  $("memoryDialog").addEventListener("close", () => clearTimeout(memoryUI.organizerTimer));
  $("memoryButton").onclick = openMemories; $("headerMemoryButton").onclick = openMemories; $("taskMemoryManage").onclick = openMemories;
  $("memorySearch").oninput = renderMemories; $("memorySceneFilter").onchange = renderMemories;
  $("memoryAdd").onclick = () => editMemory(""); $("memoryType").onchange = () => renderMemoryValue();
  $("memorySave").onclick = saveMemoryEditor; $("memoryCancel").onclick = () => $("memoryEditor").classList.add("is-hidden");
  $("taskMemoryFundSave").onclick = async () => { const task=activeTask(); try { await memoryPost("task", { taskId: memoryKey(task), fundName: $("taskMemoryFund").value }); await refreshTaskMemory(task); showToast("已设置本任务的偏好匹配范围，业务查询仍会核对基金身份。"); } catch(e) { showToast(e.message,"error"); } };
}
