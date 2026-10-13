import { DEFAULT_AGENT, ENDPOINT, buildMessages, eventMeaning, readSSE } from './lib/chat.js';
import { renderMarkdown } from './lib/markdown.js';
import { initKnowledgeManager } from './knowledge-manager.js?v=20260922-history';
import { initReviewManager } from './review-manager.js?v=20261009-review-simple';
import { initConversationManager } from './conversation-manager.js?v=20260922-history';

const taxAccount = await window.WenshuTaxReady;
if (taxAccount) {
const $ = id => document.getElementById(id);
const KEY_STORE = taxAccount.namespace + '.connection';
let key = 'account-session', agent = DEFAULT_AGENT, turns = [], active = null, toastTimer, conversationManager, importedAgent, historyReady = false, reviewManager;
const nodes = new Map();

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
}
function persist() { return conversationManager?.save(); }
function restore() {}
function updateConnection(verified = false) {
  $('connection-label').textContent = taxAccount.configured ? (verified ? '已连通' : '账户已连接') : '服务待连接';
  $('connection-status').classList.toggle('configured', taxAccount.configured);
}
function openSettings() { toast('税务连接由维护人员配置，无需填写 API Key。'); }
function setBusy(busy) {
  $('send-button').hidden = busy;
  $('stop-button').hidden = !busy;
  $('send-button').disabled = busy;
  $('new-chat').disabled = busy;
  $('composer-hint').textContent = busy ? '可继续输入下一问 · 点击停止可中断' : 'Enter 发送 · Shift + Enter 换行';
  $('messages').setAttribute('aria-busy', String(busy));
}
function scrollBottom(force = false) {
  const area = $('scroll-area');
  if (force || area.scrollHeight - area.scrollTop - area.clientHeight < 180) area.scrollTop = area.scrollHeight;
}
function addButton(parent, label, action) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label; button.addEventListener('click', action);
  parent.append(button);
}
async function copyText(value, success) {
  try { await navigator.clipboard.writeText(value); toast(success); }
  catch { window.prompt('浏览器不允许自动复制，请手动复制：', value); }
}
function paint(turn) {
  let parts = nodes.get(turn.id);
  if (!parts) {
    const article = document.createElement('article');
    const heading = document.createElement('div'); heading.className = 'message-heading';
    const avatar = document.createElement('span'); avatar.className = 'message-avatar';
    avatar.textContent = turn.role === 'user' ? '你' : '税';
    heading.append(avatar, document.createTextNode(turn.role === 'user' ? '你的问题' : '税务案头'));
    const content = document.createElement('div'); content.className = 'message-content';
    const status = document.createElement('div'); status.className = 'message-status';
    article.append(heading, content, status); $('messages').append(article);
    parts = { article, content, status }; nodes.set(turn.id, parts);
  }
  const { article, content, status } = parts;
  article.className = `message ${turn.role}${turn.status === 'error' ? ' error' : ''}`;
  if (turn.role === 'user') { content.textContent = turn.content; status.hidden = true; return; }
  if (turn.content) renderMarkdown(content, turn.content);
  else if (turn.status === 'pending') {
    const typing = document.createElement('div'); typing.className = 'typing';
    typing.setAttribute('aria-label', '正在等待回答');
    typing.append(...Array.from({ length: 3 }, () => document.createElement('b')));
    content.replaceChildren(typing);
  } else content.textContent = '未收到完整回答。';
  status.replaceChildren();
  const label = document.createElement('span');
  label.textContent = turn.status === 'pending' ? (turn.phase || '正在连接知识库')
    : turn.status === 'complete' ? '回答完成 · 请核对原始法规'
    : turn.error || '已停止生成，未完成的回答不会进入后续上下文。';
  status.append(label);
  if (turn.status !== 'pending') {
    if (turn.content) addButton(status, '复制回答', () => copyText(turn.content, '回答已复制。'));
    if (turn.status !== 'complete') addButton(status, '重新提问', () => {
      if (active) return toast('请先等待当前回答完成，或停止生成。');
      const index = turns.findIndex(t => t.id === turn.id);
      $('question').value = turns[index - 1]?.content || '';
      $('question').focus();
      toast('问题已放入输入框，可修改后发送。');
    });
  }
}
function renderAll() {
  nodes.clear(); $('messages').replaceChildren();
  $('welcome').hidden = Boolean(turns.length);
  $('messages').hidden = !turns.length;
  turns.forEach(paint);
  if (turns.length) scrollBottom(true);
  else $('scroll-area').scrollTop = 0;
}
function friendlyError(error, request) {
  if (request.timedOut) return '请求超过 180 秒，请稍后重试或缩短问题。';
  if (request.controller.signal.aborted) return '已停止生成；未完成的回答不会进入后续上下文。';
  if (error instanceof TypeError) return '连接未成功，请检查网络及百炼服务的跨域设置后重试。';
  const message = String(error.message || '请求失败，请稍后重试。');
  return key ? message.replaceAll(key, '[Key 已隐藏]') : message;
}
async function send() {
  const question = $('question').value.trim();
  if (!question || active || !historyReady || conversationManager.isChanging()) return;
  if (!key) { openSettings(); return; }
  const messages = buildMessages(turns, question);
  const user = { id: crypto.randomUUID(), role: 'user', content: question, status: 'complete' };
  const answer = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'pending' };
  turns.push(user, answer);
  $('question').value = '';
  $('welcome').hidden = true; $('messages').hidden = false;
  paint(user); paint(answer); scrollBottom(true); persist();
  const request = { controller: new AbortController(), timedOut: false };
  active = request; setBusy(true);
  let completed = false, paintTimer;
  const saveTimer = setInterval(persist, 2000);
  const timeout = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 180000);
  const schedulePaint = () => {
    if (paintTimer) return;
    paintTimer = setTimeout(() => { paintTimer = null; paint(answer); scrollBottom(); }, 70);
  };
  try {
    const response = await window.WenshuTaxFetch(ENDPOINT, {
      method: 'POST', signal: request.controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ input: { messages }, parameters: { agent_options: { agent_id: agent } }, stream: true }),
    });
    if (!response.ok) {
      const advice = response.status === 401 || response.status === 403 ? '请确认登录状态和税务功能权限。'
        : response.status === 429 ? '调用过于频繁或额度不足，请稍后重试并检查百炼额度。' : '请稍后重试并检查百炼应用是否已发布。';
      throw new Error(`百炼返回 HTTP ${response.status}。${advice}`);
    }
    await readSSE(response.body, event => {
      const meaning = eventMeaning(event);
      if (meaning.text) answer.content += meaning.text;
      if (meaning.phase) answer.phase = meaning.phase;
      if (meaning.usage) answer.usage = meaning.usage;
      if (meaning.done) completed = true;
      schedulePaint();
    });
    if (!completed || !answer.content.trim()) throw new Error('连接已结束，但回答未完整生成。请重新提问。');
    answer.status = 'complete'; updateConnection(true);
  } catch (error) {
    answer.status = request.controller.signal.aborted && !request.timedOut ? 'stopped' : 'error';
    answer.error = friendlyError(error, request);
    toast(answer.status === 'stopped' ? '已停止生成。' : '本次回答未完成，可点击「重新提问」。');
  } finally {
    clearTimeout(timeout); clearTimeout(paintTimer); clearInterval(saveTimer);
    active = null; setBusy(false); paint(answer); persist(); scrollBottom();
  }
}

