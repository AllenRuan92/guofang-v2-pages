"use strict";

const CLIENT_BUILD_ID = "54ffc775a1abf5f9bfba";
const taskStorage = {
  getItem(key) { return localStorage.getItem(window.WenshuAccount?.storageKey(key) || key); },
  setItem(key, value) { localStorage.setItem(window.WenshuAccount?.storageKey(key) || key, value); }
};

const state = {
  activeTaskId: "",
  tasks: new Map(),
  defaultModel: "qwen3.8-max",
  defaultEffort: "medium",
  threads: [],
  skill: { base: "", active: "", draft: "" },
  status: null,
  toastTimer: null,
  threadQuery: "",
  taskSequence: 0,
  buildMismatch: false
};
const pendingRenders = new Map();

const $ = (id) => document.getElementById(id);

function normalizeMode(mode) {
  return ["fill", "ppt", "quarterly"].includes(mode) ? mode : "question";
}

function createTaskState(mode, options) {
  const settings = options || {};
  const taskMode = normalizeMode(mode);
  state.taskSequence += 1;
  const now = Date.now();
  const task = {
    taskConfig: settings.taskConfig || {},
    snapshot: settings.snapshot || null,
    planRecord: settings.planRecord || null,
    ppt: settings.ppt || null,
    quarterly: settings.quarterly || null,
    id: settings.id || "task-" + now + "-" + state.taskSequence,
    mode: taskMode,
    threadId: settings.threadId || "",
    model: settings.model || state.defaultModel,
    effort: settings.effort || state.defaultEffort,
    file: taskMode === "fill" ? (settings.file || null) : null,
    fileMissing: taskMode === "fill" ? (settings.fileMissing || null) : null,
    turns: [],
    outputs: settings.outputs || [],
    busy: Boolean(settings.busy),
    historyLoaded: Boolean(settings.historyLoaded),
    historyLoading: Boolean(settings.historyLoading),
    historyLoadError: settings.historyLoadError || "",
    historyLoadToken: 0,
    currentTurnId: "",
    pendingTurn: null,
    pendingPhase: "",
    fillReady: Boolean(settings.fillReady),
    fillPlan: settings.fillPlan || null,
    fillPreviewCompleted: Boolean(settings.fillPreviewCompleted),
    runtimeMessage: settings.runtimeMessage || "准备中",
    followOutput: true,
    openTraces: new Set(),
    createdAt: settings.createdAt || now,
    updatedAt: settings.updatedAt || now
  };
  state.tasks.set(task.id, task);
  return task;
}

function activeTask() {
  return state.activeTaskId ? state.tasks.get(state.activeTaskId) || null : null;
}

function ensureActiveTask(mode) {
  const current = activeTask();
  if (current) return current;
  const task = createTaskState(mode || "question");
  state.activeTaskId = task.id;
  return task;
}

function taskForThread(threadId) {
  if (!threadId) return null;
  for (const task of state.tasks.values()) {
    if (task.threadId === threadId) return task;
  }
  return null;
}

function taskForTurn(turnId) {
  if (!turnId) return null;
  for (const task of state.tasks.values()) {
    if (task.currentTurnId === turnId || task.turns.some((turn) => turn.id === turnId)) {
      return task;
    }
  }
  return null;
}

function touchTask(task) {
  if (task) task.updatedAt = Date.now();
}

function selectTask(taskId) {
  const task = state.tasks.get(taskId);
  if (!task) return null;
  state.activeTaskId = task.id;
  return task;
}

function taskTitle(task) {
  if (!task) return "新任务";
  if (task.mode === "fill" && task.file && task.file.name) return task.file.name;
  for (let index = task.turns.length - 1; index >= 0; index -= 1) {
    if (task.turns[index].user) {
      const value = cleanText(task.turns[index].user).replace(/\s+/g, " ").trim();
      if (value) return value.slice(0, 42);
    }
  }
  return modeName(task.mode) + "任务";
}

function taskStatus(task) {
  if (!task) return { label: "准备", className: "ready" };
  if (task.busy) return { label: "运行中", className: "running" };
  if (task.historyLoadError) return { label: "加载失败", className: "error" };
  if (task.mode === "quarterly" && task.quarterly?.record) return task.quarterly.record.plan.status === "clarification" ? { label: "待补充", className: "waiting" } : { label: task.quarterly.record.state === "generated" ? "已完成" : "待核对", className: "complete" };
  if (task.mode === "ppt" && task.ppt?.record?.plan.status === "clarification") return { label: "待补充", className: "waiting" };
  if (task.mode === "ppt" && task.ppt?.record?.state === "generated") return { label: "已完成", className: "complete" };
  if (task.mode === "fill" && hasFillQuestions(task.fillPlan)) return { label: "待确认", className: "waiting" };
  if (task.mode === "fill" && task.outputs.length) return { label: "已完成", className: "complete" };
  if (task.threadId) return { label: "已就绪", className: "ready" };
  return { label: "新任务", className: "ready" };
}

function persistTasks() {
  const records = Array.from(state.tasks.values()).slice(-12).map((task) => ({
    taskConfig: task.taskConfig,
    snapshot: task.snapshot,
    planRecord: task.planRecord,
    ppt: task.ppt,
    quarterly: task.quarterly,
    id: task.id,
    mode: task.mode,
    threadId: task.threadId,
    model: task.model,
    effort: task.effort,
    file: task.file ? {
      name: task.file.name,
      size: task.file.size,
      runId: task.file.runId,
      sha256: task.file.sha256,
      relativePath: task.file.relativePath,
      workbook: task.file.workbook || null
    } : null,
    fileMissing: task.fileMissing || null,
    outputs: task.outputs,
    historyLoaded: task.historyLoaded,
    fillReady: task.fillReady,
    fillPlan: task.fillPlan,
    fillPreviewCompleted: task.fillPreviewCompleted,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }));
  try {
    taskStorage.setItem("wenshu.v2.tasks", JSON.stringify(records));
    taskStorage.setItem("wenshu.v2.activeTaskId", state.activeTaskId || "");
  } catch {
    // A large browser storage quota should not block the main workflow.
  }
}

function restoreTasks() {
  let records = [];
  try {
    records = JSON.parse(taskStorage.getItem("wenshu.v2.tasks") || "[]");
  } catch {
    records = [];
  }
  if (Array.isArray(records)) {
    records.forEach((record) => {
      if (!record || !record.id) return;
      const restoredMode = record.mode === "fill" || record.file ? "fill" : normalizeMode(record.mode);
      const task = createTaskState(restoredMode, {
        taskConfig: record.taskConfig,
        snapshot: record.snapshot,
        planRecord: record.planRecord,
        ppt: record.ppt,
        quarterly: record.quarterly,
        id: record.id,
        threadId: record.threadId,
        model: record.model,
        effort: record.effort,
         file: restoredMode === "fill" ? record.file : null,
        fileMissing: restoredMode === "fill" ? record.fileMissing : null,
        outputs: Array.isArray(record.outputs) ? record.outputs : [],
        historyLoaded: record.threadId ? false : true,
        fillReady: record.fillReady,
        fillPlan: record.fillPlan,
        fillPreviewCompleted: record.fillPreviewCompleted,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
      task.busy = false;
    });
  }
  const savedId = taskStorage.getItem("wenshu.v2.activeTaskId");
  if (savedId && state.tasks.has(savedId)) state.activeTaskId = savedId;
  if (!activeTask()) state.activeTaskId = createTaskState("question").id;
}

function defineTaskStateAccessors() {
  const properties = [
    "mode", "threadId", "model", "effort", "file", "turns", "outputs", "busy",
    "currentTurnId", "pendingTurn", "fillReady", "fillPlan", "fillPreviewCompleted",
    "runtimeMessage", "followOutput", "openTraces"
  ];
  properties.forEach((property) => {
    Object.defineProperty(state, property, {
      configurable: true,
      get() {
        const task = ensureActiveTask();
        return task[property];
      },
      set(value) {
        const task = ensureActiveTask();
        task[property] = value;
        touchTask(task);
      }
    });
  });
}

defineTaskStateAccessors();

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanText(value) {
  return String(value == null ? "" : value)
    .replace(/\[WENSHU_SKILL_DRAFT\]/g, "")
    .replace(/\[\/WENSHU_SKILL_DRAFT\]/g, "")
    .replace(/\[WENSHU_FILL_PLAN\][\s\S]*?\[\/WENSHU_FILL_PLAN\]/g, "")
    .replace(/\[WENSHU_QUARTERLY_PLAN\][\s\S]*?(?:\[\/WENSHU_QUARTERLY_PLAN\]|$)/g, "")
    .replace(/\[WENSHU_PPT_PLAN\][\s\S]*?(?:\[\/WENSHU_PPT_PLAN\]|$)/g, "")
    .replace(/\[WENSHU_PREVIEW_READY\]/g, "")
    .replace(/\[WENSHU_FILL_DONE\]/g, "")
    .trim();
}

function extractFillPlan(message) {
  const match = String(message || "").match(/\[WENSHU_FILL_PLAN\]([\s\S]*?)\[\/WENSHU_FILL_PLAN\]/);
  if (!match) return null;
  let raw = match[1].trim();
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const plan = JSON.parse(raw);
    if (!plan || typeof plan !== "object") return null;
    return {
      ...plan,
      status: String(plan.status || "invalid").toLowerCase(),
      questions: Array.isArray(plan.questions) ? plan.questions : [],
      updates: Array.isArray(plan.updates) ? plan.updates : [],
      insertRows: Array.isArray(plan.insertRows) ? plan.insertRows : [],
      unmatchedRows: Array.isArray(plan.unmatchedRows) ? plan.unmatchedRows : []
    };
  } catch {
    return null;
  }
}

function syncFillPlanFromTurns(target) {
  const task = target || activeTask();
  if (!task || task.mode !== "fill") return;
  if (task.planRecord) { task.fillPlan = task.planRecord.plan; return task.fillPlan; }
  for (let turnIndex = task.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = task.turns[turnIndex];
    for (let messageIndex = turn.assistant.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const plan = extractFillPlan(turn.assistant[messageIndex].text);
      if (plan) {
        task.fillPlan = plan;
        return plan;
      }
    }
  }
  return task.fillPlan;
}

function hasFillPreviewResult(target) {
  const task = target || activeTask();
  if (!task || task.mode !== "fill") return false;
  return task.turns.some((turn) => isTurnDone(turn) && turn.assistant.some((message) =>
    String(message.text || "").includes("[WENSHU_PREVIEW_READY]") || Boolean(extractFillPlan(message.text))
  ));
}

function syncFillStateFromTurns(target) {
  const task = target || activeTask();
  if (!task || task.mode !== "fill") return;
  syncFillPlanFromTurns(task);
  if (!task.fillPreviewCompleted) task.fillPreviewCompleted = hasFillPreviewResult(task);
  const genericWorkbook = task.file && task.file.workbook && task.file.workbook.kind !== "standard";
  task.fillReady = task.fillPreviewCompleted &&
    (Boolean(task.planRecord) && isFillPlanReady(task.fillPlan) && hasFillChanges(task.fillPlan));
}

function hasFillQuestions(plan) {
  return Boolean(plan && Array.isArray(plan.questions) && plan.questions.length);
}

function hasFillChanges(plan) {
  return Boolean(
    plan && (
      (Array.isArray(plan.updates) && plan.updates.length) ||
      (Array.isArray(plan.insertRows) && plan.insertRows.length) ||
      (Array.isArray(plan.sheets) && plan.sheets.some((sheet) =>
        sheet && Array.isArray(sheet.updateData) && sheet.updateData.length
      ))
    )
  );
}

function isFillPlanReady(plan) {
  if (!plan || hasFillQuestions(plan)) return false;
  return plan.status === "ready";
}

function showToast(message, type) {
  const toast = $("toast");
  toast.textContent = String(message || "");
  toast.className = "toast is-visible" + (type === "error" ? " error" : "");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3600);
}

