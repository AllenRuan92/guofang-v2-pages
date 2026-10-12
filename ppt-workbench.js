"use strict";

const pptUI = { library: null, loading: null, selectedVersion: "", page: 0, previewPage: 0, preview: null, uploading: false, checking: "" };
const pptLayouts = { cover:"封面", agenda:"目录", section:"章节", content:"正文", columns:"双栏", table:"表格", chart:"图表", image:"图文", closing:"结尾页" };
const pptPageCount = (plan, template) => plan.slides.length + (template?.mapping?.roles?.closing ? 1 : 0);
const pptPost = async (action, body) => (await api("/api/ppt/"+action,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).data;
function pptTaskData(task) { return task.ppt || (task.ppt={materials:[],record:null,history:[],revision:0}); }
function pptRun(task) { return pptTaskData(task).runId || task.id; }
function pptVersions() { return (pptUI.library?.templates || []).flatMap(t=>t.versions); }
function readPptFile(file) {
  if(file.size>50*1024*1024) return Promise.reject(new Error("单个文件不能超过 50MB"));
  return new Promise((resolve,reject)=>{const reader=new FileReader(); reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("文件读取失败"));reader.readAsDataURL(file);});
}
async function loadPptLibrary(force=false) {
  if(pptUI.loading) return pptUI.loading;
  if(pptUI.library && !force) return pptUI.library;
  pptUI.loading=(async()=>{pptUI.library=(await api("/api/ppt/library")).data;renderPpt();return pptUI.library;})().finally(()=>{pptUI.loading=null;});
  return pptUI.loading;
}
function renderPpt() {
  const task=activeTask(), isPpt=task?.mode==="ppt";
  $("pptContext").classList.toggle("is-hidden",!isPpt);
  $("pptOutlineBar").classList.add("is-hidden");
  if(!isPpt) return;
  const data=pptTaskData(task), record=data.record;
  $("attachButton").classList.remove("is-hidden");
  $("attachButton").title="上传 PPT 制作资料"; $("attachButton").setAttribute("aria-label","上传 PPT 制作资料");
  $("composerModeHint").textContent="PPT 制作 · 核对大纲后生成";
  $("messageInput").placeholder=record?"继续完善要求，或指定页码修改，例如：第 4 页改为表格":"说明受众、页数和汇报重点，例如：根据资料制作 12 页投委会汇报";
  $("modeKicker").textContent="PRESENTATION MODE";
  if(!task.threadId){ $("emptyHeading").textContent="把资料整理成汇报"; $("emptyCopy").textContent="上传资料、输入要求，核对逐页大纲后套用公司模板。"; $("emptyCode").textContent="GF / PRESENTATION"; }
  const select=$("pptTemplateSelect"), versions=pptVersions().filter(v=>v.state==="enabled");
  const key=data.template?.id || data.templateVersion || pptUI.library?.defaultVersion || "";
  if(!data.template && !data.templateVersion && key) data.templateVersion=key;
  select.innerHTML=versions.length?versions.map(v=>'<option value="'+escapeHtml(v.id)+'">'+escapeHtml(v.name)+' · v'+v.version+(v.id===pptUI.library.defaultVersion?'（默认）':'')+'</option>').join(""):'<option>正在读取模板库…</option>';
  select.value=key; select.disabled=task.busy || !versions.length;
  $("pptTemplateHint").textContent=task.threadId?"当前任务已固定此版本。切换后须重新生成并确认大纲。":"新任务默认使用已启用的公司模板。";
  $("pptMaterialCount").textContent=data.materials?.length || 0;
  $("pptMaterialList").innerHTML=(data.materials||[]).map(m=>'<div class="ppt-material"><button type="button" class="small-action" data-ppt-remove="'+escapeHtml(m.id)+'" '+(task.busy?'disabled':'')+'>移除</button><strong>'+escapeHtml(m.name)+'</strong><small>'+formatFileSize(m.size)+' · '+m.blockCount+' 个内容片段</small>'+(m.warnings?.length?'<details><summary>'+m.warnings.length+' 条解析提示</summary>'+m.warnings.map(w=>'<p>'+escapeHtml(w)+'</p>').join("")+'</details>':'')+'</div>').join("") || '<p class="muted-line">尚未添加资料。也可以直接提供完整内容指令。</p>';
  $("pptMaterialList").querySelectorAll("[data-ppt-remove]").forEach(b=>b.onclick=()=>changePpt({removeId:b.dataset.pptRemove},task));
  $("pptUploadButton").disabled=task.busy;
  if(record){
    $("pptOutlineBar").classList.remove("is-hidden");
    $("pptOutlineTitle").textContent=record.plan.title;
    const close = record.plan.slides.length < pptPageCount(record.plan, data.template) ? " + 公司结尾页" : "";
    $("pptOutlineMeta").textContent="大纲 v"+record.version+" · "+record.plan.slides.length+" 页内容"+close+" · "+(record.plan.status==="clarification"?"请先补充信息":record.state==="generated"?"已生成，可继续修改":"请核对内容与来源");
    $("pptGenerateButton").disabled=task.busy || record.plan.status!=="ready";
    $("pptGenerateButton").textContent=record.state==="generated"?"核验生成文件":record.state==="failed"||record.state==="generating"?"继续生成":"检查并生成";
    if(record.error) $("pptOutlineMeta").textContent+=" · "+record.error.message+"（可继续生成）";
    $("pptReviewButton").disabled=task.busy;
  }
  const outputs=(data.history||[]).filter(h=>h.output).slice().reverse();
  $("pptHistoryList").innerHTML=outputs.length?'<strong>生成版本</strong>'+outputs.map((h,i)=>'<button class="outline-button" type="button" data-ppt-history="'+i+'">v'+h.version+' · '+escapeHtml(h.title)+'<small>'+escapeHtml(h.output.template)+' · 预览 / 下载</small></button>').join(""):"";
  $("pptHistoryList").querySelectorAll("[data-ppt-history]").forEach(b=>b.onclick=()=>openPptPreview(outputs[Number(b.dataset.pptHistory)].output));
  if(!pptUI.library && !pptUI.loading && state.status && !state.buildMismatch) loadPptLibrary().catch(e=>{ $("pptTemplateHint").textContent="模板库读取失败："+e.message; });
}
async function uploadPptMaterials(files,target) {
  const task=target || activeTask(); if(task?.mode!=="ppt" || task.busy) return;
  setBusy(true,task);renderPpt();
  try {
    for(const file of files){
      setRuntimeMessage("正在解析："+file.name,undefined,task);
      const data=pptTaskData(task), m=await pptPost("materials/upload",{runId:pptRun(task),threadId:task.threadId,name:file.name,dataBase64:await readPptFile(file)});
      data.materials.push(m); data.revision++; data.record=null; persistTasks();
    }
    if(task.threadId) await refreshTaskRecord(task);
    showToast("资料已解析，请输入制作要求。");
  } catch(e){showToast(e.message,"error");}
  finally {setBusy(false,task);setRuntimeMessage("连接就绪","ready",task);if(task.id===state.activeTaskId)renderPpt();persistTasks();}
}
async function changePpt(change,target) {
  const task=target||activeTask();if(!task || task.busy)return;
  const data=pptTaskData(task);
  if(!task.threadId && change.versionId){data.templateVersion=change.versionId;persistTasks();renderPpt();return;}
  try{task.ppt={...data,...await pptPost("change",{...change,runId:pptRun(task),threadId:task.threadId,revision:data.revision})};persistTasks();renderPpt();showToast("已更新，请重新提交制作要求以生成大纲。");}
  catch(e){showToast(e.message,"error");renderPpt();}
}
function pptRecord(task=activeTask()) {return task?.ppt?.record;}
function currentPptCheck(task=activeTask()) {
  const record=pptRecord(task), check=task?.ppt?.preflight || record?.preflight;
  return check && check.planId===record?.id && check.planVersion===record?.version ? check : null;
}
async function checkPptLayout(task, record) {
  pptUI.checking=record.id;
  task.ppt.preflight=null; task.ppt.preflightError="";
  renderPptReview(); $("pptReviewGenerate").disabled=true;
  try {
    const result=await pptPost("preflight",{runId:pptRun(task),threadId:task.threadId,planId:record.id,planVersion:record.version});
    if(pptRecord(task)?.id!==record.id) return;
    task.ppt.preflight=result;
  } catch(e) { if(pptRecord(task)?.id===record.id) task.ppt.preflightError=e.message; }
  if(pptUI.checking===record.id) pptUI.checking="";
  persistTasks(); if(activeTask()?.id===task.id) renderPptReview();
}
async function openPptReview(){
  const task=activeTask(),record=pptRecord(task);if(!record)return;
  pptUI.page=0;renderPptReview();openDialog("pptReviewDialog");
  $("pptPreflightNotice").textContent="正在按当前模板检查页面容量…";
  await checkPptLayout(task,record);
}
function renderPptReview(){
  const task=activeTask(), record=pptRecord(task);if(!record)return;
  const plan=record.plan; pptUI.page=Math.min(pptUI.page,Math.max(0,plan.slides.length-1));
  $("pptReviewHeading").textContent=plan.title;
  const close = plan.slides.length < pptPageCount(plan, task.ppt.template) ? " + 公司结尾页" : "";
  $("pptReviewVersion").textContent="大纲 v"+record.version+" · "+plan.slides.length+" 页内容"+close+" · "+(task.ppt.template?.name||"公司模板")+" · "+plan.summary;
  $("pptPageList").innerHTML=plan.slides.map((p,i)=>'<button type="button" data-page="'+i+'" class="'+(pptUI.page===i?'is-selected':'')+'">'+(i+1)+'　'+escapeHtml(p.title)+'<small>'+pptLayouts[p.layout]+'</small></button>').join("");
  $("pptPageList").querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{pptUI.page=Number(b.dataset.page);renderPptReview();});
  const page=plan.slides[pptUI.page], issues=plan.questions.length?'<div class="ppt-warning"><strong>待补充信息</strong><ul>'+plan.questions.map(q=>'<li>'+escapeHtml(q)+'</li>').join("")+'</ul><p>关闭此窗口，在对话中回复后重新核对大纲。</p></div>':'';
  let content=issues;
  if(page){
    content+='<h3>第 '+(pptUI.page+1)+' 页 <span class="ppt-page-count">· '+pptLayouts[page.layout]+'</span></h3><label class="field"><span>页面标题</span><input id="pptEditTitle" maxlength="70" value="'+escapeHtml(page.title)+'" /></label>';
    if(["cover","section"].includes(page.layout))content+='<label class="field"><span>副标题</span><input id="pptEditSubtitle" maxlength="100" value="'+escapeHtml(page.subtitle)+'" /></label>';
    if(["content","agenda","image"].includes(page.layout))content+='<label class="field"><span>主要内容（每行一条）</span><textarea id="pptEditBullets">'+escapeHtml(page.bullets.join("\n"))+'</textarea></label>';
    if(page.table) content+='<table><thead><tr>'+page.table.columns.map(c=>'<th>'+escapeHtml(c)+'</th>').join("")+'</tr></thead><tbody>'+page.table.rows.map(row=>'<tr>'+row.map(c=>'<td>'+escapeHtml(String(c))+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
    if(page.chart) content+='<p>'+ (page.chart.type==="line"?"折线图":"柱状图")+' · 单位：'+escapeHtml(page.chart.unit)+'</p><table><thead><tr><th>类别</th>'+page.chart.series.map(s=>'<th>'+escapeHtml(s.name)+'</th>').join("")+'</tr></thead><tbody>'+page.chart.categories.map((c,i)=>'<tr><td>'+escapeHtml(c)+'</td>'+page.chart.series.map(s=>'<td>'+s.values[i]+'</td>').join("")+'</tr>').join("")+'</tbody></table>';
    if(page.columns)content+=page.columns.map(c=>'<h4>'+escapeHtml(c.heading)+'</h4><ul>'+c.bullets.map(b=>'<li>'+escapeHtml(b)+'</li>').join("")+'</ul>').join("");
    content+='<p class="muted-line">数据日期：'+escapeHtml(page.dataDate||"未指定")+' · 单位：'+escapeHtml(page.unit||page.chart?.unit||"依内容")+'</p><div class="ppt-page-sources"><strong>资料来源</strong><ul>'+page.sources.map(s=>'<li>'+escapeHtml(s.label)+'</li>').join("")+'</ul></div>';
    if(page.notes)content+='<details><summary>演讲备注与依据</summary><p>'+escapeHtml(page.notes)+'</p></details>';
    content+='<div class="ppt-page-actions"><button id="pptSavePage" class="outline-button" type="button">保存本页文字</button><button id="pptRevisePage" class="outline-button" type="button">用指令修改本页</button></div>';
  }
  $("pptPageDetail").innerHTML=content;
  const preflight=currentPptCheck(task);
  $("pptReviewGenerate").disabled=task.busy||pptUI.checking===record.id||plan.status!=="ready"||preflight?.status!=="ready"||Boolean(task.ppt.preflightError);
  const mapping=preflight?.pageMap?.find(p=>p.outlinePage===pptUI.page+1);
  $("pptPreflightNotice").textContent=task.ppt.preflightError ? "排版检查失败："+task.ppt.preflightError : preflight ? preflight.status!=="ready" ? preflight.issues.map(i=>"大纲第 "+i.outlinePage+" 页："+i.message).join("；") : "已按模板尺寸检查，生成共 "+preflight.totalPages+" 页，含 "+preflight.autoSplitPages+" 页续页。"+(mapping?"当前大纲对应生成第 "+mapping.outputPages.join("、")+" 页。":"") : "正在按模板尺寸检查页面容量…";
  $("pptReviewNotice").textContent="保存文字后会形成新大纲版本；确认生成时使用当前版本。";
  $("pptPageDetail").querySelectorAll("input,textarea,button").forEach(el=>el.disabled=task.busy||pptUI.checking===record.id);
  $("pptPageDetail").querySelectorAll("input,textarea").forEach(el=>el.oninput=()=>{$("pptReviewGenerate").disabled=true;$("pptReviewNotice").textContent="文字尚未保存，请先保存本页并重新检查。";});
  if(page){$("pptSavePage").onclick=savePptPage;$("pptRevisePage").onclick=()=>{$("pptReviewDialog").close();$("messageInput").value="请修改大纲第 "+(pptUI.page+1)+" 页：";$("messageInput").focus();resizeComposer();};}
}
async function savePptPage(){
  const task=activeTask(), record=pptRecord(task);if(!record||task.busy)return;
  $("pptSavePage").disabled=true;
  try{const r=await pptPost("edit",{runId:pptRun(task),threadId:task.threadId,planId:record.id,planVersion:record.version,page:pptUI.page+1,title:$("pptEditTitle").value,subtitle:$("pptEditSubtitle")?.value,bullets:$("pptEditBullets")?.value.split("\n").map(s=>s.trim()).filter(Boolean)});task.ppt.record=r;await refreshTaskRecord(task);await checkPptLayout(task,pptRecord(task));renderPptReview();showToast("本页文字已保存，请核对后确认生成。");}
  catch(e){showToast(e.message,"error");$("pptSavePage").disabled=false;}
}
function confirmPpt(){
  if(!$("pptReviewDialog").open || currentPptCheck()?.status!=="ready" || activeTask().ppt.preflightError){openPptReview();return;}
  $("pptReviewDialog").close();sendMessage("commit");
}
function openPptPreview(file){pptUI.preview=file;pptUI.previewPage=0;renderPptPreview();openDialog("pptPreviewDialog");}
function renderPptPreview(){
  const file=pptUI.preview;if(!file)return;
  $("pptPreviewHeading").textContent=file.name;$("pptPreviewMeta").textContent=file.template+" · 大纲 v"+file.planVersion;
  $("pptPreviewImage").src=file.previews[pptUI.previewPage];$("pptPreviewImage").alt="PPT 第 "+(pptUI.previewPage+1)+" 页";
  $("pptPreviewNumber").textContent=(pptUI.previewPage+1)+" / "+file.previews.length;
  const mapped=file.pageMap?.find(p=>p.outputPages.includes(pptUI.previewPage+1));
  if(mapped) $("pptPreviewNumber").textContent+=" · 大纲第 "+mapped.outlinePage+" 页";
  $("pptPreviousSlide").disabled=pptUI.previewPage===0;$("pptNextSlide").disabled=pptUI.previewPage===file.previews.length-1;
  $("pptPreviewDownload").href=file.downloadUrl;
}
async function openTemplateManager(){
  openDialog("pptTemplateDialog");$("pptTemplateVersionInfo").textContent="正在读取模板库…";
  try{await loadPptLibrary(true);if(!pptUI.selectedVersion)pptUI.selectedVersion=pptUI.library.defaultVersion;renderTemplateManager();}
  catch(e){$("pptTemplateVersionInfo").textContent=e.message;}
}
function renderTemplateManager(){
  const versions=pptVersions(), v=versions.find(v=>v.id===pptUI.selectedVersion)||versions[0];if(!v)return;
  pptUI.selectedVersion=v.id;
  $("pptLibrarySelect").innerHTML=versions.map(r=>'<option value="'+escapeHtml(r.id)+'">'+escapeHtml(r.name)+' · v'+r.version+' · '+(r.state==="draft"?'待确认版式':r.id===pptUI.library.defaultVersion?'默认':'已启用')+'</option>').join("");$("pptLibrarySelect").value=v.id;
  $("pptTemplateVersionInfo").textContent=v.name+" v"+v.version+" · "+v.inspection.slides.length+" 页示例 · "+v.inspection.masters+" 套母版 · "+v.inspection.layouts+" 个版式。"+(v.description||"");
  const disabled=v.state!=="draft"?'disabled':'', opts=selected=>v.inspection.slides.map(s=>'<option value="'+s.number+'" '+(s.number===selected?'selected':'')+'>第 '+s.number+' 页 · '+escapeHtml(s.texts[0]?.text||s.layout)+'</option>').join(""), closingOpts=selected=>'<option value="" '+(selected==null?'selected':'')+'>不添加结尾页</option>'+opts(selected);
  $("pptTemplateMapping").innerHTML='<strong>页面用途映射</strong><p class="muted-line">选择生成各类页面时复用的示例页。数据表格与图表使用“正文”页背景。结尾页会在全部内容页后自动保留，不计入大纲页数。启用后映射固定，调整请上传新版本。</p><div class="ppt-map-roles">'+["cover","agenda","section","content"].map(r=>'<label class="field"><span>'+pptLayouts[r]+'</span><select id="ppt-map-'+r+'" '+disabled+'>'+opts(v.mapping.roles[r])+'</select></label>').join("")+'<label class="field"><span>结尾页（可选）</span><select id="ppt-map-closing" '+disabled+'>'+closingOpts(v.mapping.roles.closing)+'</select></label></div><div class="ppt-map-body">'+["左边距 %","上边距 %","宽度 %","高度 %"].map((label,i)=>'<label class="field"><span>'+label+'</span><input id="ppt-body-'+i+'" type="number" step="0.1" min="0" max="100" value="'+Math.round(v.mapping.body[i]*1000)/10+'" '+disabled+' /></label>').join("")+'</div><p class="muted-line">正文区域需避开公司图片和背景元素，并为页脚留出底部 13%。正文会替换示例页文字，背景图片保留。</p>';
  $("pptTemplatePages").innerHTML=v.inspection.slides.map((s,i)=>'<figure class="ppt-template-page"><img src="'+escapeHtml(v.previews[i])+'" alt="模板示例第 '+s.number+' 页" loading="lazy" /><figcaption>第 '+s.number+' 页 · '+escapeHtml(s.layout)+'</figcaption><label class="field"><span>本页标题对象</span><select data-ppt-title="'+s.number+'" '+disabled+'><option value="">自动添加标题</option>'+s.texts.map(t=>'<option value="'+t.id+'" '+(v.mapping.titles[String(s.number)]===t.id?'selected':'')+'>'+escapeHtml(t.text)+'</option>').join("")+'</select></label></figure>').join("");
  $("pptMakeDefault").checked=v.id===pptUI.library.defaultVersion;
  $("pptEnableTemplate").textContent=v.state==="draft"?"确认版式并启用":"启用此版本 / 应用默认设置";
  $("pptUploadTemplateTarget").innerHTML='<option value="">创建新模板</option>'+pptUI.library.templates.map(t=>'<option value="'+escapeHtml(t.id)+'">'+escapeHtml(t.name)+' · 上传新版</option>').join("");
}
async function uploadPptTemplate(){
  const file=$("pptTemplateFile").files?.[0];if(!file){showToast("请选择一个 .pptx 模板。","error");return;}
  const b=$("pptTemplateUploadSubmit");b.disabled=true;$("pptTemplateUploadStatus").textContent="正在检查并渲染模板页面，请稍候…";
  try{const v=await pptPost("templates/upload",{name:file.name,dataBase64:await readPptFile(file),templateName:$("pptNewTemplateName").value,templateId:$("pptUploadTemplateTarget").value,description:$("pptTemplateDescription").value});pptUI.selectedVersion=v.id;await loadPptLibrary(true);renderTemplateManager();$("pptTemplateUploadForm").classList.add("is-hidden");showToast("模板已上传，请检查页面用途并启用。");}
  catch(e){$("pptTemplateUploadStatus").textContent=e.message;showToast(e.message,"error");}
  finally{b.disabled=false;}
}
async function enablePptTemplate(){
  const v=pptVersions().find(v=>v.id===pptUI.selectedVersion);if(!v)return;
  const mapping={roles:{},titles:{},body:[0,1,2,3].map(i=>Number($("ppt-body-"+i).value)/100)};
  ["cover","agenda","section","content"].forEach(r=>mapping.roles[r]=Number($("ppt-map-"+r).value));
  const closing=$("ppt-map-closing").value; mapping.roles.closing=closing ? Number(closing) : null;
  document.querySelectorAll("[data-ppt-title]").forEach(s=>mapping.titles[s.dataset.pptTitle]=s.value?Number(s.value):null);
  $("pptEnableTemplate").disabled=true;
  try{await pptPost("templates/enable",{versionId:v.id,generation:pptUI.library.generation,mapping,makeDefault:$("pptMakeDefault").checked,confirmed:true});await loadPptLibrary(true);renderTemplateManager();showToast("模板已启用，已有任务保持原版本。");}
  catch(e){showToast(e.message,"error");}
  finally{$("pptEnableTemplate").disabled=false;}
}
function bindPpt(){
  $("templateManagerButton").onclick=openTemplateManager;$("pptTemplatesLink").onclick=openTemplateManager;
  $("pptUploadButton").onclick=()=>$("pptMaterialInput").click();
  $("pptMaterialInput").onchange=e=>{const files=Array.from(e.target.files||[]);e.target.value="";uploadPptMaterials(files);};
  $("pptTemplateSelect").onchange=e=>changePpt({versionId:e.target.value});
  $("pptReviewButton").onclick=openPptReview;$("pptGenerateButton").onclick=confirmPpt;$("pptReviewGenerate").onclick=confirmPpt;
  $("pptPreviousSlide").onclick=()=>{pptUI.previewPage--;renderPptPreview();};$("pptNextSlide").onclick=()=>{pptUI.previewPage++;renderPptPreview();};
  $("pptLibrarySelect").onchange=e=>{pptUI.selectedVersion=e.target.value;renderTemplateManager();};
  $("pptNewTemplateButton").onclick=()=>$("pptTemplateUploadForm").classList.toggle("is-hidden");
  $("pptTemplateUploadSubmit").onclick=uploadPptTemplate;$("pptEnableTemplate").onclick=enablePptTemplate;
  $("pptUploadTemplateTarget").onchange=e=>{$("pptNewTemplateName").disabled=Boolean(e.target.value);};
}