$('chat-form').addEventListener('submit', event => { event.preventDefault(); void send(); });
$('question').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); void send();
  }
});
$('stop-button').addEventListener('click', () => active?.controller.abort());
document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => {
  $('question').value = button.dataset.question; $('question').focus(); void send();
}));
$('question').addEventListener('input', () => { if (historyReady) void persist(); });
$('export-chat').addEventListener('click', () => {
  if (!turns.length) return toast('还没有可以导出的对话。');
  const text = '# 税务案头 · 对话记录\n\n回答仅供测试，请核对有效法规。\n\n' + turns.map(t =>
    `## ${t.role === 'user' ? '问题' : '回答'}${t.role === 'assistant' && t.status !== 'complete' ? '（未完成）' : ''}\n\n${t.content}\n`
  ).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `税务问答-${new Date().toISOString().slice(0, 10)}.md`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
restore(); updateConnection(); renderAll();
const knowledgeManager = initKnowledgeManager({ getKey: () => key, openSettings, toast });
reviewManager = initReviewManager({ getKey: () => key, openSettings, toast });
$('send-button').disabled = true; $('new-chat').disabled = true;
conversationManager = await initConversationManager({
  getState: () => ({ agent, turns, draft: $('question').value }),
  setState: row => { agent = row.agent; turns = row.turns; $('question').value = row.draft; renderAll(); updateConnection(); },
  isBusy: () => Boolean(active), toast, importedAgent, namespace: taxAccount.namespace,
});
historyReady = true; $('send-button').disabled = false; $('new-chat').disabled = false;

$('open-review').hidden = !taxAccount.permissions.review;
document.querySelector('.upload-section').hidden = !taxAccount.permissions.manage;
$('review-reviewer').value = taxAccount.identity.user.displayName;
$('review-reviewer').readOnly = true;
$('open-reports').addEventListener('click', () => reviewManager.openReports());
}