async function api(endpoint, options) {
  if (state.buildMismatch && !["/api/status", "/api/build"].includes(endpoint)) {
    throw new Error("应用文件已更新，但后台仍是旧版本。请关闭应用后重新启动 2.0 服务。");
  }
  const response = window.WenshuAccount?.identity ? await window.WenshuAccount.fetch(endpoint, options || {}) : await fetch(endpoint, options || {});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

function setBusy(isBusy, target) {
  const task = target || activeTask();
  if (!task) return;
  task.busy = Boolean(isBusy);
  touchTask(task);
  renderTaskList();
  if (task.id !== state.activeTaskId) return;
  const historyBlocked = Boolean(task.threadId && !task.historyLoaded);
  $("sendButton").disabled = Boolean(isBusy || historyBlocked);
  $("attachButton").disabled = isBusy;
  $("confirmWriteButton").disabled = Boolean(isBusy || historyBlocked);
  $("messageInput").disabled = Boolean(isBusy || historyBlocked);
  $("sendButton").querySelector("span").textContent = isBusy ? "…" : "↗";
  $("runtimeStatus").querySelector("span:last-child").textContent = isBusy
    ? "Agent 工作中"
    : state.runtimeMessage;
  renderPpt();
  renderQuarterly();
}

function setRuntimeMessage(message, type, target) {
  const task = target || activeTask();
  if (!task) return;
  task.runtimeMessage = message;
  touchTask(task);
  renderTaskList();
  if (task.id !== state.activeTaskId) return;
  const status = $("runtimeStatus");
  const dot = status.querySelector(".status-dot");
  status.querySelector("span:last-child").textContent = message;
  dot.className = "status-dot" + (type === "ready" ? " ready" : type === "error" ? " error" : "");
}

function modeName(mode) {
  return mode === "quarterly" ? "直投基金季报生成" : mode === "ppt" ? "PPT 制作" : mode === "fill" ? "信披填报" : "智能问数";
}

function threadMode(thread) {
  if (thread && ["fill", "question", "ppt", "quarterly"].includes(thread.mode)) {
    return thread.mode;
  }
  const raw = [thread && thread.preview, thread && thread.title, thread && thread.name]
    .filter((value) => value != null)
    .join("\n");
  return /【直投基金季报生成/.test(raw) ? "quarterly" : /【PPT制作/.test(raw) ? "ppt" : /【信披填报|主文件\s*[：:][^\r\n]*\.xlsx/i.test(raw) ? "fill" : "question";
}

function reconcileTaskModes() {
  let changed = false;
  state.tasks.forEach((task) => {
    if (!task.threadId) return;
    const thread = state.threads.find((entry) => entry.id === task.threadId);
    if (!thread) return;
    const nextMode = threadMode(thread);
    if (task.mode !== nextMode) {
      task.mode = nextMode;
      if (nextMode !== "fill") {
        task.file = null;
        task.fillReady = false;
        task.fillPlan = null;
        task.fillPreviewCompleted = false;
      }
      touchTask(task);
      changed = true;
    }
    if (task.mode !== "fill" && task.file) {
      task.file = null;
      task.fillReady = false;
      task.fillPlan = null;
      task.fillPreviewCompleted = false;
      touchTask(task);
      changed = true;
    }
  });
  if (changed) persistTasks();
  return changed;
}

function setSidebarOpen(isOpen) {
  $("appShell").classList.toggle("is-sidebar-open", Boolean(isOpen));
}

function setInspectorOpen(isOpen) {
  const shell = $("appShell");
  if (window.matchMedia("(max-width: 1060px)").matches) {
    shell.classList.toggle("is-inspector-open", Boolean(isOpen));
    return;
  }
  shell.classList.toggle("is-inspector-hidden", !isOpen);
}

function closeOverlays() {
  setSidebarOpen(false);
  if (window.matchMedia("(max-width: 1060px)").matches) {
    $("appShell").classList.remove("is-inspector-open");
  }
}

function renderActiveTask() {
  const task = activeTask();
  if (!task) return;
  scheduleTaskMemory();
  const historyPending = Boolean(task.threadId && !task.historyLoaded && !task.historyLoadError);
  const historyFailed = Boolean(task.threadId && task.historyLoadError);
  renderTaskConfig();
  state.mode = task.mode;
  document.querySelectorAll(".mode-button[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === task.mode);
  });
  $("modeKicker").textContent = task.mode === "fill" ? "DISCLOSURE MODE" : "QUERY MODE";
  $("workspaceHeading").textContent = modeName(task.mode);
  $("activeTaskName").textContent = taskTitle(task);
  $("contextTask").textContent = modeName(task.mode);
  $("contextTaskMeta").textContent = taskTitle(task);
  $("emptyCode").textContent = historyFailed
    ? "HISTORY / RETRY"
    : historyPending
      ? "HISTORY / RESTORE"
      : task.mode === "fill" ? "GF / DISCLOSURE" : "GF / WORKSPACE";
  $("emptyHeading").textContent = historyFailed
    ? "历史对话暂未恢复"
    : historyPending
      ? "正在恢复对话"
      : task.mode === "fill" ? "把表格交给数据" : "把问题交给数据";
  $("emptyCopy").textContent = historyFailed
    ? "" + task.historyLoadError
    : historyPending
      ? "正在读取当前任务的历史消息和文件状态。"
      : task.mode === "fill"
        ? "先上传一个 .xlsx 文件，完成预览后再确认写回。"
        : "内部业务数据默认从 ai 库开始核验。";
  $("fileSection").classList.toggle("is-hidden", task.mode !== "fill");
  $("retryHistoryButton").classList.toggle("is-hidden", !historyFailed);
  $("modelSelect").value = task.model;
  $("effortSelect").value = task.effort;
  renderFile(task);
  renderOutputs(task);
  renderMessages({ forceScroll: true }, task);
  setBusy(task.busy, task);
  setRuntimeMessage(task.historyLoadError ? "历史恢复失败" : task.runtimeMessage, task.busy ? undefined : task.historyLoadError ? "error" : "ready", task);
  renderTaskList();
  renderThreads();
}

function setMode(mode, createNew) {
  const nextMode = normalizeMode(mode);
  if (createNew) {
    createThread(nextMode).catch((error) => showToast(error.message, "error"));
    return;
  }
  const task = ensureActiveTask(nextMode);
  task.mode = nextMode;
  renderActiveTask();
}

function switchTask(taskId) {
  const task = selectTask(taskId);
  if (!task) return;
  persistTasks();
  renderActiveTask();
  closeOverlays();
  if (task.threadId && !task.historyLoaded) {
    loadThread(task.threadId, { refresh: true, keepCurrentTask: true }).catch(() => {});
  }
}

function populateModels(models) {
  const select = $("modelSelect");
  select.innerHTML = "";
  (models || []).forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name + " · " + model.note;
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === state.model)) {
    select.value = state.model;
  } else if (select.options.length) {
    state.model = select.options[0].value;
    select.value = state.model;
  }
}

