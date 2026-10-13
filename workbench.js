"use strict";
let workbench = { profiles: [], editing: null, base: "" };
const configLabels = { name: "配置名称", kind: "配置类型", fundName: "基金范围", scene: "适用场景", unit: "展示单位", decimals: "小数位", rules: "补充规则", basis: "业务依据" };
const eventLabels = { task_created: "创建任务并固定规则版本", turn_started: "开始处理", turn_completed: "处理结束", plan_validated: "填报计划通过校验", plan_rejected: "填报计划未通过校验", write_completed: "确认写回完成" };
async function loadWorkbench() {
  workbench = { ...workbench, ...await api("/api/harness") };
  $("skillBasePreview").value = workbench.base;
  renderProfiles(); renderTaskConfig();
}
function renderProfiles() {
  $("profileSelect").innerHTML = '<option value="">新建配置</option>' + workbench.profiles.map(p => {
    const c = p.draft || p.revisions.at(-1)?.config;
    return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(c.name) + (p.activeVersion ? ' · v' + p.activeVersion : ' · 草稿') + '</option>';
  }).join("");
  $("profileSelect").value = workbench.editing?.id || "";
}
function editProfile(key) {
  const p = workbench.profiles.find(p => p.id === key) || null;
  workbench.editing = p;
  const c = p?.draft || { name: "", kind: "fund", fundName: "", scene: "both", unit: "元", decimals: 2, rules: "", basis: "" };
  for (const field of ["name", "kind", "fundName", "scene", "unit", "decimals", "basis"]) $("profile-" + field).value = c[field];
  $("skillDraftInput").value = c.rules;
  $("profileSelect").value = key || "";
  $("skillStatus").textContent = p?.activeVersion ? "已启用 v" + p.activeVersion + " · 修改先保存为草稿" : "尚未启用";
  $("ruleCheckResult").textContent = "检查将比较草稿与当前启用版本，不会查询数据库。";
  $("profileVersions").innerHTML = p?.revisions.length ? [...p.revisions].reverse().map(r => '<div class="revision-row"><span><strong>v' + r.version + '</strong> · ' + escapeHtml(formatTime(r.createdAt)) + (r.version === p.activeVersion ? ' · 当前启用' : '') + '</span><button type="button" class="small-action" data-restore="' + r.version + '" ' + (r.version === p.activeVersion ? 'disabled' : '') + '>以此版本恢复</button></div>').join("") : '<p class="muted-line">启用后将在这里保留版本。恢复会创建新版本，已有任务继续使用原版本。</p>';
  $("profileVersions").querySelectorAll("[data-restore]").forEach(b => b.onclick = () => publishProfile(Number(b.dataset.restore)));
  $("profile-fundName").disabled = c.kind === "personal";
}
function profileForm() {
  const p = workbench.editing;
  return { id: p?.id, generation: p?.generation, name: $("profile-name").value, kind: $("profile-kind").value, fundName: $("profile-fundName").value, scene: $("profile-scene").value, unit: $("profile-unit").value, decimals: Number($("profile-decimals").value), rules: $("skillDraftInput").value, basis: $("profile-basis").value };
}
async function profileRequest(action, body) {
  return (await api("/api/harness/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).data;
}
async function checkProfile() {
  try {
    const result = await profileRequest("check", profileForm());
    $("ruleCheckResult").innerHTML = '<div class="check-grid">' + result.checks.map(c => '<span class="' + (c.passed ? 'check-pass' : 'check-fail') + '">' + (c.passed ? '✓ ' : '× ') + escapeHtml(c.name) + '</span>').join("") + '</div><p class="muted-line">' + escapeHtml(result.notice) + '</p>' + (result.changes.length ? '<table class="review-table"><thead><tr><th>修改项</th><th>当前启用</th><th>草稿</th></tr></thead><tbody>' + result.changes.map(c => '<tr><td>' + escapeHtml(configLabels[c.field] || c.field) + '</td><td>' + escapeHtml(String(c.before)) + '</td><td>' + escapeHtml(String(c.after)) + '</td></tr>').join("") + '</tbody></table>' : '<p>与当前启用版本一致。</p>');
    return result;
  } catch(e) { showToast(e.message, "error"); return null; }
}
async function saveProfile() {
  const p = await profileRequest("draft", profileForm());
  await loadWorkbench(); editProfile(p.id); showToast("草稿已保存，尚未改变启用版本。"); return p;
}
async function publishProfile(restoreVersion) {
  try {
    let p = workbench.editing;
    if (!restoreVersion) { const result = await checkProfile(); if (!result || result.checks.some(c => !c.passed)) return; p = await saveProfile(); }
    if (!p) return;
    const result = await profileRequest("activate", { id: p.id, generation: p.generation, restoreVersion });
    await loadWorkbench(); editProfile(result.id); showToast("已启用 v" + result.activeVersion + "，仅影响新建任务。");
  } catch(e) { showToast(e.message, "error"); }
}
function renderTaskConfig() {
  const task = activeTask(); if (!task || !$("taskConfig")) return;
  const c = task.taskConfig || {};
  for (const kind of ["fund", "personal"]) {
    const select = $("task-" + kind);
    const options = workbench.profiles.map(p => ({ p, r: p.revisions.find(r => r.version === p.activeVersion) })).filter(({ r }) => r && r.config.kind === kind && ["all", task.mode, ...(["question", "fill"].includes(task.mode) ? ["both"] : [])].includes(r.config.scene));
    select.innerHTML = '<option value="">' + (kind === "fund" ? '按本次问题识别基金' : '自动使用记忆与偏好') + '</option>' + options.map(({p,r}) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(r.config.name) + ' · v' + r.version + '</option>').join("");
    const frozen = task.snapshot?.profiles.find(p => p.config.kind === kind);
    if (frozen) { select.innerHTML = '<option value="' + escapeHtml(frozen.id) + '">' + escapeHtml(frozen.config.name) + ' · v' + frozen.version + '（本任务）</option>'; select.value = frozen.id; }
    else select.value = c[kind + "ProfileId"] || "";
    select.disabled = Boolean(task.threadId || task.busy);
    $(kind === "fund" ? "taskFundField" : "legacyTaskOptions").classList.toggle("is-hidden", !options.length && !frozen && !c[kind + "ProfileId"]);
  }
  $("task-date").value = task.snapshot?.reportDate || c.reportDate || "";
  $("task-fields").value = task.snapshot?.fields || c.fields || "";
  $("task-overwrite").checked = Boolean(task.snapshot ? task.snapshot.overwrite : c.overwrite);
  ["task-date", "task-fields", "task-overwrite"].forEach(key => $(key).disabled = Boolean(task.threadId || task.busy));
  $("taskDateField").classList.toggle("is-hidden", task.mode === "quarterly");
  $("taskQuarterInfo").classList.toggle("is-hidden", task.mode !== "quarterly");
  if (task.mode === "quarterly") {
    const cfg=quarterlyData(task).config;
    $("task-date").disabled=true;
    if (cfg?.year && cfg?.quarter) $("task-date").value=new Date(Date.UTC(Number(cfg.year),Number(cfg.quarter)*3,0)).toISOString().slice(0,10);
    $("taskQuarterInfo").textContent = cfg?.year && cfg?.quarter ? "报告期间：" + cfg.year + " 年第 " + cfg.quarter + " 季度。基金和季度在季报资料区设置，无需重复填写日期。" : "基金和季度在季报资料区设置，无需重复填写日期。";
  }
  $("taskRuleVersion").textContent = task.snapshot ? "任务开始时的默认设置已固定。临时要求可直接在对话中说明；需要重新选择配置时，请新建任务。" : "基金和日期可以直接在对话中说明，也可以在这里设置默认值。";
  $("taskSettingsContext").textContent = modeName(task.mode) + " · 当前任务";
  $("taskSettingsSaveHint").textContent = task.threadId ? "当前任务设置" : "设置自动保存";
  const configured = Boolean(c.fundProfileId || c.personalProfileId || (task.mode !== "quarterly" && (task.snapshot?.reportDate || c.reportDate)) || c.fields || c.overwrite || task.snapshot?.profiles?.length);
  $("taskSettingsIndicator").classList.toggle("is-hidden", !configured);
  $("taskSettingsButton").title = configured ? "查看任务设置（已设置默认条件）" : "按需设置基金、日期，或查看本任务偏好和运行记录";
  $("taskFillOptions").classList.toggle("is-hidden", task.mode !== "fill");
  $("viewRunButton").disabled = !task.threadId;
}
function saveTaskConfig() {
  const task = activeTask(); if (!task || task.threadId) return;
  task.taskConfig = { fundProfileId: $("task-fund").value, personalProfileId: $("task-personal").value, reportDate: $("task-date").value, fields: $("task-fields").value, overwrite: $("task-overwrite").checked };
  persistTasks(); renderTaskConfig();
}
function openTaskSettings() {
  const task = activeTask(); if (!task) return;
  const dialog = $("taskSettingsDialog");
  if (dialog.dataset.taskId !== task.id) {
    for (const key of ["taskFillOptions", "taskMemoryDetails", "legacyTaskOptions"]) $(key).open = false;
    dialog.dataset.taskId = task.id;
  }
  renderTaskConfig(); openDialog("taskSettingsDialog");
  refreshTaskMemory(task).catch(() => { if (activeTask()?.id === task.id) $("taskMemorySummary").textContent = "暂时无法读取偏好，可稍后重新打开"; });
}
async function refreshTaskRecord(task) {
  if (!task?.threadId) return;
  const response = await api("/api/tasks/" + encodeURIComponent(task.threadId));
  task.snapshot = response.task?.snapshot || task.snapshot;
  if (response.task?.recovery?.status === "interrupted" && !response.task.activeTurn && !task.busy) {
    task.runtimeMessage = "上次运行已中断；已保存的计划可继续生成，查询可重新提交";
  }
  if(task.mode === "quarterly") {
    task.quarterly=response.quarterly || task.quarterly; task.runEvents=response.events;
    task.outputs=(task.quarterly?.history||[]).flatMap(h=>h.outputs||[]);
    persistTasks();if(task.id===state.activeTaskId){renderTaskConfig();renderQuarterly();renderOutputs(task);}return;
  }
  if(task.mode === "ppt") {
    task.ppt=response.ppt || task.ppt;
    task.runEvents=response.events;
    task.outputs=(task.ppt?.history||[]).filter(h=>h.output).map(h=>h.output);
    persistTasks();if(task.id===state.activeTaskId){renderTaskConfig();renderPpt();renderOutputs(task);}return;
  }
  task.planRecord = response.record;
  task.runEvents = response.events;
  if (response.record) { task.fillPlan = response.record.plan; task.fillPreviewCompleted = true; task.fillReady = response.record.state !== "committed" && isFillPlanReady(task.fillPlan) && hasFillChanges(task.fillPlan); }
  else task.fillReady = false;
  persistTasks(); if (task.id === state.activeTaskId) { renderTaskConfig(); renderFillReview(); }
}
function previewValue(value) { return value === null ? "（空）" : String(value); }
function renderFullReview() {
  const task = activeTask(), record = task?.planRecord, plan = record?.plan;
  if (!plan) return;
  $("reviewVersion").textContent = "计划 v" + record.version + " · " + plan.updates.length + " 个单元格 · " + plan.insertRows.length + " 个新增行";
  const sheet = $("reviewSheet").value, query = $("reviewSearch").value.trim().toLowerCase();
  const rows = [...plan.updates.map(i => ({...i, kind: "更新"})), ...plan.insertRows.flatMap(i => Object.entries(i.values).map(([column,value]) => ({...i, column, value, oldValue: null, columnTitle: "新增行", kind: "新增"})))];
  const filtered = rows.filter(i => (!sheet || i.sheetName === sheet) && (!query || (i.column + i.row + " " + JSON.stringify(i)).toLowerCase().includes(query)));
  $("reviewRows").innerHTML = filtered.map(i => '<tr><td>' + escapeHtml(i.kind) + '</td><td>' + escapeHtml(i.sheetName) + '<small>' + escapeHtml(i.column + i.row) + '</small></td><td>' + escapeHtml(i.columnTitle) + '</td><td class="old-value">' + escapeHtml(previewValue(i.oldValue)) + '</td><td class="new-value">' + escapeHtml(previewValue(i.value)) + '</td><td>' + escapeHtml(i.unit || "依表头") + '</td><td>' + escapeHtml(i.source) + '<small>' + escapeHtml(i.dataDate) + '</small></td><td>' + escapeHtml(i.reason) + '</td></tr>').join("");
  $("reviewCount").textContent = "显示 " + filtered.length + " / " + rows.length + " 项（新增行展开为单元格）";
}
function openFullReview() {
  const plan = activeTask()?.planRecord?.plan; if (!plan) return;
  $("reviewSheet").innerHTML = '<option value="">全部工作表</option>' + [...new Set([...plan.updates, ...plan.insertRows].map(i => i.sheetName))].map(name => '<option>' + escapeHtml(name) + '</option>').join("");
  $("reviewSearch").value = ""; renderFullReview(); openDialog("reviewDialog");
}
async function openRunRecord() {
  try {
    const task = activeTask(); await refreshTaskRecord(task);
    $("runSnapshot").textContent = task.snapshot ? "公共规则 " + task.snapshot.baseVersion + "；" + (task.snapshot.profiles.map(p => p.config.name + " v" + p.version).join("；") || "无额外配置") : "没有规则快照";
    $("runEvents").innerHTML = (task.runEvents || []).map(e => '<li><time>' + escapeHtml(formatTime(e.time)) + '</time><strong>' + escapeHtml(eventLabels[e.type] || e.type) + '</strong><pre>' + escapeHtml(JSON.stringify(e.detail, null, 2)) + '</pre></li>').join("") || '<li>暂无运行记录。</li>';
    openDialog("runDialog");
  } catch(e) { showToast(e.message, "error"); }
}
function bindWorkbench() {
  $("taskSettingsButton").onclick = openTaskSettings;
  $("profileSelect").onchange = e => editProfile(e.target.value);
  $("profile-kind").onchange = () => $("profile-fundName").disabled = $("profile-kind").value === "personal";
  $("checkProfileButton").onclick = checkProfile;
  ["task-fund", "task-personal", "task-date", "task-fields", "task-overwrite"].forEach(key => $(key).onchange = saveTaskConfig);
  $("reviewSheet").onchange = renderFullReview; $("reviewSearch").oninput = renderFullReview;
  $("viewRunButton").onclick = openRunRecord;
  if ($("exportProfile")) $("exportProfile").onclick = exportProfile;
  if ($("importProfile")) $("importProfile").onchange = importProfile;
}
function exportProfile() {
  const config = profileForm();
  const blob = new Blob([JSON.stringify({ format: "guofang-personal-rule", version: 1, config }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "guofang-personal-rule.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importProfile(event) {
  try {
    const file = event.target.files[0]; if (!file) return; if (file.size > 100000) throw Error("规则文件过大");
    const value = JSON.parse(await file.text()); if (value.format !== "guofang-personal-rule" || value.version !== 1 || !value.config) throw Error("请选择国方个人规则导出文件");
    const profile = await profileRequest("draft", value.config); await loadWorkbench(); editProfile(profile.id); showToast("已导入为私人草稿，请核对后启用。");
  } catch (e) { showToast(e.message, "error"); } finally { event.target.value = ""; }
}
