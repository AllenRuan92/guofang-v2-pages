"use strict";

// This entry point is included only by the Pages exporter, never by local V2.
const PAGES_NOTICE = "网上界面测试 · 阿里云后端尚未连接";
const PAGES_MESSAGE = "目前可以查看界面、切换模式和新建任务；问数、上传、保存规则和文件生成待后端接通后测试。";
const PAGES_BLOCKED_IDS = new Set([
  "sendButton", "attachButton", "fileChooseButton", "removeFileButton", "confirmWriteButton",
  "saveSettingsButton", "editConnectionButton", "saveSkillDraftButton", "activateSkillButton",
  "resetSkillButton", "checkProfileButton", "pptUploadButton", "pptTemplateUploadSubmit",
  "pptEnableTemplate", "pptGenerateButton", "pptReviewGenerate", "pptSavePage", "quarterlyUploadButton",
  "quarterlyEnable", "quarterlyGenerate", "quarterlyDraft", "quarterlySaveEdit", "memoryAdd",
  "memorySave", "memoryOrganizerEnabled", "memoryOrganizerRun", "taskMemoryFundSave"
]);

function applyPagesState() {
  const task = activeTask();
  if (task) task.runtimeMessage = PAGES_NOTICE;
  $("runtimeStatus").querySelector("span:last-child").textContent = PAGES_NOTICE;
  $("runtimeStatus").querySelector(".status-dot").className = "status-dot quiet";
  $("setupBanner").classList.remove("is-hidden");
  $("setupTitle").textContent = PAGES_NOTICE;
  $("setupMessage").textContent = PAGES_MESSAGE;
  $("setupButton").textContent = "查看测试说明";
  $("messageInput").disabled = true;
  $("messageInput").placeholder = "阿里云后端尚未连接，当前暂不能提交问题或材料。";
  document.querySelectorAll('input[type="file"]').forEach(el => { el.disabled = true; });
  for (const id of PAGES_BLOCKED_IDS) {
    const el = $(id);
    if (el) { el.disabled = true; el.title = "此功能需要连接阿里云后端"; }
  }
  $("runtimeProvider").textContent = "待连接";
  $("contextProvider").textContent = "网上界面测试";
  $("runtimeDatabase").textContent = "未连接";
  $("runtimeAgent").textContent = "未连接";
  $("taskMemorySummary").textContent = "后端尚未连接，暂不能读取偏好";
  $("taskSettingsSaveHint").textContent = "当前仅保存在此浏览器用于界面测试";
  if (task?.mode === "ppt") {
    $("pptTemplateSelect").innerHTML = '<option value="">后端接通后读取公司模板</option>';
    $("pptTemplateHint").textContent = "当前仅查看制作界面，尚未读取公司模板和资料。";
  }
  if (task?.mode === "quarterly") {
    $("quarterlyTemplate").innerHTML = '<option value="">后端接通后读取季报模板</option>';
    $("quarterlyNotice").textContent = "当前仅查看季报界面，尚未读取公司模板和资料。";
  }
}

function pagesInfo() { openDialog("pagesInfoDialog"); }

async function initPagesTest() {
  // Do not open EventSource, fetch API routes or restore a local application's tasks.
  state.status = null;
  scheduleTaskMemory = () => {
    const task = activeTask();
    if (task) renderTaskMemory(task);
  };
  refreshTaskMemory = async task => { renderTaskMemory(task); applyPagesState(); };
  api = async () => { throw new Error(PAGES_MESSAGE); };
  const renderLocalTask = renderActiveTask;
  renderActiveTask = function () { renderLocalTask(); applyPagesState(); };

  bindEvents(); bindWorkbench(); bindMemoryWorkbench(); bindPpt(); bindQuarterly();
  restoreTasks();
  populateModels([{ id: state.defaultModel, name: state.defaultModel, note: "尚未连接" }]);
  setMode(ensureActiveTask().mode, false);
  setInspectorOpen(!window.matchMedia("(max-width: 1060px)").matches);
  $("connectionSummary").classList.remove("is-hidden");
  $("connectionSummary").textContent = "此页面尚未连接阿里云后端。密钥与数据库账号应由维护人员在后端配置，网页不接收这些信息。";
  $("credentialFields").classList.add("is-hidden");
  $("setupButton").onclick = pagesInfo;
  $("pagesInfoButton").onclick = pagesInfo;
  $("pagesBuild").textContent = "V2 " + window.WENSHU_PAGES.appVersion + " · " + window.WENSHU_PAGES.buildId;
  document.querySelector(".isolation-note span:last-child").textContent = "网上界面测试";
  document.querySelector(".runtime-list div:nth-child(2) dd").textContent = "浏览器测试";
  document.querySelector(".context-footer").textContent = "GitHub Pages · 后端待接入";
  $("memoryOrganizerStatus").textContent = "后端尚未连接，暂不能读取或保存偏好";
  $("memoryEntries").textContent = "网上版尚未读取任何个人记忆。";
  $("skillBasePreview").value = "业务规则未发布到此静态网站，接通后端后按权限读取。";
  editProfile("");
  const openRules = () => { editProfile(""); openDialog("skillDialog"); applyPagesState(); };
  for (const id of ["skillButton", "headerSkillButton"]) $(id).onclick = openRules;
  loadSkill = async () => { editProfile(""); };
  loadMemories = async () => {};
  openMemories = async () => { openDialog("memoryDialog"); applyPagesState(); };
  for (const id of ["memoryButton", "headerMemoryButton", "taskMemoryManage"]) $(id).onclick = openMemories;
  pollOrganizer = () => {};
  openTemplateManager = async () => { openDialog("pptTemplateDialog"); $("pptTemplateVersionInfo").textContent = PAGES_MESSAGE; applyPagesState(); };
  $("templateManagerButton").onclick = openTemplateManager;
  $("pptTemplatesLink").onclick = openTemplateManager;
  openQuarterlyTemplates = async () => { openDialog("quarterlyTemplateDialog"); $("quarterlyTemplateNotice").textContent = PAGES_MESSAGE; applyPagesState(); };

  document.addEventListener("click", event => {
    const el = event.target.closest("button,input");
    if (el && PAGES_BLOCKED_IDS.has(el.id)) { event.preventDefault(); event.stopImmediatePropagation(); pagesInfo(); }
    if (el?.id === "setupButton") { event.preventDefault(); event.stopImmediatePropagation(); pagesInfo(); }
  }, true);
  document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); pagesInfo(); }, true);
  for (const eventName of ["drop", "paste"]) document.addEventListener(eventName, event => {
    if ((event.dataTransfer || event.clipboardData)?.files?.length) { event.preventDefault(); event.stopImmediatePropagation(); pagesInfo(); }
  }, true);
  document.querySelectorAll('input[type="password"]').forEach(el => { el.disabled = true; el.value = ""; });
  applyPagesState();
}

initPagesTest().catch(error => {
  document.getElementById("setupBanner").classList.remove("is-hidden");
  document.getElementById("setupTitle").textContent = "页面初始化失败，请刷新后重试";
  console.error(error);
});