function renderStatus(status) {
  state.status = status;
  populateModels(status.models);
  $("mysqlHostInput").value = status.mysqlHost || "";
  $("mysqlPortInput").value = status.mysqlPort || "53307";
  $("mysqlUserInput").value = status.mysqlUser || "";
  $("mysqlPassInput").value = "";
  $("apiKeyInput").value = "";
  const credentialsReady = Boolean(status.hasApiKey && status.mysqlConfigured);
  $("credentialFields").classList.toggle("is-hidden", credentialsReady);
  $("connectionSummary").classList.toggle("is-hidden", !credentialsReady);
  $("editConnectionButton").classList.toggle("is-hidden", !credentialsReady);
  $("saveSettingsButton").classList.toggle("is-hidden", credentialsReady);
  $("connectionSummary").textContent = status.mysqlReachable
    ? "API Key 和数据库只读账号已由本机配置，无需输入。"
    : "API Key 和数据库只读账号已由本机配置。当前网络无法连接数据库，无需重新输入密钥；请接入公司网络后重新检测。";
  $("runtimeProvider").textContent = "DashScope";
  $("contextProvider").textContent = "DashScope / Responses";
  $("runtimeDatabase").textContent = !status.mysqlConfigured
    ? "NOT SET"
    : status.mysqlReachable
      ? "AI"
      : "NETWORK BLOCKED";
  $("runtimeAgent").textContent = status.codexReady ? "CODEX APP-SERVER" : "RUNTIME MISSING";
  const missingConfiguration = !status.hasApiKey || !status.mysqlConfigured;
  const missingRuntime = !status.codexReady || (status.mysqlConfigured && !status.mcpConfigured);
  const networkBlocked = credentialsReady && status.mcpConfigured && status.mysqlReachable === false;
  if (status.databaseEnabled === false && status.hasApiKey && status.codexReady) {
    $("setupBanner").classList.remove("is-hidden");
    $("setupTitle").textContent = "云端试运行 · 数据库待验证";
    $("setupMessage").textContent = "账户和 Agent 已连接。数据库查询暂未启用，待公司网络验证后开放基金问数与数据填报。";
    $("setupButton").textContent = "重新检测";
    $("runtimeDatabase").textContent = "待验证";
    setRuntimeMessage("Agent 就绪 · 数据库待验证", "ready");
    return;
  }
  if (missingConfiguration || missingRuntime || networkBlocked) {
    $("setupBanner").classList.remove("is-hidden");
    $("setupTitle").textContent = missingConfiguration ? "应用连接信息未就绪" : missingRuntime ? "应用组件未就绪" : "数据库暂时无法连接";
    $("setupMessage").textContent = missingConfiguration
      ? "请联系维护人员补齐本机连接信息，然后重新检测。"
      : missingRuntime
        ? "请联系维护人员检查应用运行环境，然后重新检测。"
        : "连接信息已配置。请接入公司网络或确认访问权限，然后重新检测；无需输入密钥。";
    $("setupButton").textContent = "重新检测";
    setRuntimeMessage(networkBlocked ? "数据库网络不可达" : "待配置");
  } else {
    $("setupBanner").classList.add("is-hidden");
    setRuntimeMessage("连接就绪", "ready");
  }
}

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) {
      const millis = number < 100000000000 ? number * 1000 : number;
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatThreadDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function threadTitle(thread) {
  const raw = thread.preview || thread.title || thread.name || "";
  const firstLine = String(raw).split(/\r?\n/).find((line) => line.trim()) || "";
  return firstLine.trim().slice(0, 80) || (thread.id === state.threadId ? "当前对话" : "未命名对话");
}

function renderTaskList() {
  const list = $("taskList");
  if (!list) return;
  const tasks = Array.from(state.tasks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!tasks.length) {
    list.innerHTML = '<div class="task-empty">暂无工作任务</div>';
    return;
  }
  list.innerHTML = tasks.map((task) => {
    const status = taskStatus(task);
    const type = modeName(task.mode);
    const title = taskTitle(task);
    const meta = task.mode === "fill" && task.file && task.file.name
      ? "XLSX · " + (task.file.workbook && task.file.workbook.sheetCount ? task.file.workbook.sheetCount + " 个 Sheet" : "工作簿")
      : (task.threadId ? "已连接 · " + (task.model || state.defaultModel) : "等待发送");
    return '<button class="task-item ' + (task.id === state.activeTaskId ? "is-active" : "") + '" data-task-id="' +
      escapeHtml(task.id) + '" type="button" aria-label="打开' + escapeHtml(type + " " + title) + '">' +
      '<span class="task-item-top"><span class="task-type"><span class="task-mode-mark ' + escapeHtml(task.mode) + '">' +
      (task.mode === "quarterly" ? "▥" : task.mode === "ppt" ? "▧" : task.mode === "fill" ? "▤" : "?") + '</span>' + escapeHtml(type) + '</span><span class="task-status ' +
      escapeHtml(status.className) + '"><span class="status-dot ' + (status.className === "running" ? "" : status.className === "complete" ? "ready" : status.className === "error" ? "error" : "quiet") + '"></span>' +
      escapeHtml(status.label) + '</span></span>' +
      '<span class="task-item-title">' + escapeHtml(title) + '</span>' +
      '<span class="task-item-meta">' + escapeHtml(meta) + '</span></button>';
  }).join("");
  list.querySelectorAll("[data-task-id]").forEach((button) => {
    button.addEventListener("click", () => switchTask(button.dataset.taskId));
  });
}

function renderThreads() {
  const list = $("threadList");
  const query = state.threadQuery.trim().toLowerCase();
  const currentMode = activeTask() ? activeTask().mode : "";
  const threads = state.threads
    .filter((thread) => !currentMode || threadMode(thread) === currentMode)
    .slice(0, 50)
    .filter((thread) => !query || threadTitle(thread).toLowerCase().includes(query));
  if (!threads.length) {
    list.innerHTML = '<div class="thread-empty">' + (query ? "没有匹配的对话" : "暂无历史对话") + "</div>";
    return;
  }
  list.innerHTML = threads
    .map((thread) => {
      const date = thread.updatedAt || thread.updated_at || thread.createdAt || thread.created_at || "";
      return (
        '<button class="thread-item ' + (thread.id === state.threadId ? "is-active" : "") + '" data-thread-id="' +
        escapeHtml(thread.id) + '" type="button">' +
        '<span class="thread-title">' + escapeHtml(threadTitle(thread)) + "</span>" +
        '<span class="thread-date">' + escapeHtml(formatThreadDate(date)) + "</span></button>"
      );
    })
    .join("");
  list.querySelectorAll("[data-thread-id]").forEach((button) => {
    button.addEventListener("click", () => loadThread(button.dataset.threadId));
  });
}

function itemText(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.content)) {
    return item.content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("");
  }
  if (Array.isArray(item.summary)) return item.summary.map((part) => String(part || "")).join("\n");
  return "";
}

function displayUserMessage(text) {
  const value = String(text || "").trim().replace(/^【本轮适用偏好，由应用管理】[\s\S]*?\n\n【本次用户任务及资料】\n/, "");
  if (!value) return "";
  if (value.startsWith("【PPT制作")) return value.match(/用户指令：([\s\S]*?)(?:\n\n|$)/)?.[1] || "制作 PPT 大纲";
  if (value.startsWith("【直投基金季报生成")) return value.match(/用户指令：([\s\S]*?)(?:\n\n|$)/)?.[1] || "编制直投基金季报";
  if (value.includes("【信披填报：上传文件后的自动识别预览】") ||
      value.includes("【信披填报：固定模板预览阶段】") ||
      value.includes("【信披填报：用户指令+工作簿预览】") ||
      value.includes("【信披填报：用户补充确认】")) {
    const userLine = value.match(/本次填报指令[^：:\r\n]*[：:]\s*([^\r\n]+)/) ||
      value.match(/用户(?:补充要求|要求)[：:]\s*([^\r\n]+)/);
    const userText = userLine && userLine[1] && !userLine[1].startsWith("（无")
      ? userLine[1].trim()
      : "";
    return userText || "分析已上传的工作簿";
  }
  if (value.includes("【信披填报：用户已确认写回】")) {
    return "确认写回当前文件";
  }
  return value;
}

function newTurn(id, target) {
  const task = target || activeTask();
  return {
    id: id || "turn-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    user: "",
    userAt: null,
    assistant: [],
    reasoning: [],
    activity: [],
    outputs: [],
    status: "in_progress",
    startedAt: null,
    completedAt: null,
    error: "",
    model: task ? task.model : state.defaultModel
  };
}

function isTurnDone(turn) {
  return ["completed", "failed", "interrupted", "cancelled"].includes(turn.status);
}

function extractHistory(payload, target) {
  const record = payload || {};
  const thread = record.thread || record;
  const sourceTurns = record.turns || thread.turns || [];
  return sourceTurns.map((rawTurn, index) => {
    const turn = newTurn(rawTurn.id || "history-" + index, target);
    turn.status = rawTurn.status || "completed";
    turn.startedAt = rawTurn.startedAtMs || rawTurn.startedAt || rawTurn.createdAt || null;
    turn.completedAt = rawTurn.completedAtMs || rawTurn.completedAt || rawTurn.updatedAt || null;
    turn.outputs = Array.isArray(rawTurn.outputs) ? rawTurn.outputs : [];
    const items = Array.isArray(rawTurn.items) ? rawTurn.items : [];
    items.forEach((item) => {
      const type = item && item.type;
      if (type === "userMessage") {
        const text = itemText(item);
        if (text) turn.user = displayUserMessage(text);
        return;
      }
      if (type === "agentMessage") {
        const text = itemText(item);
        if (text) turn.assistant.push({ id: item.id || "assistant-" + turn.assistant.length, text });
        return;
      }
      if (type === "reasoning") {
        const text = itemText(item);
        if (text) turn.reasoning.push({ id: item.id || "reasoning-" + turn.reasoning.length, text });
        return;
      }
      const text = itemText(item) || activityText(item);
      if (text) turn.activity.push({ id: item.id || "activity-" + turn.activity.length, text });
    });
    if (!turn.user && Array.isArray(rawTurn.input)) {
      const inputText = rawTurn.input.map((item) => (item && item.text ? item.text : "")).join("").trim();
      if (inputText) turn.user = displayUserMessage(inputText);
    }
    return turn;
  }).filter((turn) => turn.user || turn.assistant.length || turn.reasoning.length || turn.activity.length);
}

function activityText(item) {
  if (!item) return "";
  const type = String(item.type || "活动");
  const command = item.command || item.cmd || item.name || item.tool || "";
  if (command) return type + " · " + String(command);
  if (type === "commandExecution") return "执行本机命令";
  if (type === "mcpToolCall") return "调用数据库 MCP";
  return type;
}

function findTurn(id, create, target) {
  const task = target || activeTask();
  if (!task) return null;
  const requestedId = id || task.currentTurnId;
  let turn = requestedId ? task.turns.find((entry) => entry.id === requestedId) : null;
  if (!turn && task.pendingTurn && requestedId) {
    const oldId = task.pendingTurn.id;
    const existing = task.turns.find((entry) => entry.id === requestedId);
    if (existing && existing !== task.pendingTurn) {
      if (!existing.user) existing.user = task.pendingTurn.user;
      turn = existing;
      task.turns = task.turns.filter((entry) => entry !== task.pendingTurn);
    } else {
      task.pendingTurn.id = requestedId;
      turn = task.pendingTurn;
    }
    task.openTraces.delete(oldId);
    task.currentTurnId = requestedId;
    task.pendingTurn = null;
  }
  if (!turn && create) {
    turn = newTurn(requestedId, task);
    task.turns.push(turn);
    task.currentTurnId = turn.id;
  }
  return turn;
}

function findAssistant(turn, itemId, create) {
  if (!turn) return null;
  let message = turn.assistant.find((entry) => entry.id === itemId);
  if (!message && create) {
    message = { id: itemId || "assistant-" + turn.assistant.length, text: "" };
    turn.assistant.push(message);
  }
  return message;
}

function findReasoning(turn, itemId, create) {
  if (!turn) return null;
  let entry = turn.reasoning.find((item) => item.id === itemId);
  if (!entry && create) {
    entry = { id: itemId || "reasoning-" + turn.reasoning.length, text: "" };
    turn.reasoning.push(entry);
  }
  return entry;
}

