import { createReviewClient } from './lib/review.js?v=20260924-review';

const $ = id => document.getElementById(id);
const STATUS = { pending_review: '待审核', approved: '已批准 · 待发布', rejected: '已退回', publishing: '提交中', indexing: '解析入库中', reconcile_required: '发布需对账', index_failed: '索引失败', indexed_needs_qa: '索引完成 · 待问答抽验', published: '已发布', deferred_out_of_scope: '暂不纳入', duplicate_source: '同文转载 · 已归并' };
const CHANGE = { first_seen: '首次发现', source_change_candidate: '来源变更待核', extractor_upgrade: '提取方式变更待核' };
const PRIORITY = { high: '高相关', medium: '中相关', low: '低相关', skip: '范围外' };
const KIND = { policy: '政策原文', interpretation: '官方解读', regulation: '监管／扶持资料', official_qa: '官方答复', professional: '专业观点', weekly_report: '投资税务周报 · 研究整理' };
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
function el(tag, className, value) { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; }
function button(label, action, className = 'secondary-button') { const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node; }
function field(parent, label, value) { const row = el('div', 'review-field'); row.append(el('dt', '', label), el('dd', '', value || '—')); parent.append(row); }

export function initReviewManager({ getKey, openSettings, toast }) {
  const dialog = $('review-dialog');
  let status = window.WenshuTax.permissions.review ? 'pending_review' : 'all', page = 1, selected = null, detail = null, busy = false, sequence = 0, searchTimer, decisionAction = 'approve';
  const api = () => createReviewClient(getKey());
  function error(message = '') { $('review-error').textContent = message; $('review-error').hidden = !message; }
  function selectedError(message = '') { $('review-decision-error').textContent = message; }
  function setTab() {
    document.querySelectorAll('[data-review-status]').forEach(tab => {
      tab.hidden = !window.WenshuTax.permissions.review;
      const active = tab.dataset.reviewStatus === status;
      tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active));
    });
  }
  async function refresh({ keep = true } = {}) {
    if (!dialog.open || !getKey()) return;
    const turn = ++sequence;
    $('review-refresh').disabled = true; error('');
    try {
      const result = await api().request('list', { status, page, query: $('review-search').value.trim(), kind: $('review-kind').value, priority: $('review-priority').value });
      if (turn !== sequence) return;
      $('review-count-pending').textContent = result.counts.pending_review;
      $('review-count-approved').textContent = result.counts.approved;
      $('review-count-processing').textContent = result.counts.processing;
      $('review-count-history').textContent = result.counts.history;
      const run = result.run;
      $('review-run').textContent = run ? `最近采集 ${date(run.generatedAt)} · ${run.status === 'complete' ? '完整' : '不完整'}` : '尚无采集记录';
      $('review-run').classList.toggle('incomplete', Boolean(run && run.status !== 'complete'));
      if (run?.errors?.length) $('review-run').title = run.errors.join('；');
      else $('review-run').removeAttribute('title');
      page = result.page;
      $('review-page').textContent = `第 ${page} / ${Math.max(1, Math.ceil(result.total / 20))} 页`;
      $('review-prev').disabled = page <= 1;
      $('review-next').disabled = page * 20 >= result.total;
      renderList(result.rows);
      const target = keep && selected && result.rows.find(row => row.id === selected.id && row.hash === selected.hash) || result.rows[0];
      if (target) await select(target);
      else { selected = null; detail = null; $('review-detail').replaceChildren(el('p', 'review-empty', '当前筛选下没有资料。可切换状态或清空搜索条件。')); }
    } catch (failure) { if (turn === sequence) error(failure.message); }
    finally { if (turn === sequence) $('review-refresh').disabled = false; }
  }
  function renderList(rows) {
    const list = $('review-list'); list.replaceChildren();
    for (const row of rows) {
      const item = button('', () => void select(row), 'review-item');
      item.dataset.id = row.id; item.dataset.hash = row.hash;
      item.classList.toggle('selected', selected?.id === row.id && selected?.hash === row.hash);
      const top = el('span', 'review-item-top');
      top.append(el('span', `review-priority ${row.priority}`, PRIORITY[row.priority] || '待核'), el('span', 'review-item-kind', KIND[row.kind] || '待分类'));
      item.append(top, el('strong', '', row.title));
      item.append(el('span', 'review-item-meta', [row.docNumber, row.issuedDate, row.attachmentCount ? `${row.attachmentCount} 个附件` : ''].filter(Boolean).join(' · ')));
      item.append(el('span', 'review-item-bottom', `${STATUS[row.status] || row.status} · ${CHANGE[row.changeOrigin] || '当前版本'}`));
      list.append(item);
    }
  }
  async function select(row) {
    selected = { id: row.id, hash: row.hash };
    document.querySelectorAll('.review-item').forEach(item => item.classList.remove('selected'));
    for (const item of $('review-list').children) if (item.dataset.id === row.id && item.dataset.hash === row.hash) { item.classList.add('selected'); break; }
    const selection = `${row.id}:${row.hash}`;
    $('review-detail').replaceChildren(el('p', 'review-empty', '正在读取原文和审核证据…'));
    try {
      const result = await api().request('detail', selected);
      if (`${selected?.id}:${selected?.hash}` !== selection) return;
      detail = result; renderDetail(result);
    } catch (failure) { if (`${selected?.id}:${selected?.hash}` === selection) $('review-detail').replaceChildren(el('p', 'review-error-inline', failure.message)); }
  }
  function renderDetail(item) {
    const pane = $('review-detail'); pane.replaceChildren();
    const heading = el('div', 'review-detail-heading');
    heading.append(el('span', `review-status ${item.status}`, STATUS[item.status] || item.status));
    heading.append(el('h3', '', item.title));
    heading.append(el('p', 'review-detail-meta', `${KIND[item.kind] || '待分类'} · ${item.category || '资料'} · ${PRIORITY[item.priority] || '待核'}`));
    pane.append(heading);
    const facts = el('dl', 'review-facts');
    if (item.kind !== 'weekly_report') field(facts, '文号', item.docNumber);
    field(facts, item.kind === 'weekly_report' ? '整理单位' : '发布单位', item.publisher);
    field(facts, item.kind === 'weekly_report' ? '报告生成日期' : '来源日期（核对成文／发布）', item.issuedDate);
    field(facts, '发现时间', date(item.discoveredAt)); field(facts, '版本原因', CHANGE[item.changeOrigin] || '当前版本');
    if (item.source.sourceTaxPolicy) field(facts, '官方效力标注', String(item.source.sourceTaxPolicy));
    pane.append(facts);
    if (item.region) field(facts, '关注地区', item.region);
    if (item.kind === 'weekly_report') {
      field(facts, '统计区间', `${item.periodStart} 至 ${item.periodEnd}（不含右端点）`);
      pane.append(el('p', 'review-hint', '周报是研究整理，报告日期不代表法规施行日。请核对每项引用原文。'));
      if (!item.reportComplete) pane.append(el('p', 'review-blocker', '本版本存在未完成检查或整理校验失败，暂不能发布。请查看正文末尾的待核实事项。'));
      const refs = el('section', 'review-evidence'); refs.append(el('h4', '', '周报引用来源'));
      for (const ref of item.references || []) { const link = el('a', '', `[${ref.ref}] ${ref.title} · ${KIND[ref.kind] || '待分类'} · ${ref.publishedDate || '日期待核'}`); link.href = ref.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; const row = el('p'); row.append(link); refs.append(row); }
      pane.append(refs);
    } else if (item.source.url) { const source = el('p', 'review-source'); const link = el('a', '', '查看官方来源 ↗'); link.href = item.source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; source.append(link); pane.append(source); }
    if (item.aliasOf) pane.append(el('p', 'review-hint', `同文转载已归并，主档案：${item.aliasOf.id}`));
    for (const alias of item.aliases || []) { const link = el('a', '', `同文转载出处：${alias.source.publisher}`); link.href = alias.source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; const row = el('p'); row.append(link); pane.append(row); }
    const seal = el('div', 'review-seal'); seal.append(el('span', '', '当前证据 SHA-256'), el('code', '', item.hash));
    seal.append(button('复制校验值', async () => { try { await navigator.clipboard.writeText(item.hash); toast('校验值已复制。'); } catch { toast('复制失败，请手动选取校验值。'); } }, 'text-button'));
    pane.append(seal);
    const downloads = el('div', 'review-downloads'); downloads.append(el('h4', '', '原文与附件'));
    for (const [file, label] of [['source.html', '网页快照'], ['source.txt', '正文文本'], ['review.md', '审核卡片']]) downloads.append(button(`下载${label}`, () => void download(item, file), 'secondary-button'));
    if (item.kind === 'weekly_report') downloads.append(button('下载引用清单', () => void download(item, 'evidence.json')));
    for (const attachment of item.attachments) downloads.append(button(`下载附件 · ${attachment.label || attachment.file}`, () => void download(item, attachment.file), 'secondary-button'));
    pane.append(downloads);
    const card = el('section', 'review-evidence'); card.append(el('h4', '', '审核线索与版本差异'), el('pre', '', item.card));
    if (item.cardTruncated) card.append(el('p', 'review-hint', '审核卡片过长，下载完整文件查看。'));
    pane.append(card);
    const body = el('section', 'review-evidence'); body.append(el('h4', '', '正文预览'), el('pre', '', item.text));
    if (item.textTruncated) body.append(el('p', 'review-hint', '正文预览已截断，请下载完整原文核对。'));
    pane.append(body);
    if (item.decision) {
      const decision = el('section', 'review-decision-record'); decision.append(el('h4', '', '审核记录'));
      decision.append(el('p', '', `${item.decision.reviewer || '系统'} · ${date(item.decision.reviewedAt || item.decision.decidedAt)}`));
      decision.append(el('p', '', item.decision.effectNote || item.decision.reason || ''));
      if (item.decision.applicableFrom) decision.append(el('p', '', `适用起始日 ${item.decision.applicableFrom || '未单独记录'}${item.decision.effectiveDate ? ` · 施行日 ${item.decision.effectiveDate}` : ''}`));
      pane.append(decision);
    }
    const actions = el('div', 'review-detail-actions');
    if (!window.WenshuTax.permissions.review) { pane.append(actions); return; }
    if (item.status === 'pending_review') {
      actions.append(button('退回', () => openDecision('reject'), 'review-reject-button'), button('审核通过', () => openDecision('approve'), 'primary-button'));
    } else if (item.status === 'approved') actions.append(button('检查发布条件', () => void plan(item), 'primary-button'));
    else if (item.status === 'indexing') actions.append(button('查询索引状态', () => void check(item), 'primary-button'));
    else if (item.status === 'reconcile_required') actions.append(el('p', 'review-hint', '发布结果不确定。请先核对百炼文件与 OSS 台账，暂不可重复提交。'));
    else if (item.status === 'index_failed') actions.append(el('p', 'review-hint', '索引失败。请在百炼控制台与 OSS 台账核对后处理。'));
    else if (item.status === 'indexed_needs_qa') actions.append(el('p', 'review-hint', '索引已完成，仍需进行网页和微信代表性问答抽验。'));
    pane.append(actions);
  }
  async function download(item, file) {
    try {
      const result = await api().request('download', { id: item.id, hash: item.hash, file });
      const link = el('a'); link.href = result.url; link.rel = 'noreferrer'; link.download = file;
      document.body.append(link); link.click(); link.remove();
      toast('文件已交给浏览器下载，请查看下载列表。');
    } catch (failure) { error(failure.message); }
  }
  function openDecision(action) {
    if (!detail || detail.status !== 'pending_review') return;
    decisionAction = action;
    $('review-decision-title').textContent = action === 'approve' ? '审核通过' : '退回资料';
    $('review-decision-name').textContent = `${detail.title} · ${detail.hash.slice(0, 12)}`;
    const report = detail.kind === 'weekly_report';
    $('review-approval-fields').hidden = action !== 'approve' || report;
    $('review-report-approval-fields').hidden = action !== 'approve' || !report;
    $('review-note-label').textContent = '备注（选填）';
    $('review-note').placeholder = '可填写补充说明，也可留空。';
    $('review-decision-submit').textContent = action === 'approve' ? '确认审核通过' : '确认退回';
    $('review-decision-submit').className = action === 'approve' ? 'primary-button' : 'danger-button';
    $('review-decision-form').reset(); selectedError(''); $('review-decision-dialog').showModal(); $('review-reviewer').value = window.WenshuTax.identity.user.displayName; $('review-reviewer').readOnly = true; $('review-note').focus();
  }
  async function submitDecision(event) {
    event.preventDefault(); if (busy || !detail) return;
    busy = true; $('review-decision-submit').disabled = true; $('review-decision-cancel').disabled = true; selectedError('');
    try {
      await api().request('decide', {
        id: detail.id, hash: detail.hash, action: decisionAction,
        reviewer: $('review-reviewer').value.trim(), note: $('review-note').value.trim(),
        confirmedOriginal: decisionAction === 'approve' && $('review-confirm-original').checked,
        confirmedReferences: decisionAction === 'approve' && $('review-confirm-references').checked,
      });
      $('review-decision-dialog').close(); toast(decisionAction === 'approve' ? '审核已通过，资料仍未发布到知识库。' : '资料已退回，原始证据仍保存在私有存储。');
      await refresh({ keep: false });
    } catch (failure) { selectedError(failure.message); if (failure.status === 409) void refresh(); }
    finally { busy = false; $('review-decision-submit').disabled = false; $('review-decision-cancel').disabled = false; }
  }
  async function plan(item) {
    if (busy) return; busy = true; error('');
    try {
      const result = await api().request('plan', { id: item.id, hash: item.hash });
      if (selected?.id !== item.id || selected?.hash !== item.hash) return;
      const actions = $('review-detail').querySelector('.review-detail-actions'); actions.replaceChildren();
      const box = el('div', 'review-plan'); box.append(el('strong', '', result.canPublish ? '发布预检通过' : '当前不能发布'));
      box.append(el('p', '', `目标：tax-law-poc · ${result.fileName} · ${result.attachments} 个附件`));
      for (const reason of result.reasons) box.append(el('p', 'review-blocker', reason));
      if (result.canPublish) box.append(button('确认发布到知识库', () => void publish(item), 'primary-button'));
      actions.append(box);
    } catch (failure) { error(failure.message); }
    finally { busy = false; }
  }
  async function publish(item) {
    if (busy) return; busy = true; error('');
    const action = $('review-detail').querySelector('.review-plan button'); if (action) action.disabled = true;
    try {
      await api().request('publish', { id: item.id, hash: item.hash });
      toast('已提交百炼解析入库。请继续检查索引状态。'); status = 'processing'; setTab(); page = 1; await refresh({ keep: false });
    } catch (failure) { error(failure.message); await refresh(); }
    finally { busy = false; if (action) action.disabled = false; }
  }
  async function check(item) {
    if (busy) return; busy = true; error('');
    try {
      const result = await api().request('check', { id: item.id, hash: item.hash });
      toast(result.status === 'indexed_needs_qa' ? '索引已完成，请进行问答抽验。' : result.status === 'index_failed' ? '索引失败，请核对百炼任务。' : '百炼仍在解析入库。');
      await refresh();
    } catch (failure) { error(failure.message); }
    finally { busy = false; }
  }
  function open() {
    if (!getKey()) { toast('请先填写有资料审核权限的 Key。'); openSettings(); return; }
    dialog.showModal(); void refresh({ keep: false });
  }
  $('open-review').addEventListener('click', () => { status = 'pending_review'; $('review-kind').value = ''; setTab(); open(); });
  if (!window.WenshuTax.permissions.review) $('review-kind').disabled = true;
  $('close-review').addEventListener('click', () => dialog.close());
  $('review-refresh').addEventListener('click', () => void refresh());
  $('review-prev').addEventListener('click', () => { page--; void refresh({ keep: false }); });
  $('review-next').addEventListener('click', () => { page++; void refresh({ keep: false }); });
  document.querySelectorAll('[data-review-status]').forEach(tab => tab.addEventListener('click', () => { status = tab.dataset.reviewStatus; page = 1; selected = null; setTab(); void refresh({ keep: false }); }));
  $('review-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; void refresh({ keep: false }); }, 250); });
  for (const id of ['review-kind', 'review-priority']) $(id).addEventListener('change', () => { page = 1; void refresh({ keep: false }); });
  $('review-decision-form').addEventListener('submit', event => void submitDecision(event));
  $('review-decision-cancel').addEventListener('click', () => $('review-decision-dialog').close());
  return { openReports: () => { $('review-kind').value = 'weekly_report'; status = window.WenshuTax.permissions.review ? 'all' : 'all'; setTab(); dialog.showModal(); void refresh({ keep: false }); }, isBusy: () => busy };
}