function findActivity(turn, itemId, create, initialText) {
  if (!turn) return null;
  let entry = turn.activity.find((item) => item.id === itemId);
  if (!entry && create) {
    entry = { id: itemId || "activity-" + turn.activity.length, text: initialText || "" };
    turn.activity.push(entry);
  }
  return entry;
}

function compactTraceText(value, limit) {
  const text = cleanText(value).replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1) + "…";
}

function formatInline(value) {
  return escapeHtml(value)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
}

function splitTableCells(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function renderMarkdown(value) {
  const lines = String(value == null ? "" : value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = "";
  let codeLines = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n").trim();
    if (text) html.push("<p>" + formatInline(text).replace(/\n/g, "<br />") + "</p>");
    paragraph = [];
  };

  const closeList = () => {
    if (listType) html.push("</" + listType + ">");
    listType = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (codeLines !== null) {
      if (trimmed.startsWith("```")) {
        html.push("<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      flushParagraph();
      closeList();
      codeLines = [];
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      closeList();
      const headers = splitTableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitTableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      html.push('<div class="message-table-wrap"><table class="message-table"><thead><tr>' +
        headers.map((cell) => "<th>" + formatInline(cell) + "</th>").join("") +
        "</tr></thead><tbody>" + rows.map((row) => "<tr>" + headers.map((_, cellIndex) => "<td>" + formatInline(row[cellIndex] || "") + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div>");
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push("<h" + level + ">" + formatInline(heading[2]) + "</h" + level + ">");
      continue;
    }
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push("<blockquote>" + formatInline(quote[1]) + "</blockquote>");
      continue;
    }
    const ordered = trimmed.match(/^\d+[.]\s+(.+)$/);
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const nextListType = ordered ? "ol" : "ul";
      if (listType && listType !== nextListType) closeList();
      if (!listType) {
        listType = nextListType;
        html.push("<" + listType + ">");
      }
      html.push("<li>" + formatInline((ordered || unordered)[1]) + "</li>");
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push("<hr />");
      continue;
    }
    if (listType) closeList();
    paragraph.push(line);
  }
  if (codeLines !== null) html.push("<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
  flushParagraph();
  closeList();
  return html.join("");
}

function traceEntries(turn) {
  const entries = [];
  turn.reasoning.forEach((entry) => {
    const text = compactTraceText(entry.text, 1200);
    if (text) entries.push({ kind: "reasoning", text });
  });
  turn.activity.forEach((entry) => {
    const text = compactTraceText(entry.text, 900);
    if (text) entries.push({ kind: "activity", text });
  });
  const answerIndex = [...turn.assistant].map((entry) => cleanText(entry.text)).reduce((last, text, index) => text ? index : last, -1);
  turn.assistant.forEach((entry, index) => {
    if (index === answerIndex) return;
    const text = compactTraceText(entry.text, 900);
    if (text) entries.push({ kind: "activity", text });
  });
  return entries;
}

function lastAssistant(turn) {
  for (let index = turn.assistant.length - 1; index >= 0; index -= 1) {
    if (cleanText(turn.assistant[index].text)) return turn.assistant[index];
  }
  return null;
}

function formatFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "Excel 文件";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function outputCardMarkup(file, compact) {
  if (!file || !file.name || !file.downloadUrl) return "";
  const name = escapeHtml(file.name);
  const url = escapeHtml(file.downloadUrl);
  const size = escapeHtml(formatFileSize(file.size));
  const isPpt = /\.pptx$/i.test(file.name);
  const type = /\.docx$/i.test(file.name) ? "Word" : /\.pdf$/i.test(file.name) ? "PDF" : isPpt ? "PPTX" : "XLSX";
  if (compact) {
    return '<div class="output-item" title="' + name + '">' +
      '<div class="output-file-icon" aria-hidden="true">' + type + '</div>' +
      '<a class="output-file-name" href="' + url + '" download="' + name + '" title="下载 ' + name + '">' + name + '</a>' +
      '<span class="output-file-size">' + size + '</span>' +
      '<a class="download-link" href="' + url + '" download="' + name + '" title="下载文件" aria-label="下载 ' + name + '">↓</a>' +
      '</div>';
  }
  return '<div class="output-card">' +
    '<div class="output-card-icon" aria-hidden="true">' + type + '</div>' +
    '<div class="output-card-copy"><div class="output-card-label">' + (["Word", "PDF"].includes(type) ? "已生成季报文件" : isPpt ? "已生成 PPT" : "已生成填报文件") + '</div><strong title="' + name + '">' + name + '</strong><span>' + size + ' · 原始文件未修改</span></div>' +
    '<a class="output-card-download" href="' + url + '" download="' + name + '" title="下载生成文件">下载 ' + (["Word", "PDF"].includes(type) ? type : isPpt ? "PPT" : "Excel") + ' <span aria-hidden="true">↘</span></a>' +
    '</div>';
}

function outputCardsMarkup(files, compact) {
  return (Array.isArray(files) ? files : []).map((file) => outputCardMarkup(file, compact)).join("");
}

function renderTurn(turn, index, target) {
  const task = target || activeTask();
  const turnId = escapeHtml(turn.id);
  const time = formatTime(turn.startedAt || turn.userAt);
  const trace = traceEntries(turn);
  const traceVisible = trace.slice(-12);
  const answer = lastAssistant(turn);
  const answerRaw = answer ? String(answer.text || "") : "";
  const answerText = cleanText(answerRaw);
  const turnOutputs = Array.isArray(turn.outputs) && turn.outputs.length
    ? turn.outputs
    : target.mode !== "question" && index === target.turns.length - 1
      ? target.outputs
      : [];
  const statusText = turn.status === "failed" || turn.error ? "失败" : isTurnDone(turn) ? "已完成" : "处理中";
  const traceMarkup = trace.length
    ? '<details class="trace-panel" data-trace-id="' + turnId + '"' + (task.openTraces.has(turn.id) ? " open" : "") + '>' +
      '<summary><span class="trace-title">运行轨迹</span><span class="trace-count">' + trace.length + ' 项</span><span class="trace-status">' + statusText + '</span></summary>' +
      '<div class="trace-list">' + traceVisible.map((entry) => '<div class="trace-item ' + entry.kind + '">' + escapeHtml(entry.text) + "</div>").join("") + "</div></details>"
    : "";
  let answerMarkup;
  if (turn.error) {
    answerMarkup = '<div class="system-turn">' + escapeHtml(turn.error) + "</div>";
  } else if (answerText) {
    const skillAction = answerRaw.includes("[WENSHU_SKILL_DRAFT]")
      ? '<div class="message-actions"><button class="small-action" data-skill-turn="' + turnId + '" type="button">在规则工作台核对</button></div>'
      : "";
    answerMarkup = '<div class="message-text">' + renderMarkdown(answerText) + "</div>" + skillAction + (turn.memoryReceipt ? memoryReceiptMarkup(turn.memoryReceipt) : "") +
      (turnOutputs.length ? '<div class="message-outputs">' + outputCardsMarkup(turnOutputs, false) + '</div>' : "");
  } else {
    answerMarkup = '<div class="answer-placeholder"><strong>' + (turn.status === "failed" ? "本轮未完成" : "正在整理结果") + '</strong><span>' +
      (turn.status === "failed" ? "请查看运行轨迹或重新发送问题。" : "数据库核验和结果格式化完成后，答案会显示在这里。") +
      "</span></div>" + (turnOutputs.length ? '<div class="message-outputs">' + outputCardsMarkup(turnOutputs, false) + '</div>' : "");
  }
  const pendingClass = answerText ? "" : " is-pending";
  const userMarkup = turn.user
    ? '<div class="turn-user"><div class="turn-avatar user" aria-hidden="true">你</div><div class="turn-main"><div class="turn-label">你的问题' +
      (time ? '<span class="turn-time">' + escapeHtml(time) + "</span>" : "") +
      '</div><div class="user-bubble"><div class="message-text">' + renderMarkdown(cleanText(turn.user)) + "</div></div></div></div>"
    : "";
  return '<article class="turn-group" data-turn-index="' + index + '">' + userMarkup +
    '<div class="agent-turn"><div class="turn-avatar agent" aria-hidden="true">G</div><div class="turn-main agent-body">' +
    '<div class="turn-label">国方 Agent<span class="agent-meta">' + escapeHtml(statusText) + "</span></div>" +
    traceMarkup + '<div class="answer-block' + pendingClass + '">' + answerMarkup + "</div></div></div></article>";
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 96;
}

function updateJumpButton() {
  const conversation = $("conversation");
  const button = $("jumpToLatest");
  button.classList.toggle("is-visible", conversation.scrollHeight > conversation.clientHeight + 40 && !isNearBottom(conversation));
}

function scrollToLatest(force) {
  if (force) state.followOutput = true;
  const conversation = $("conversation");
  window.requestAnimationFrame(() => {
    conversation.scrollTo({ top: conversation.scrollHeight, behavior: force ? "smooth" : "auto" });
    updateJumpButton();
  });
}

function renderMessages(options, target) {
  const task = target || activeTask();
  if (!task || task.id !== state.activeTaskId) return;
  const settings = options || {};
  const conversation = $("conversation");
  const shouldScroll = Boolean(settings.forceScroll) || (task.followOutput && isNearBottom(conversation));
  syncFillPlanFromTurns(task);
  $("emptyState").classList.toggle("is-hidden", task.turns.length > 0);
  $("messages").innerHTML = task.turns.map((turn, index) => renderTurn(turn, index, task)).join("");
  $("messages").querySelectorAll("[data-trace-id]").forEach((details) => {
    details.addEventListener("toggle", () => {
      const id = details.dataset.traceId;
      if (details.open) task.openTraces.add(id);
      else task.openTraces.delete(id);
    });
  });
  $("messages").querySelectorAll("[data-skill-turn]").forEach((button) => {
    button.addEventListener("click", () => {
      const turn = task.turns.find((entry) => entry.id === button.dataset.skillTurn);
      const answer = turn && lastAssistant(turn);
      const draft = answer && extractAssistantDraft(answer.text);
      if (!draft) return;
      $("skillDraftInput").value = draft;
      openDialog("skillDialog");
      showToast("业务规则建议已载入，请填写适用范围后检查并启用。");
    });
  });
  bindMemoryReceipts($("messages"));
  renderFillReview();
  if (shouldScroll) scrollToLatest(false);
  else updateJumpButton();
}

function renderFile(target) {
  const task = target || activeTask();
  if (!task || task.id !== state.activeTaskId) return;
  const isFill = task.mode === "fill";
  renderPpt();
  renderQuarterly();
  if (["ppt", "quarterly"].includes(task.mode)) { renderFillReview(); return; }
  $("attachButton").title="上传 .xlsx 文件"; $("attachButton").setAttribute("aria-label","上传 .xlsx 文件");
  $("attachButton").classList.toggle("is-hidden", !isFill);
  $("composerModeHint").textContent = isFill
    ? task.file ? "信披填报 · " + task.file.name : "信披填报 · 等待上传文件"
    : "智能问数 · 只读数据库";
  $("messageInput").placeholder = isFill
    ? task.file
      ? task.fillPreviewCompleted || task.fillPlan
        ? "补充填报要求（可选）"
        : "输入填报指令（字段、范围、数据时点和口径）"
      : "先上传一个 .xlsx 文件"
    : "输入基金数据问题";
  const fileName = $("fileName");
  const fileMeta = $("fileMeta");
  if (!task.file) {
    fileName.textContent = task.fileMissing ? "原 Excel 不可用" : "等待上传";
    fileMeta.textContent = task.fileMissing
      ? task.fileMissing.name + " · 请重新上传"
      : "仅支持一个 .xlsx";
    $("removeFileButton").disabled = true;
    renderFillReview();
    return;
  }
  fileName.textContent = task.file.name;
  const workbook = task.file.workbook;
  const sheetCount = workbook && workbook.sheetCount ? workbook.sheetCount + " 个 Sheet" : "工作簿已读取";
  const kind = workbook && workbook.kind === "standard" ? "固定模板" : "按列名识别";
  fileMeta.textContent = (task.file.size / 1024).toFixed(1) + " KB · " + sheetCount + " · " + kind;
  $("removeFileButton").disabled = false;
  renderFillReview();
}

function renderOutputs(target) {
  const task = target || activeTask();
  if (!task || task.id !== state.activeTaskId) return;
  const list = $("outputList");
  $("outputCount").textContent = String(task.outputs.length);
  if (!task.outputs.length) {
    list.innerHTML = '<div class="muted-line">暂无生成文件</div>';
    return;
  }
  list.innerHTML = outputCardsMarkup(task.outputs, true);
}

function fillPlanChangeCount(plan) {
  if (!plan) return 0;
  let count = Array.isArray(plan.updates) ? plan.updates.length : 0;
  count += Array.isArray(plan.insertRows) ? plan.insertRows.length : 0;
  if (Array.isArray(plan.sheets)) {
    count += plan.sheets.reduce((total, sheet) => {
      return total + (sheet && Array.isArray(sheet.updateData) ? sheet.updateData.reduce((sum, row) => {
        return sum + Object.keys((row && row.updateData) || {}).length;
      }, 0) : 0);
    }, 0);
  }
  return count;
}

function renderFillReview() {
  const review = $("fillReview");
  if (!review) return;
  const action = $("fillAction");
  const task = activeTask();
  if (!task || task.mode !== "fill" || !task.file || task.outputs.length) {
    review.classList.add("is-hidden");
    action.classList.add("is-hidden");
    return;
  }

  const plan = task.fillPlan;
  const questions = plan && Array.isArray(plan.questions) ? plan.questions : [];
  const changeCount = fillPlanChangeCount(plan);
  let title = task.busy ? "正在执行填报预览" : "已读取工作簿";
  let meta = task.busy
    ? "Agent 正在结合你的指令和工作簿定位数据并查询数据库。"
    : "请在下方输入本次填报指令，说明字段、范围、数据时点和口径。";
  let body = '<div class="fill-review-progress"><span class="status-dot"></span><span>' +
    (task.busy ? "正在结合指令识别待填内容并核对数据库" : "等待输入填报指令") + "</span></div>";
  let ready = false;

  if (questions.length) {
    title = "需要确认后继续";
    meta = "有 " + questions.length + " 项信息无法安全推断，已暂停写回。";
    body = questions.map((question, index) => {
      const options = Array.isArray(question.options) ? question.options : [];
      const optionMarkup = options.map((option) => {
        const value = option && option.value != null ? String(option.value) : "";
        const label = option && option.label != null ? String(option.label) : value;
        return '<button class="clarification-option" type="button" data-fill-answer="' +
          escapeHtml("针对" + (question.id || "问题" + (index + 1)) + "，我确认选择：" + label + "（" + value + "）") + '">' +
          escapeHtml(label) + "</button>";
      }).join("");
      return '<div class="clarification-item"><div class="clarification-index">' +
        String(index + 1).padStart(2, "0") + '</div><div class="clarification-copy"><strong>' +
        escapeHtml(question.question || "请确认填报口径") + "</strong>" +
        (question.reason ? "<span>" + escapeHtml(question.reason) + "</span>" : "") +
        (optionMarkup ? '<div class="clarification-options">' + optionMarkup + "</div>" : "") +
        "</div></div>";
    }).join("");
    action.classList.add("is-hidden");
  } else if (task.fillPreviewCompleted && task.planRecord && plan && isFillPlanReady(plan) && hasFillChanges(plan)) {
    title = "预览已完成";
    meta = changeCount + " 项内容待写回；确认后生成新的 Excel，不修改原文件。";
    const previewRows = (plan.updates || []).slice(0, 8).map((item) =>
      "<tr><td>" + escapeHtml(item.sheetName || ("Sheet " + (item.sheetIndex || ""))) + "</td>" +
      "<td>" + escapeHtml(String(item.column || "") + String(item.row || "")) + "</td>" +
      "<td>" + escapeHtml(item.columnTitle || "") + "</td>" +
      "<td>" + escapeHtml(item.value == null ? "" : String(item.value)) + "</td></tr>"
    ).join("");
    body = '<div class="fill-review-summary">' + escapeHtml(plan.summary || "已根据工作簿中的空白待填列生成更新计划。") + "</div>" +
      (previewRows ? '<div class="fill-preview-table-wrap"><table class="fill-preview-table"><thead><tr><th>工作表</th><th>单元格</th><th>字段</th><th>拟写入</th></tr></thead><tbody>' + previewRows + "</tbody></table></div>" : "") +
      '<button class="small-action" type="button" id="fullReviewButton">查看全部变更、原值与数据依据 ↗</button>';
    ready = true;
  } else if (task.fillPreviewCompleted && plan && !hasFillChanges(plan)) {
    title = "没有需要写回的内容";
    meta = "数据库结果与当前工作簿一致，或没有匹配到可安全填写的数据。";
    body = '<div class="fill-review-summary">' + escapeHtml(plan.summary || "本轮没有产生可写回的更新项。") + "</div>";
    action.classList.add("is-hidden");
  }

  review.classList.remove("is-hidden");
  $("fillReviewTitle").textContent = title;
  $("fillReviewMeta").textContent = meta;
  $("fillReviewBody").innerHTML = body;
  if (ready) action.classList.remove("is-hidden");
  else if (!questions.length) action.classList.add("is-hidden");

  if ($("fullReviewButton")) $("fullReviewButton").onclick = openFullReview;
  review.querySelectorAll("[data-fill-answer]").forEach((button) => {
    button.addEventListener("click", () => {
      $("messageInput").value = button.dataset.fillAnswer || "";
      resizeComposer();
      sendMessage("clarification");
    });
  });
}

async function uploadFile(file, target) {
  const task = target || activeTask();
  if (!task || task.mode !== "fill") {
    showToast("智能问数不需要上传文件。");
    return;
  }
  if (!file || !file.name.toLowerCase().endsWith(".xlsx")) {
    showToast("第一版只支持普通 .xlsx 文件。", "error");
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast("文件超过 50MB。", "error");
    return;
  }
  if (task.id === state.activeTaskId) {
    $("fileName").textContent = "正在读取工作簿…";
    $("fileMeta").textContent = file.name;
  }
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(",");
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const response = await api("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, dataBase64: base64, runId: task.id })
    });
    task.file = response.data;
    task.fileMissing = null;
    task.outputs = [];
    task.fillReady = false;
    task.fillPlan = null;
    task.planRecord = null;
    task.fillPreviewCompleted = false;
    touchTask(task);
    persistTasks();
    if (task.id === state.activeTaskId) {
      $("fillAction").classList.add("is-hidden");
      renderFile(task);
      renderFillReview();
      renderTaskList();
      showToast("已读取工作簿，请输入填报指令后开始预览。");
    }
  } catch (error) {
    if (task.id === state.activeTaskId) {
      renderFile(task);
      showToast(error.message, "error");
    }
  }
}

function extractAssistantDraft(message) {
  const match = String(message || "").match(/\[WENSHU_SKILL_DRAFT\]([\s\S]*?)\[\/WENSHU_SKILL_DRAFT\]/);
  return match ? match[1].trim() : "";
}

function taskForEvent(params) {
  const threadTask = taskForThread(params.threadId);
  if (threadTask) return threadTask;
  const turnTask = taskForTurn(params.turnId || (params.turn && params.turn.id));
  if (turnTask) return turnTask;
  return params.threadId || params.turnId ? null : activeTask();
}

function renderTaskAfterEvent(task, options) {
  if (!task || task.id !== state.activeTaskId) return;
  const previous = pendingRenders.get(task.id) || {};
  pendingRenders.set(task.id, { ...previous, ...(options || {}) });
  if (previous.queued) return;
  pendingRenders.set(task.id, { ...pendingRenders.get(task.id), queued: true });
  window.requestAnimationFrame(() => {
    const renderOptions = pendingRenders.get(task.id) || {};
    pendingRenders.delete(task.id);
    if (task.id !== state.activeTaskId) return;
    renderMessages(renderOptions, task);
    renderFile(task);
    renderOutputs(task);
  });
}

function handleEvent(event) {
  const method = event.method;
  const params = event.params || {};
  const task = taskForEvent(params);

  if (method === "mcpServer/startupStatus/updated") {
    const name = params.name || "MCP";
    const status = params.status || "";
    if (status === "ready") setRuntimeMessage(name + " 已就绪", "ready", task);
    else if (status === "error" || status === "failed") setRuntimeMessage(name + " 启动失败", "error", task);
    else setRuntimeMessage(name + " 启动中", undefined, task);
    return;
  }

  if (method === "server/request") {
    showToast("Agent 请求确认：" + (params.method || "未知请求"));
    return;
  }

  if (method === "app/processExited" && !params.expected) {
    state.tasks.forEach((entry) => {
      if (entry.busy) {
        entry.busy = false;
        entry.runtimeMessage = "Agent 已退出";
        touchTask(entry);
      }
    });
    renderTaskList();
    setRuntimeMessage("Agent 已退出", "error");
    setBusy(false);
    return;
  }

  if (!task) return;
  if (method === "app/quarterlyPlanValidated") {
    quarterlyData(task).record=params.record; refreshTaskRecord(task).then(()=>renderTaskAfterEvent(task)).catch(e=>showToast(e.message,"error"));return;
  }
  if (method === "app/quarterlyPlanRejected") {
    quarterlyData(task).record=null;showToast(params.message||"季报内容核对失败，请重试","error");return;
  }
  if (method === "app/pptPlanValidated") {
    pptTaskData(task).record=params.record; refreshTaskRecord(task).then(()=>renderTaskAfterEvent(task)).catch(e=>showToast(e.message,"error"));
    persistTasks(); renderTaskAfterEvent(task); return;
  }
  if (method === "app/pptPlanRejected") {
    pptTaskData(task).record=null;
    const turn = findTurn(params.turnId || task.currentTurnId, false, task);
    if (turn) {
      turn.error = "未能保存 PPT 大纲：" + params.message;
      turn.status = "failed";
    }
    setBusy(false, task);
    setRuntimeMessage("大纲校验未通过："+params.message,"error",task);
    if(task.id===state.activeTaskId)showToast(params.message,"error");persistTasks();renderTaskAfterEvent(task);return;
  }
  if (method === "app/planValidated") {
    task.planRecord = params.record; task.fillPlan = params.record.plan;
    task.fillPreviewCompleted = true; task.fillReady = isFillPlanReady(task.fillPlan) && hasFillChanges(task.fillPlan);
    persistTasks(); renderTaskAfterEvent(task); return;
  }
  if (method === "app/planRejected") {
    task.planRecord = null; task.fillReady = false; task.fillPreviewCompleted = false;
    setRuntimeMessage("预览校验未通过：" + params.message, "error", task);
    if (task.id === state.activeTaskId) showToast(params.message, "error");
    persistTasks(); renderTaskAfterEvent(task); return;
  }

  if (method === "turn/started") {
    const turnId = params.turn && params.turn.id ? params.turn.id : params.turnId;
    const turn = findTurn(turnId, true, task);
    turn.status = "in_progress";
    turn.startedAt = (params.turn && (params.turn.startedAtMs || params.turn.startedAt)) || turn.startedAt || Date.now();
    task.currentTurnId = turn.id;
    setBusy(true, task);
    setRuntimeMessage("Agent 工作中", undefined, task);
    renderTaskAfterEvent(task, { forceScroll: task.followOutput });
    return;
  }

  if (method === "item/started") {
    const item = params.item || {};
    const turn = findTurn(params.turnId, true, task);
    if (item.type === "agentMessage") findAssistant(turn, item.id, true);
    else if (item.type === "reasoning") findReasoning(turn, item.id, true);
    else findActivity(turn, item.id, true, activityText(item));
    touchTask(task);
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "item/agentMessage/delta") {
    const turn = findTurn(params.turnId, true, task);
    const message = findAssistant(turn, params.itemId, true);
    message.text += String(params.delta || "");
    touchTask(task);
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "item/reasoning/textDelta") {
    const turn = findTurn(params.turnId, true, task);
    const entry = findReasoning(turn, params.itemId, true);
    entry.text += String(params.delta || "");
    touchTask(task);
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "item/commandExecution/outputDelta") {
    const turn = findTurn(params.turnId, true, task);
    const entry = findActivity(turn, params.itemId, true, "执行本机命令");
    entry.text += String(params.delta || "");
    touchTask(task);
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "item/commandExecution/requestApproval") {
    const turn = findTurn(params.turnId, true, task);
    findActivity(turn, params.itemId, true, "等待命令确认");
    touchTask(task);
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "item/completed" && params.item) {
    const item = params.item;
    const turn = findTurn(params.turnId, true, task);
    const text = itemText(item);
    if (item.type === "agentMessage") {
      const message = findAssistant(turn, item.id, true);
      if (text.length >= message.text.length) message.text = text;
    } else if (item.type === "reasoning") {
      const entry = findReasoning(turn, item.id, true);
      if (text.length >= entry.text.length) entry.text = text;
    } else {
      const entry = findActivity(turn, item.id, true, activityText(item));
      if (text && text.length >= entry.text.length) entry.text = text;
    }
    touchTask(task);
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "turn/completed") {
    const turnInfo = params.turn || {};
    const turn = findTurn(turnInfo.id || params.turnId, true, task);
    const completedPhase = task.pendingPhase;
    turn.status = turnInfo.status || "completed";
    turn.completedAt = turnInfo.completedAtMs || turnInfo.completedAt || Date.now();
    if (task.pendingTurn === turn) task.pendingTurn = null;
    task.pendingPhase = "";
    if (task.mode === "fill" && completedPhase !== "commit") {
      task.fillPreviewCompleted = turn.status === "completed";
      syncFillPlanFromTurns(task);
      const genericWorkbook = task.file && task.file.workbook && task.file.workbook.kind !== "standard";
      task.fillReady = task.fillPreviewCompleted &&
        (Boolean(task.planRecord) && isFillPlanReady(task.fillPlan) && hasFillChanges(task.fillPlan));
    }
    setBusy(false, task);
    setRuntimeMessage(turn.status === "failed" ? "本轮失败" : "连接就绪", turn.status === "failed" ? "error" : "ready", task);
    touchTask(task);
    persistTasks();
    renderTaskAfterEvent(task, { forceScroll: task.followOutput });
    loadThreads().catch(() => {});
    return;
  }

  if (method === "app/fillPreviewCompleted") {
    task.fillPreviewCompleted = params.status === "completed";
    syncFillPlanFromTurns(task);
    const genericWorkbook = task.file && task.file.workbook && task.file.workbook.kind !== "standard";
    task.fillReady = task.fillPreviewCompleted &&
      (Boolean(task.planRecord) && isFillPlanReady(task.fillPlan) && hasFillChanges(task.fillPlan));
    persistTasks();
    renderTaskAfterEvent(task);
    return;
  }

  if (method === "app/fillCompleted") {
    task.outputs = params.files || [];
    const completedTurn = findTurn(params.turnId, false, task);
    if (completedTurn) completedTurn.outputs = task.outputs;
    task.fillReady = false;
    task.fillPlan = null;
    task.planRecord = null;
    task.fillPreviewCompleted = false;
    task.pendingPhase = "";
    touchTask(task);
    persistTasks();
    if (task.id === state.activeTaskId) $("fillAction").classList.add("is-hidden");
    renderTaskAfterEvent(task);
    if (task.outputs.length) {
      if (task.id === state.activeTaskId) showToast("已生成 " + task.outputs.length + " 个填报文件。");
    } else if (task.id === state.activeTaskId) {
      showToast("本轮完成，但未检测到 output 下的新 .xlsx 文件。", "error");
    }
    return;
  }

  if (method === "error" || method === "app/processError") {
    const error = params.error || params;
    const message = error.message || "Agent 返回错误";
    const turn = findTurn(params.turnId || task.currentTurnId, false, task);
    if (turn) {
      turn.error = message;
      turn.status = "failed";
    } else {
      const errorTurn = newTurn("error-" + Date.now(), task);
      errorTurn.error = message;
      errorTurn.status = "failed";
      task.turns.push(errorTurn);
    }
    setBusy(false, task);
    setRuntimeMessage("Agent 错误", "error", task);
    persistTasks();
    renderTaskAfterEvent(task, { forceScroll: task.followOutput });
  }
}

function connectEvents() {
  const source = new EventSource("/api/events" + (window.WenshuAccount?.identity ? "?accountUser=" + encodeURIComponent(window.WenshuAccount.identity.user.id) : ""));
  source.onopen = async () => {
    try {
      const build = await api("/api/build");
      if (build.buildId !== CLIENT_BUILD_ID) {
        state.buildMismatch = true; source.close();
        setRuntimeMessage("应用已更新，请刷新页面", "error");
        showToast("服务版本已变化，请刷新页面后继续，已保存的任务仍保留。", "error");
      }
    } catch { /* Reconnection will retry after the server is available. */ }
  };
  source.onmessage = (event) => {
    try {
      handleEvent(JSON.parse(event.data));
    } catch {
      // Ignore malformed stream frames.
    }
  };
  source.onerror = () => {
    source.close();
    window.WenshuAccount?.verify();
    setTimeout(connectEvents, 1800);
  };
}

async function loadThreads() {
  try {
    const response = await api("/api/threads");
    state.threads = (response.data || []).map((thread) => ({
      ...thread,
      mode: threadMode(thread)
    }));
    reconcileTaskModes();
    renderThreads();
    renderTaskList();
    return state.threads;
  } catch (error) {
    setRuntimeMessage("对话列表不可用", "error");
    return [];
  }
}

async function createThread(mode, options) {
  const settings = options || {};
  const suppliedTask = settings.task || null;
  const task = suppliedTask || createTaskState(mode || (activeTask() && activeTask().mode) || "question", {
    model: settings.model || state.defaultModel,
    effort: settings.effort || state.defaultEffort
  });
  if (!suppliedTask) selectTask(task.id);
  if (!suppliedTask) {
    task.historyLoaded = true;
    persistTasks(); renderActiveTask();
    return task; // Freeze selected configuration only on the first submitted request.
  }
  if (task.threadId) {
    if (task.id === state.activeTaskId) renderActiveTask();
    return task;
  }
  task.busy = false;
  task.currentTurnId = "";
  task.pendingTurn = null;
  task.pendingPhase = "";
  task.followOutput = true;
  task.openTraces.clear();
  touchTask(task);
  if (task.id === state.activeTaskId) renderActiveTask();
  const response = await api("/api/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memoryTaskId: task.id, taskConfig: task.taskConfig, mode: task.mode, model: task.model, runId: task.mode === "ppt" ? pptRun(task) : task.file && task.file.runId ? task.file.runId : task.id, templateVersion: task.ppt?.template?.id || task.ppt?.templateVersion, quarterlyTemplateVersion: task.quarterly?.template?.id || task.quarterly?.templateVersion, quarterlyConfig: task.quarterly?.config })
  });
  task.snapshot = response.data.snapshot;
  if (response.data.ppt) task.ppt=response.data.ppt;
  if (response.data.quarterly) task.quarterly=response.data.quarterly;
  task.threadId = response.data.id;
  if (response.data.runId && task.file) task.file.runId = response.data.runId;
  task.model = response.data.model || task.model;
  task.historyLoaded = true;
  task.runtimeMessage = "连接就绪";
  touchTask(task);
  persistTasks();
  taskStorage.setItem("wenshu.v2.threadId", task.threadId);
  await loadThreads();
  if (task.id === state.activeTaskId) {
    renderActiveTask();
    setRuntimeMessage("连接就绪", "ready", task);
  }
  return task;
}

async function loadThread(threadId, options) {
  if (!threadId) return;
  const settings = options || {};
  const existingTask = taskForThread(threadId);
  if (existingTask && !settings.refresh) {
    switchTask(existingTask.id);
    return existingTask;
  }
  const task = existingTask || createTaskState(settings.mode || "question", {
    threadId: threadId,
    model: settings.model || state.defaultModel
  });
  const requestToken = (task.historyLoadToken || 0) + 1;
  task.historyLoadToken = requestToken;
  task.historyLoading = true;
  task.historyLoadError = "";
  task.runtimeMessage = "正在恢复历史";
  if (!existingTask && !settings.keepCurrentTask) selectTask(task.id);
  if (task.id === state.activeTaskId) renderActiveTask();
  const isCurrentLoad = () => task.historyLoadToken === requestToken;
  const hasHistoryHint = (thread) => Boolean(
    thread && [thread.preview, thread.title, thread.name].some((value) => String(value || "").trim())
  );
  try {
    let record = {};
    let thread = {};
    let loadedTurns = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await api("/api/threads/" + encodeURIComponent(threadId));
      record = response.data || {};
      thread = record.thread || record;
      loadedTurns = extractHistory(record, task);
      if (loadedTurns.length || !hasHistoryHint(thread) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    if (!isCurrentLoad()) return task;
    const loadedMode = threadMode(thread);
    task.threadId = thread.id || threadId;
    if (task.mode !== loadedMode) {
      task.mode = loadedMode;
      if (loadedMode !== "fill") {
        task.file = null;
        task.fillReady = false;
        task.fillPlan = null;
        task.fillPreviewCompleted = false;
      }
    }
    if (loadedMode === "fill") {
      const sourceFile = record.sourceFile || thread.sourceFile || null;
      if (sourceFile && !sourceFile.missing) {
        task.file = sourceFile;
        task.fileMissing = null;
      } else if (sourceFile && sourceFile.missing) {
        task.file = null;
        task.outputs = [];
        task.fillPlan = null;
        task.fillReady = false;
        task.fillPreviewCompleted = false;
        task.fileMissing = sourceFile;
      }
      const loadedOutputs = Array.isArray(record.outputs)
        ? record.outputs
        : Array.isArray(thread.outputs) ? thread.outputs : null;
      if (!sourceFile || !sourceFile.missing) {
        if (loadedOutputs && (loadedOutputs.length || !task.outputs.length)) task.outputs = loadedOutputs;
      }
    }
    if (thread.model) task.model = thread.model;
    if (loadedTurns.length || !task.turns.length) task.turns = loadedTurns;
    task.historyLoaded = loadedTurns.length > 0 || !hasHistoryHint(thread);
    task.historyLoading = false;
    task.historyLoadError = task.historyLoaded ? "" : "暂未读取到历史消息，请重新加载对话。";
    task.runtimeMessage = task.historyLoadError ? "历史恢复失败" : "连接就绪";
    task.currentTurnId = "";
    task.pendingTurn = null;
    task.pendingPhase = "";
    task.busy = task.turns.some((turn) => !isTurnDone(turn));
    task.followOutput = true;
    task.openTraces.clear();
    if (!settings.keepCurrentTask || state.activeTaskId === task.id) selectTask(task.id);
    await refreshTaskRecord(task);
    syncFillStateFromTurns(task);
    if (task.id === state.activeTaskId) taskStorage.setItem("wenshu.v2.threadId", task.threadId);
    persistTasks();
    if (task.id === state.activeTaskId) renderActiveTask();
    renderThreads();
    renderTaskList();
    closeOverlays();
    if (!task.historyLoaded && task.id === state.activeTaskId) {
      showToast(task.historyLoadError, "error");
    }
    return task;
  } catch (error) {
    if (!isCurrentLoad()) return task;
    task.historyLoading = false;
    task.historyLoaded = false;
    task.historyLoadError = error.message || "历史对话读取失败，请重新加载。";
    task.runtimeMessage = "历史恢复失败";
    touchTask(task);
    persistTasks();
    if (task.id === state.activeTaskId) renderActiveTask();
    renderThreads();
    renderTaskList();
    showToast(task.historyLoadError, "error");
  }
}

async function sendMessage(phase, options) {
  const settings = options || {};
  const task = settings.targetTask || activeTask();
  if (!task || task.busy) return;
  if (task.threadId && !task.historyLoaded) {
    showToast(task.historyLoading ? "正在恢复历史对话，请稍候。" : "请先重新加载历史对话。", "error");
    return;
  }
  const input = $("messageInput");
  const originalText = settings.text != null ? String(settings.text).trim() : input.value.trim();
  if (phase !== "commit" && originalText && await captureMemoryMessage(task, originalText)) return;
  if (task.mode === "fill" && !task.file) {
    showToast("请先上传一个 .xlsx 文件。", "error");
    return;
  }
  if (!originalText && phase !== "commit") {
    showToast(task.mode === "fill" ? "请先输入本次填报指令。" : "请输入问题或填报要求。", "error");
    return;
  }
  if (!task.threadId) {
    try {
      await createThread(task.mode, { task });
    } catch (error) {
      if (task.id === state.activeTaskId) showToast(error.message, "error");
      return;
    }
  }
  if (task.mode === "fill") {
    if (phase === "preview" && task.outputs.length) task.outputs = [];
    task.fillReady = false;
    task.fillPreviewCompleted = false;
    if (phase !== "commit") { task.planRecord = null; if (phase === "preview") task.fillPlan = null; }
    if (task.id === state.activeTaskId) $("fillAction").classList.add("is-hidden");
  }
  if(task.mode === "quarterly" && phase !== "commit") quarterlyData(task).record = null;
  if(task.mode === "ppt" && phase !== "commit") pptTaskData(task).record = null;
  const displayText = phase === "commit"
    ? task.mode === "quarterly" ? (options?.draft ? "确认生成季报待补充草稿" : "确认生成季报 Word 和 PDF") : task.mode === "ppt" ? "确认按当前大纲生成 PPT" : "确认写回当前文件"
    : phase === "clarification"
      ? "补充确认：" + originalText
      : originalText;
  const turn = newTurn("pending-" + Date.now(), task);
  turn.user = displayText;
  turn.userAt = Date.now();
  turn.status = "starting";
  turn.model = task.model;
  task.turns.push(turn);
  task.pendingTurn = turn;
  task.currentTurnId = turn.id;
  task.pendingPhase = phase;
  task.followOutput = true;
  touchTask(task);
  if (task.id === state.activeTaskId) {
    renderMessages({ forceScroll: true }, task);
    input.value = "";
    resizeComposer();
  }
  setBusy(true, task);
  setRuntimeMessage("发送中", undefined, task);
  persistTasks();
  try {
    const response = await api("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: task.threadId,
        mode: task.mode,
        memoryRequestId: task.memoryRequestId,
        phase: task.mode !== "question" ? phase : "preview",
        filePath: task.mode === "fill" && task.file ? task.file.relativePath : "",
        fileSha256: task.mode === "fill" && task.file ? task.file.sha256 : "",
        workbook: task.mode === "fill" && task.file ? task.file.workbook : null,
        planId: phase === "commit" ? (task.mode === "quarterly" ? task.quarterly?.record?.id : task.mode === "ppt" ? task.ppt?.record?.id : task.planRecord?.id) : undefined,
        planVersion: phase === "commit" ? (task.mode === "quarterly" ? task.quarterly?.record?.version : task.mode === "ppt" ? task.ppt?.record?.version : task.planRecord?.version) : undefined,
        confirmed: phase === "commit",
        draft: options?.draft === true,
        revisionSection: task.mode === "quarterly" && phase !== "commit" ? quarterlyUI.revisionSection : undefined,
        preflightId: phase === "commit" && task.mode === "ppt" ? currentPptCheck(task)?.id : undefined,
        text: originalText,
        model: task.model,
        effort: task.id === state.activeTaskId ? $("effortSelect").value : task.effort
      })
    });
    task.effort = task.id === state.activeTaskId ? $("effortSelect").value : task.effort;
    if (task.mode === "quarterly") quarterlyUI.revisionSection = null;
    const turnId = response.data.turnId || "";
    if (turnId) {
      const liveTurn = findTurn(turnId, true, task);
      if (!liveTurn.user) liveTurn.user = turn.user;
      liveTurn.model = response.data.model || task.model;
      liveTurn.status = "in_progress";
      task.currentTurnId = liveTurn.id;
    }
    if (response.data.directMemory) {
      turn.status = "completed"; turn.completedAt = Date.now(); turn.memoryReceipt = response.data;
      turn.assistant.push({ id: "memory-" + Date.now(), text: response.data.message });
      task.pendingTurn = null; task.pendingPhase = ""; setBusy(false, task);
      await refreshTaskMemory(task); renderTaskAfterEvent(task, { forceScroll: true }); return;
    }
    if (response.data.directFill || response.data.directPpt || response.data.directQuarterly) {
      turn.status = "completed";
      turn.completedAt = Date.now();
      turn.outputs = response.data.files || [];
      turn.assistant.push({
        id: "direct-fill-" + Date.now(),
        text: response.data.message || "已根据确认内容生成新的 Excel 文件。"
      });
      task.pendingTurn = null;
      task.pendingPhase = "";
      task.fillReady = false;
      task.fillPreviewCompleted = false;
      if (task.id === state.activeTaskId) $("fillAction").classList.add("is-hidden");
      task.outputs = response.data.files || [];
      if(response.data.ppt)task.ppt=response.data.ppt;
      if(response.data.quarterly)task.quarterly=response.data.quarterly;
      setBusy(false, task);
      setRuntimeMessage("连接就绪", "ready", task);
      touchTask(task);
      persistTasks();
      renderTaskAfterEvent(task, { forceScroll: true });
      if (task.outputs.length && task.id === state.activeTaskId) {
        if(response.data.directQuarterly)openQuarterlyPreview(task.quarterly.record);
        else if(response.data.directPpt)openPptPreview(task.outputs[0]);
        else showToast("已生成新的填报文件。");
      }
      return;
    }
    if (task.mode === "fill" && phase === "commit") {
      task.fillReady = false;
      if (task.id === state.activeTaskId) $("fillAction").classList.add("is-hidden");
    }
    touchTask(task);
    persistTasks();
  } catch (error) {
    const failedTurn = task.pendingTurn || findTurn(task.currentTurnId, false, task);
    if (failedTurn) {
      failedTurn.error = error.message;
      failedTurn.status = "failed";
    } else {
      const errorTurn = newTurn("error-" + Date.now(), task);
      errorTurn.error = error.message;
      errorTurn.status = "failed";
      task.turns.push(errorTurn);
    }
    task.pendingTurn = null;
    task.pendingPhase = "";
    setBusy(false, task);
    setRuntimeMessage("Agent 错误", "error", task);
    touchTask(task);
    persistTasks();
    renderTaskAfterEvent(task, { forceScroll: true });
    if (task.id === state.activeTaskId) showToast(error.message, "error");
  }
}

function openDialog(id) {
  const dialog = $(id);
  if (dialog && !dialog.open) dialog.showModal();
}

async function refreshConnectionStatus() {
  const button = $("setupButton");
  button.disabled = true;
  try {
    renderStatus(await api("/api/status"));
  } catch (error) {
    showToast("连接状态读取失败：" + error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function loadSkill() { await loadWorkbench(); editProfile(workbench.editing?.id || ""); }
async function saveSkillDraft() { try { await saveProfile(); } catch(e) { showToast(e.message, "error"); } }
async function activateSkill() { await publishProfile(); }
async function resetSkill() { editProfile(""); }

async function saveSettings() {
  const apiKey = $("apiKeyInput").value.trim();
  const body = {
    selectedModel: state.model,
    mysql: {
      host: $("mysqlHostInput").value.trim(),
      port: $("mysqlPortInput").value.trim() || "53307",
      user: $("mysqlUserInput").value.trim(),
      pass: $("mysqlPassInput").value
    }
  };
  if (apiKey) body.dashscopeApiKey = apiKey;
  try {
    $("saveSettingsButton").disabled = true;
    const response = await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    renderStatus(response.status);
    $("settingsDialog").close();
    state.threadId = "";
    state.turns = [];
    state.pendingTurn = null;
    renderMessages({ forceScroll: true });
    showToast("设置已保存，连接已重启。");
    if (response.status.hasApiKey && response.status.codexReady) await createThread();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    $("saveSettingsButton").disabled = false;
  }
}

function resizeComposer() {
  const input = $("messageInput");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}

function bindEvents() {
  document.querySelectorAll(".mode-button[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mode === state.mode) {
        setSidebarOpen(false);
        return;
      }
      const existing = Array.from(state.tasks.values())
        .filter((task) => task.mode === normalizeMode(button.dataset.mode))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (existing) switchTask(existing.id);
      else setMode(button.dataset.mode, true);
      setSidebarOpen(false);
    });
  });
  $("newThreadButton").addEventListener("click", () => createThread().catch((error) => showToast(error.message, "error")));
  $("threadSearch").addEventListener("input", (event) => {
    state.threadQuery = event.target.value;
    renderThreads();
  });
  $("modelSelect").addEventListener("change", (event) => {
    state.model = event.target.value;
    persistTasks();
    renderTaskList();
  });
  $("effortSelect").addEventListener("change", (event) => {
    state.effort = event.target.value;
    persistTasks();
  });
  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(state.mode === "fill" && hasFillQuestions(state.fillPlan) ? "clarification" : "preview");
  });
  $("messageInput").addEventListener("input", resizeComposer);
  $("messageInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(state.mode === "fill" && hasFillQuestions(state.fillPlan) ? "clarification" : "preview");
    }
  });
  $("conversation").addEventListener("scroll", () => {
    state.followOutput = isNearBottom($("conversation"));
    updateJumpButton();
  });
  $("jumpToLatest").addEventListener("click", () => scrollToLatest(true));
  $("retryHistoryButton").addEventListener("click", () => {
    const task = activeTask();
    if (task && task.threadId) loadThread(task.threadId, { refresh: true }).catch(() => {});
  });
  $("attachButton").addEventListener("click", () => $(state.mode === "quarterly" ? "quarterlyMaterialInput" : state.mode === "ppt" ? "pptMaterialInput" : "fileInput").click());
  $("fileChooseButton").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (event) => {
    if (event.target.files && event.target.files[0]) uploadFile(event.target.files[0]);
    event.target.value = "";
  });
  $("removeFileButton").addEventListener("click", () => {
    state.file = null;
    state.fileMissing = null;
    state.fillReady = false;
    state.fillPlan = null;
    state.fillPreviewCompleted = false;
    $("fillAction").classList.add("is-hidden");
    persistTasks();
    renderFile();
    renderTaskList();
  });
  $("confirmWriteButton").addEventListener("click", () => sendMessage("commit"));
  $("fileDropzone").addEventListener("dragover", (event) => {
    event.preventDefault();
    $("fileDropzone").classList.add("is-dragging");
  });
  $("fileDropzone").addEventListener("dragleave", () => $("fileDropzone").classList.remove("is-dragging"));
  $("fileDropzone").addEventListener("drop", (event) => {
    event.preventDefault();
    $("fileDropzone").classList.remove("is-dragging");
    if (event.dataTransfer.files && event.dataTransfer.files[0]) uploadFile(event.dataTransfer.files[0]);
  });
  $("fileDropzone").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("fileInput").click();
    }
  });
  document.addEventListener("dragover", (event) => {
    if (state.mode === "fill") event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (state.mode !== "fill" || !event.dataTransfer.files || !event.dataTransfer.files.length) return;
    event.preventDefault();
    if (event.target !== $("fileDropzone")) uploadFile(event.dataTransfer.files[0]);
  });
  document.addEventListener("paste", (event) => {
    if (state.mode !== "fill" || !event.clipboardData || !event.clipboardData.files.length) return;
    const file = [...event.clipboardData.files].find((entry) => entry.name.toLowerCase().endsWith(".xlsx"));
    if (file) {
      event.preventDefault();
      uploadFile(file);
    }
  });
  $("mobileMenuButton").addEventListener("click", () => setSidebarOpen(true));
  $("closeSidebarButton").addEventListener("click", () => setSidebarOpen(false));
  $("sidebarScrim").addEventListener("click", closeOverlays);
  $("inspectorToggleButton").addEventListener("click", () => {
    const shell = $("appShell");
    const isMobile = window.matchMedia("(max-width: 1060px)").matches;
    const open = isMobile ? !shell.classList.contains("is-inspector-open") : shell.classList.contains("is-inspector-hidden");
    setInspectorOpen(open);
  });
  $("closeInspectorButton").addEventListener("click", () => setInspectorOpen(false));
  $("skillButton").addEventListener("click", () => loadSkill().then(() => openDialog("skillDialog")));
  $("headerSkillButton").addEventListener("click", () => loadSkill().then(() => openDialog("skillDialog")));
  $("headerSettingsButton").addEventListener("click", () => openDialog("settingsDialog"));
  $("settingsButton").addEventListener("click", () => openDialog("settingsDialog"));
  $("setupButton").addEventListener("click", refreshConnectionStatus);
  $("editConnectionButton").addEventListener("click", () => {
    $("credentialFields").classList.remove("is-hidden");
    $("connectionSummary").classList.add("is-hidden");
    $("editConnectionButton").classList.add("is-hidden");
    $("saveSettingsButton").classList.remove("is-hidden");
  });
  $("saveSettingsButton").addEventListener("click", saveSettings);
  $("saveSkillDraftButton").addEventListener("click", saveSkillDraft);
  $("activateSkillButton").addEventListener("click", activateSkill);
  $("resetSkillButton").addEventListener("click", resetSkill);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => $(button.dataset.closeDialog).close());
  });
  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 1061px)").matches) $("appShell").classList.remove("is-inspector-open");
    resizeComposer();
  });
}

async function init() {
  if (window.WenshuAccount && !await window.WenshuAccount.ready) return;
  bindEvents();
  bindWorkbench();
  bindMemoryWorkbench();
  bindPpt();
  bindQuarterly();
  restoreTasks();
  if (window.WenshuAccount?.identity) {
    const permissions = window.WenshuAccount.identity.user.permissions;
    for (const [id, task] of state.tasks) if (!permissions.includes(task.mode)) state.tasks.delete(id);
    if (!state.tasks.size) { const mode = ["question", "fill", "ppt", "quarterly"].find(p => permissions.includes(p)); const task = createTaskState(mode); state.tasks.set(task.id, task); state.activeTaskId = task.id; }
    if (!state.tasks.has(state.activeTaskId)) state.activeTaskId = state.tasks.keys().next().value;
  }
  setMode(ensureActiveTask().mode, false);
  renderFile();
  renderOutputs();
  renderMessages();
  setInspectorOpen(!window.matchMedia("(max-width: 1060px)").matches);
  connectEvents();
  try {
    const status = await api("/api/status");
    if (status.buildId !== CLIENT_BUILD_ID) {
      state.buildMismatch = true;
      setRuntimeMessage("需要重启应用", "error");
      showToast("应用文件已更新，请关闭应用后重新启动 2.0 服务。", "error");
      return;
    }
    state.status = status;
    state.defaultModel = status.selectedModel || state.defaultModel;
    renderStatus(status);
    renderActiveTask();
    if (!window.WenshuAccount?.identity || window.WenshuAccount.identity.user.permissions.includes("personalRules")) await loadWorkbench();
    const threads = status.hasApiKey && status.codexReady ? await loadThreads() : [];
    const restored = activeTask();
    const saved = taskStorage.getItem("wenshu.v2.threadId");
    const savedThread = threads.find((thread) =>
      thread.id === saved && (!restored || threadMode(thread) === restored.mode)
    );
    const threadId = restored && restored.threadId ? restored.threadId : savedThread && savedThread.id;
    const existing = threads.find((thread) => thread.id === threadId);
    if (threadId) {
      await loadThread(threadId, {
        refresh: true,
        mode: existing ? threadMode(existing) : restored && restored.mode,
        model: existing && existing.model
      });
    }
    else renderActiveTask();
  } catch (error) {
    setRuntimeMessage("应用服务不可用", "error");
    showToast(error.message, "error");
  }
}

init();
