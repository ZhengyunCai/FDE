/* =======================================================================
   界面层
   ======================================================================= */
const TABS = [
  { id: 'ov', label: '总览', icon: '▦' },
  { id: 'fb', label: '反馈归集', icon: '⇩' },
  { id: 'ch', label: '变更同步', icon: '⇄' },
  { id: 'sg', label: '建议复核', icon: '✔' },
  { id: 'kb', label: '知识库', icon: '▤' },
  { id: 'hs', label: '测试台 Harness', icon: '⚑' },
  { id: 'ad', label: '权限与账号', icon: '⚙' },
  { id: 'au', label: '审计', icon: '≡' }
];
const SUB = {
  ov: '五项验收指标的实时口径 · 分层权限下同一份数据的不同视图',
  fb: '接入层：企业评分原文 → 可用性判定 → 三元组抽取（REQ-01 / E2）',
  ch: '变更同步：换岗/延期/任务变更 → 改派确认（N3）→ 错发拦截（E1）',
  sg: '复核台：三元组 → 建议草稿 → 三要素校验（N2）→ 签核入库，全过程可回指原记录',
  kb: '知识库：Wiki 页 + 36 条访谈事实的检索增强（RAG）+ 带引用的问答',
  hs: '同一套接口契约下的 30 项自动化检查，覆盖权限、不可逆动作、异常清单与检索质量',
  ad: 'SaaS 管理员管用户与口径；分层用户按企业与学生范围收敛可见域',
  au: '审计旁路：只追加、无更新/删除路由，能重建当次处理'
};
const state = { token: null, user: null, tab: 'ov', hs: null, newFb: false };

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const req = (m, p, b) => api(m, p, b || {}, state.token);
const can = roles => roles.includes(state.user && state.user.role);

let toastTimer = null;
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast ' + (kind || ''); }, 2600);
}

/* ---------------- 登录 ---------------- */
function quick(u) { $('uName').value = u; $('uPwd').value = (USERS.find(x => x.username === u) || {}).password || ''; doLogin(); }
function doLogin() {
  const r = api('POST', '/api/login', { username: $('uName').value.trim(), password: $('uPwd').value });
  if (r.code !== 200) { $('loginErr').textContent = r.data.detail; return; }
  $('loginErr').textContent = '';
  state.token = r.data.token; state.user = r.data;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderShell();
  switchTab('ov');
}
function logout() {
  state.token = null; state.user = null; state.hs = null;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('uPwd').value = 'admin123'; $('uName').value = 'admin';
}

function renderShell() {
  const u = state.user;
  $('whoName').textContent = u.display;
  $('whoRole').textContent = u.roleName + (u.orgId ? ' · ' + ename(u.orgId) : '');
  $('avatar').textContent = (u.display || 'U').slice(0, 1);
  $('nav').innerHTML = TABS.map(t => '<button id="nav-' + t.id + '" onclick="switchTab(\'' + t.id + '\')"><i>' + t.icon + '</i>' + t.label + '</button>').join('');
}
function switchTab(id) {
  state.tab = id;
  TABS.forEach(t => { const b = $('nav-' + t.id); if (b) b.className = t.id === id ? 'on' : ''; });
  $('pageTitle').textContent = (TABS.find(t => t.id === id) || {}).label || '';
  $('pageSub').textContent = SUB[id] || '';
  const u = state.user;
  $('topChips').innerHTML =
    '<span class="chip b">' + esc(u.roleName) + '</span>' +
    (u.orgId ? '<span class="chip">' + esc(ename(u.orgId)) + '</span>' : '<span class="chip">全校范围</span>') +
    '<span class="chip">口径 koujing_v1.0</span>' +
    (id === 'hs' ? '<span class="chip g">30 项</span>' : '');
  const R = { ov: renderOv, fb: renderFb, ch: renderCh, sg: renderSg, kb: renderKb, hs: renderHs, ad: renderAd, au: renderAu };
  (R[id] || renderOv)();
}

/* ---------------- 总览 ---------------- */
function renderOv() {
  const o = req('GET', '/api/overview').data;
  const cfg = req('GET', '/api/config').data;
  const meta = {
    M1: { unit: '%', fmt: v => (v * 100).toFixed(1) + '%', note: '目标 85%' },
    M2: { unit: '条', fmt: v => v, note: '目标 24 条' },
    M3: { unit: 'h', fmt: v => v.toFixed(0) + ' h', note: '目标 6 h/月' },
    M4: { unit: '条', fmt: v => v, note: '硬指标 0' },
    M5: { unit: '%', fmt: v => (v * 100).toFixed(0) + '%', note: '阈值 ≤5%' }
  };
  const cards = ['M1', 'M2', 'M3', 'M4', 'M5'].map(k => {
    const m = o[k], mt = meta[k];
    const ok = m.hit;
    return '<div class="metric ' + (ok ? 'ok' : 'bad') + '">' +
      '<div class="k"><span>' + k + ' · ' + esc(m.label) + '</span></div>' +
      '<div class="v">' + mt.fmt(m.value) + '</div>' +
      '<div class="d">' + esc(m.detail) + '</div>' +
      '<div class="bar"><i style="width:' + Math.max(4, Math.round((m.pct || 0) * 100)) + '%"></i></div>' +
      '<div class="d" style="margin-top:6px;color:var(--mute)">' + mt.note + ' · ' + (ok ? '达标' : '未达标') + '</div>' +
      '</div>';
  }).join('');

  const pipe = [
    ['① 接入', '人工补录 / 种子导入<br/>标来源与版本'],
    ['② 映射', '三套编号对齐<br/>SID · INTERN · COURSE'],
    ['③ 规则', '口径换算 / 幂等<br/>前置确定性校验'],
    ['④ 模型', '评语 → 三元组<br/>置信度 < 0.6 转人工'],
    ['⑤ 复核', '人工确认 / 提升<br/>三要素校验'],
    ['⑥ 输出', '建议入库 + 回指<br/>原记录与签核时间']
  ].map((s, i) => '<div class="step"><b>' + s[0] + '</b><small>' + s[1] + '</small></div>' + (i < 5 ? '<div class="arr">›</div>' : '')).join('');

  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">验收指标（M1–M5）</h3><div class="spacer"></div>' +
    '<span class="chip ' + (o.M4.hit ? 'g' : 'r') + '">错发 ' + o.M4.value + ' 条</span>' +
    '<span class="chip y">待人工队列 ' + o.queues.humanQueue + '</span>' +
    '<span class="chip r">证据不足 ' + o.queues.insufficient + '</span></div>' +
    '<div class="sub">分母口径：学生 × 双周批次累计（' + esc(cfg.denominator) + '）；两套分母并行计算用于 M5 偏差监控</div>' +
    '<div class="grid5">' + cards + '</div></div>' +

    '<div class="card"><h3>处理链路（六层 + 审计旁路）</h3><div class="sub">每一层都只做一件事；不可逆动作前有确定性校验，模型只负责“抽取与草稿”</div>' +
    '<div class="pipe">' + pipe + '</div>' +
    '<div class="note" style="margin-top:10px">审计旁路：写操作一律留痕（who / when / what / 结果），只追加、无更新与删除路由。当前会话已记录 <b>' + DB.audit.length + '</b> 条。</div></div>' +

    '<div class="two"><div class="card"><h3>数据体量</h3><div class="sub">试点规模：机电专业 12 名学生 × 5 家企业 × 2 个双周批次</div>' +
    '<table><tbody>' +
    '<tr><td>反馈条数</td><td class="mono">' + o.counts.feedbacks + '</td><td>变更事件</td><td class="mono">' + o.counts.changes + '</td></tr>' +
    '<tr><td>未同步变更</td><td class="mono">' + o.counts.unsynced + '</td><td>三元组</td><td class="mono">' + o.counts.triples + '</td></tr>' +
    '<tr><td>建议条数</td><td class="mono">' + o.counts.suggestions + '</td><td>知识库文档</td><td class="mono">' + KB.docs.length + '</td></tr>' +
    '</tbody></table></div>' +

    '<div class="card"><h3>口径注册表</h3><div class="sub">版本化，变更需备案（教育-026 / N4）</div>' +
    '<dl class="kv"><dt>版本</dt><dd class="mono">' + esc(cfg.version) + '</dd>' +
    '<dt>分母</dt><dd>' + esc(cfg.denominator) + '</dd>' +
    '<dt>周期</dt><dd class="mono">' + cfg.periods.join(' · ') + '</dd>' +
    '<dt>五分制换算</dt><dd class="mono">5→95 · 4→85 · 3→75 · 2→65 · 1→55</dd>' +
    '<dt>未备案企业</dt><dd>' + cfg.enterprises.filter(e => e.scaleStatus !== 'filed').map(e => esc(e.name)).join('、') + '（不参与汇总，E3）</dd>' +
    '<dt>抽取器</dt><dd>离线规则抽取器 · <span class="mono">prompt_v1.0-mvp</span>（可切换在线 LLM）</dd></dl></div></div>';
}

/* ---------------- 反馈归集 ---------------- */
function renderFb() {
  const list = req('GET', '/api/feedbacks').data;
  const scope = state.user.role === 'mentor' ? ('仅本企业：' + ename(state.user.orgId)) : '全量（按角色收敛）';
  const rows = list.map(f =>
    '<tr><td class="mono">' + f.id + '</td><td>' + esc(f.sname) + '</td><td>' + esc(f.ename) + '</td>' +
    '<td class="mono">' + esc(f.period) + '</td><td>' + esc(f.task || '—') + '</td>' +
    '<td class="mono">' + (f.scoreRaw == null ? '—' : f.scoreRaw + ' / ' + f.scoreType) + '</td>' +
    '<td>' + (f.status === 'insufficient' ? '<span class="st bad">证据不足</span>' : f.status === 'ok' ? '<span class="st ok">可用</span>' : '<span class="st info">已提交</span>') + '</td>' +
    '<td style="max-width:320px;color:#42566e">' + esc((f.comment || '').slice(0, 64)) + (f.comment && f.comment.length > 64 ? '…' : '') + '</td>' +
    '<td><button class="btn ghost small" onclick="extractFb(' + f.id + ')">抽取三元组</button></td></tr>').join('');

  const opts = DB.students.filter(s => state.user.role !== 'mentor' || s.eid === state.user.orgId)
    .map(s => '<option value="' + s.sid + '">' + s.name + ' · ' + ename(s.eid) + '</option>').join('');
  const tasks = ['数控加工', '零件编程', '装配调试', '质量检验', '设备维护', '模具设计', '工艺文件', 'CAD制图', '现场巡检', '物料管理'];

  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">反馈台账</h3><div class="spacer"></div>' +
    '<span class="chip">' + esc(scope) + '</span>' +
    (can(['mentor', 'teacher', 'jiaowu', 'admin']) ? '<button class="btn small" onclick="toggleNewFb()">＋ 人工补录</button>' : '') +
    '</div><div class="sub">可用判定 = 五项字段齐备 + 行为实例不少于 12 字（区别于“六项非空”的旧校验）</div>' +
    (state.newFb ? '<div class="note" style="margin-bottom:12px">' +
      '<div class="row" style="gap:8px;margin-bottom:8px">' +
      '<select class="f" id="fbSid" style="max-width:220px">' + opts + '</select>' +
      '<select class="f" id="fbPeriod" style="max-width:110px"><option>P02</option><option>P03</option></select>' +
      '<select class="f" id="fbTask" style="max-width:150px">' + tasks.map(t => '<option>' + t + '</option>').join('') + '</select>' +
      '<input class="f" id="fbScore" placeholder="原始分" style="max-width:100px" />' +
      '<select class="f" id="fbType" style="max-width:100px"><option value="100">百分制</option><option value="5">五分制</option></select>' +
      '</div>' +
      '<textarea class="f" id="fbComment" rows="3" placeholder="粘贴企业导师评语原文，例如：本周独立完成 12 件法兰盘车削，1 件因对刀偏差报废。"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn teal small" onclick="submitFb()">提交并留痕</button>' +
      '<span class="note" style="border:0;background:transparent;padding:0">同一学生同一批次重复提交会被幂等键拒绝（E5）</span></div></div>' : '') +
    '<div class="scroll"><table><thead><tr><th>#</th><th>学生</th><th>企业</th><th>批次</th><th>岗位任务</th><th>原始分</th><th>状态</th><th>评语原文</th><th>操作</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div></div>';
}
function toggleNewFb() { state.newFb = !state.newFb; renderFb(); }
function submitFb() {
  const body = {
    sid: $('fbSid').value, period: $('fbPeriod').value, taskHint: $('fbTask').value,
    scoreRaw: $('fbScore').value === '' ? null : Number($('fbScore').value),
    scoreType: $('fbType').value, comment: $('fbComment').value
  };
  const r = req('POST', '/api/feedbacks', body);
  if (r.code === 200) { toast('已提交并写入审计', 'ok'); state.newFb = false; renderFb(); }
  else toast(r.data.detail, 'err');
}
function extractFb(id) {
  const r = req('POST', '/api/feedbacks/' + id + '/extract');
  if (r.code !== 200) { toast(r.data.detail, 'err'); return; }
  const d = r.data;
  toast('抽取结果：' + d.status + '（置信度 ' + d.confidence + '）', d.status === 'insufficient_evidence' ? 'err' : 'ok');
  renderFb();
}

/* ---------------- 变更同步 ---------------- */
function renderCh() {
  const list = req('GET', '/api/changes').data;
  const todos = req('GET', '/api/todos').data;
  const rows = list.map(c =>
    '<tr><td class="mono">' + esc(c.internId) + '</td><td>' + esc(c.sname) + '</td><td>' + esc(c.ename) + '</td>' +
    '<td>' + esc(c.changeType) + '</td><td class="mono">' + esc(c.oldMentor) + ' → ' + esc(c.newMentor) + '</td>' +
    '<td>' + (c.synced ? '<span class="st ok">已同步</span>' : '<span class="st bad">未同步</span>') + '</td>' +
    '<td class="mono">' + c.staleHits + '</td>' +
    '<td>' + (c.risk ? '<span class="st bad">E1 错发风险</span>' : c.synced ? '<span class="st mute">—</span>' : '<span class="st warn">待观察</span>') + '</td>' +
    '<td>' + (can(['jiaowu', 'admin']) && !c.synced ? '<button class="btn ghost small" onclick="doReassign(' + c.id + ')">改派确认</button>' : '<span class="st mute">—</span>') + '</td></tr>').join('');

  const todoRows = todos.length ? todos.map(t =>
    '<tr><td class="mono">' + esc(t.internId) + '</td><td>' + (t.status === 'assigned' ? '<span class="st ok">已派单</span>' : '<span class="st warn">挂起</span>') + '</td>' +
    '<td>' + esc(t.assignee || '—') + '</td><td style="color:#42566e">' + esc(t.note) + '</td></tr>').join('')
    : '<tr><td colspan="4" style="color:var(--mute)">暂无待办。试试点上面的「改派确认」：同一承接人重复派单会被幂等拒绝。</td></tr>';

  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">变更事件与错发拦截</h3><div class="spacer"></div>' +
    '<span class="chip r">错发硬指标 0 条</span><span class="chip y">未同步 ' + list.filter(c => !c.synced).length + ' 条</span></div>' +
    '<div class="sub">E1 判定 = 变更未同步 且 旧导师仍在该实习编号下产生新反馈；风险行必须走 N3 改派确认（承接人具名 + 无同键待办）</div>' +
    '<div class="scroll"><table><thead><tr><th>实习编号</th><th>学生</th><th>企业</th><th>类型</th><th>导师变更</th><th>同步</th><th>旧导师仍在收</th><th>风险</th><th>操作</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div></div>' +
    '<div class="card"><h3>改派待办</h3><div class="sub">全部前置校验通过才落待办并改绑导师；否则写“挂起原因”，不静默失败</div>' +
    '<table><thead><tr><th>实习编号</th><th>状态</th><th>承接人</th><th>说明</th></tr></thead><tbody>' + todoRows + '</tbody></table></div>';
}
function doReassign(id) {
  const nm = window.prompt('请输入承接导师账号（具名，不可为空）', 'mentor-fixed');
  if (nm === null) return;
  const r = req('POST', '/api/changes/' + id + '/reassign', { newMentor: nm.trim() });
  if (r.code !== 200) { toast(r.data.detail, 'err'); return; }
  if (r.data.ok) { toast('改派完成：已落待办并同步导师字段', 'ok'); }
  else { toast('已挂起：' + r.data.fails.join('；'), 'err'); }
  renderCh();
}

/* ---------------- 建议复核 ---------------- */
function renderSg() {
  const trs = req('GET', '/api/triples').data;
  const sugs = req('GET', '/api/suggestions').data;
  const triRows = trs.length ? trs.map(t =>
    '<tr><td class="mono">' + t.id + '</td><td>' + esc(t.sname) + '</td><td>' + esc(t.task || '—') + '</td>' +
    '<td style="max-width:260px">' + esc((t.observed || '—').slice(0, 58)) + '</td>' +
    '<td>' + esc(t.gap || '—') + '</td><td>' + esc(t.course || '—') + '</td>' +
    '<td class="mono">' + t.confidence + '</td>' +
    '<td>' + (t.status === 'auto' ? '<span class="st info">自动·待复核</span>' : t.status === 'insufficient_evidence' ? '<span class="st bad">证据不足</span>' : t.status === 'human_queue' ? '<span class="st warn">人工队列</span>' : '<span class="st ok">' + esc(t.status) + '</span>') + '</td>' +
    '<td>' + (can(['teacher', 'jiaowu', 'admin']) && (t.status === 'auto' || t.status === 'human_queue') ? '<button class="btn ghost small" onclick="promoteTriple(' + t.id + ')">提升为建议</button>' : '<span class="st mute">—</span>') + '</td></tr>').join('')
    : '<tr><td colspan="9" style="color:var(--mute)">还没有三元组。先到「反馈归集」里对一条评语点「抽取三元组」。</td></tr>';

  const sugRows = sugs.length ? sugs.map(s =>
    '<tr><td class="mono">' + s.id + '</td><td>' + esc(s.sname) + '</td><td>' + esc(s.task || '—') + '</td><td>' + esc(s.course || '—') + '</td>' +
    '<td>' + esc(s.owner || '—') + '</td><td class="mono">' + esc(s.feedbackRef) + '</td>' +
    '<td>' + (s.status === 'formal' ? '<span class="st ok">已签核入库</span>' : s.status === 'pending_sign' ? '<span class="st info">待签核</span>' : '<span class="st bad">草稿（三要素缺失）</span>') + '</td>' +
    '<td>' + (can(['jiaowu', 'audit', 'admin']) && s.status === 'pending_sign' ? '<button class="btn teal small" onclick="approveSug(' + s.id + ')">签核入库</button>' : '<span class="st mute">—</span>') + '</td></tr>').join('')
    : '<tr><td colspan="8" style="color:var(--mute)">暂无建议。三元组经人工复核提升后出现在这里。</td></tr>';

  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">三元组（抽取结果）</h3><div class="spacer"></div>' +
    '<span class="chip">置信度阈值 0.6</span><span class="chip y">待复核</span></div>' +
    '<div class="sub">字段：岗位任务 / 观察到的行为 / 差距 / 建议草稿 / 课程候选；输出 schema 内没有分数与等级字段</div>' +
    '<div class="scroll"><table><thead><tr><th>#</th><th>学生</th><th>任务</th><th>行为实例（原文区间可回指）</th><th>差距</th><th>课程候选</th><th>置信度</th><th>状态</th><th>操作</th></tr></thead><tbody>' + triRows + '</tbody></table></div></div>' +
    '<div class="card"><h3>建议草稿与签核</h3><div class="sub">N2 三要素＝课程 + 任务 + 责任人；缺一项只能存草稿，不能签核入库</div>' +
    '<div class="scroll"><table><thead><tr><th>#</th><th>学生</th><th>任务</th><th>课程</th><th>责任人</th><th>原记录引用</th><th>状态</th><th>操作</th></tr></thead><tbody>' + sugRows + '</tbody></table></div></div>';
}
function promoteTriple(id) {
  const r = req('POST', '/api/triples/' + id + '/promote');
  if (r.code !== 200) { toast(r.data.detail, 'err'); return; }
  toast(r.data.status === 'pending_sign' ? '三要素齐备 → 进入待签核' : '三要素缺失（' + r.data.missing.join('、') + '）→ 存为草稿', r.data.status === 'pending_sign' ? 'ok' : '');
  renderSg();
}
function approveSug(id) {
  const r = req('POST', '/api/suggestions/' + id + '/approve');
  r.code === 200 ? toast('已签核入库，引用与时间戳已写入审计', 'ok') : toast(r.data.detail, 'err');
  renderSg();
}

/* ---------------- 知识库 ---------------- */
function renderKb() {
  const wiki = req('GET', '/api/wiki').data;
  const facts = (SEED.facts || []);
  $('view').innerHTML =
    '<div class="two"><div class="card"><h3>检索（RAG）</h3><div class="sub">中文字符 bigram + 标题加权；纯前端实现，与后端 kb.py 同算法</div>' +
    '<div class="row" style="margin-bottom:10px"><input class="f" id="kbQ" style="max-width:320px" placeholder="例如：换岗后仍然关联旧导师 / 完整率分母怎么算" onkeydown="if(event.key===\'Enter\')kbSearch()" />' +
    '<button class="btn small" onclick="kbSearch()">检索</button></div>' +
    '<div id="kbHits" class="note">输入关键词后检索，命中结果会带证据编号，可直接回指访谈原记录。</div></div>' +

    '<div class="card"><h3>问答（带引用）</h3><div class="sub">检索式问答：答案后附引用编号；离线规则组装，不生成无出处内容</div>' +
    '<div class="row" style="margin-bottom:10px"><input class="f" id="kbAsk" style="max-width:360px" placeholder="例如：成绩能不能写回平台？" onkeydown="if(event.key===\'Enter\')kbAsk()" />' +
    '<button class="btn small" onclick="kbAsk()">提问</button></div>' +
    '<pre class="ans" id="kbAns">尚未提问。</pre></div></div>' +

    '<div class="card"><div class="row"><h3 style="margin:0">Wiki 页</h3><div class="spacer"></div><span class="chip">' + wiki.length + ' 页</span><span class="chip b">' + facts.length + ' 条事实</span></div>' +
    '<div class="sub">口径注册表 / 岗位任务 / 制度条款 / 角色职责 / 企业档案 / 停止条件</div>' +
    wiki.map((p, i) => '<div class="wikiItem"><button onclick="toggleWiki(' + i + ')">' + esc(p.title) + '<span class="code">' + esc(p.code) + '</span></button>' +
      '<div id="wiki-' + i + '" class="hidden">' + esc(p.body) + '</div></div>').join('') + '</div>' +

    '<div class="card"><h3>访谈事实库（教育-001 ～ 036）</h3><div class="sub">六位角色 × 36 问，每条带证据编号与需求/验收口径</div>' +
    '<div class="scroll"><table><thead><tr><th>编号</th><th>角色</th><th>主题</th><th>事实原文</th></tr></thead><tbody>' +
    facts.map(f => '<tr><td class="mono">' + esc(f.code) + '</td><td>' + esc(f.character) + '</td><td>' + esc(f.topic) + '</td>' +
      '<td style="color:#42566e">' + esc(f.text) + '</td></tr>').join('') + '</tbody></table></div></div>';
}
function toggleWiki(i) { const d = $('wiki-' + i); if (d) d.className = d.className === 'hidden' ? '' : 'hidden'; }
function kbSearch() {
  const q = $('kbQ').value.trim(); if (!q) return;
  const hits = req('GET', '/api/kb/search?q=' + encodeURIComponent(q)).data;
  $('kbHits').className = '';
  $('kbHits').innerHTML = hits.length ? hits.map(h =>
    '<div class="hit"><span class="sc">' + h.score + '</span><b>' + esc(h.title) + '</b>' +
    '<p>' + esc(h.text.slice(0, 220)) + (h.text.length > 220 ? '…' : '') + '</p></div>').join('')
    : '<div class="note">没有命中。可试：换岗 / 口径 / 完整率 / 权限 / 停止条件。</div>';
}
function kbAsk() {
  const q = $('kbAsk').value.trim(); if (!q) return;
  const r = req('POST', '/api/kb/ask', { question: q }).data;
  $('kbAns').textContent = r.answer + (r.citations.length ? '\n\n引用：' + r.citations.slice(0, 6).map(c => c.code || c.title).join('、') : '');
}

/* ---------------- 测试台 ---------------- */
function renderHs() {
  const allowed = can(['admin', 'audit', 'jiaowu']);
  let body = '<div class="note">当前角色：' + esc(state.user.roleName) + (allowed ? '（可触发）' : '（无触发权限，本应返回 403 并留痕）') + '</div>';
  if (state.hs) {
    const byGroup = {};
    state.hs.results.forEach(r => { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
    const groups = Object.keys(byGroup).map(g =>
      '<div class="hsGroup">' + esc(g) + '（' + byGroup[g].filter(x => x.pass).length + '/' + byGroup[g].length + '）</div>' +
      byGroup[g].map(r => '<div class="hsRow"><span class="ico ' + (r.pass ? 'ok' : 'no') + '">' + (r.pass ? '✓' : '✗') + '</span>' +
        '<span>' + esc(r.name) + '</span><span class="act">期望：' + esc(r.expect) + '</span>' +
        '<span class="act">实际：' + esc(r.actual) + '</span></div>').join('')).join('');
    body = '<div class="hsSum"><b style="color:' + (state.hs.failed ? 'var(--risk)' : 'var(--ok)') + '">' + state.hs.passed + ' / ' + state.hs.total + '</b>' +
      '<span style="color:var(--sub)">通过 · ' + fmtT(state.hs.ranAt) + ' 运行 · 运行后已回滚演示数据</span></div>' + groups;
  }
  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">Harness 自动化评测</h3><div class="spacer"></div>' +
    '<button class="btn" onclick="runHsUI()" ' + (allowed ? '' : 'disabled') + '>运行 30 项检查</button></div>' +
    '<div class="sub">覆盖：鉴权与令牌 · 分层权限与越权留痕 · 不可逆动作前置校验 · 幂等 · 抽取边界 · 口径换算 · 指标分母 · RAG 检索质量 · 审计只追加</div>' +
    body + '</div>' +
    '<div class="card"><h3>异常清单（E1–E8）如何被覆盖</h3><div class="sub">每一条异常都有对应的可执行检查，而不是写在文档里</div>' +
    '<table><tbody>' +
    '<tr><td class="mono">E1</td><td>换岗未同步仍向旧导师发反馈</td><td>' + (state.hs ? (state.hs.results.find(r => r.name.includes('E1')) || {}).pass ? '<span class="st ok">已覆盖</span>' : '<span class="st bad">未通过</span>' : '<span class="st mute">待运行</span>') + '</td></tr>' +
    '<tr><td class="mono">E2</td><td>纯评价形容词无行为实例</td><td>' + (state.hs ? (state.hs.results.find(r => r.name.includes('E2')) || {}).pass ? '<span class="st ok">已覆盖</span>' : '<span class="st bad">未通过</span>' : '<span class="st mute">待运行</span>') + '</td></tr>' +
    '<tr><td class="mono">E3</td><td>五分制未备案企业参与汇总</td><td>' + (state.hs ? (state.hs.results.find(r => r.name.includes('E3')) || {}).pass ? '<span class="st ok">已覆盖</span>' : '<span class="st bad">未通过</span>' : '<span class="st mute">待运行</span>') + '</td></tr>' +
    '<tr><td class="mono">E5</td><td>重复提交 / 重复改派 / 重复提升</td><td>' + (state.hs ? (state.hs.results.find(r => r.name.includes('幂等')) || {}).pass ? '<span class="st ok">已覆盖</span>' : '<span class="st bad">未通过</span>' : '<span class="st mute">待运行</span>') + '</td></tr>' +
    '<tr><td class="mono">E7</td><td>跨企业个体评价越权访问</td><td>' + (state.hs ? (state.hs.results.find(r => r.name.includes('E7')) || {}).pass ? '<span class="st ok">已覆盖</span>' : '<span class="st bad">未通过</span>' : '<span class="st mute">待运行</span>') + '</td></tr>' +
    '<tr><td class="mono">§7</td><td>成绩写回 / 输出 schema 含分数</td><td>' + (state.hs ? (state.hs.results.find(r => r.name.includes('score')) || {}).pass ? '<span class="st ok">已覆盖</span>' : '<span class="st bad">未通过</span>' : '<span class="st mute">待运行</span>') + '</td></tr>' +
    '</tbody></table></div>';
}
function runHsUI() {
  const r = req('GET', '/api/harness/run');
  if (r.code !== 200) { toast(r.data.detail, 'err'); return; }
  state.hs = r.data;
  renderHs();
  toast('通过 ' + r.data.passed + ' / ' + r.data.total + ' 项', r.data.failed ? 'err' : 'ok');
}

/* ---------------- 权限与账号 ---------------- */
function renderAd() {
  const matrix =
    '<table class="matrix"><thead><tr><th>能力</th><th>SaaS 管理员</th><th>教务</th><th>指导教师</th><th>企业导师</th><th>风险合规</th></tr></thead><tbody>' +
    [['全量反馈可见', 'y', 'y', 'y', '本企业', 'y'],
     ['提交反馈', 'y', 'y', 'y', 'y', 'n'],
     ['抽取三元组', 'y', 'y', 'y', '本企业', 'y'],
     ['提升建议 / 改派', 'y', 'y', '提升', 'n', 'n'],
     ['签核入库', 'y', 'y', 'n', 'n', 'y'],
     ['用户与口径管理', 'y', 'n', 'n', 'n', 'n'],
     ['触发 Harness', 'y', 'y', 'n', 'n', 'y'],
     ['成绩写回', 'n', 'n', 'n', 'n', 'n']].map(r =>
      '<tr><td>' + r[0] + '</td>' + r.slice(1).map(v => v === 'y' ? '<td class="y">允许</td>' : v === 'n' ? '<td class="n">拒绝</td>' : '<td class="p">' + v + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';

  if (state.user.role !== 'admin') {
    $('view').innerHTML =
      '<div class="card"><h3>权限矩阵（§5.4）</h3><div class="sub">你当前是「' + esc(state.user.roleName) + '」，无法访问用户管理接口（GET /api/admin/users → 403 并留痕）</div>' +
      '<div class="note" style="margin-bottom:12px">这是一次真实的越权尝试：点下面的按钮可以看到返回码与审计记录。</div>' +
      '<button class="btn ghost small" onclick="testDenied()">尝试访问用户管理接口</button>' +
      '<div style="margin-top:14px">' + matrix + '</div></div>';
    return;
  }

  const d = req('GET', '/api/admin/users').data;
  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">账号与组织</h3><div class="spacer"></div><span class="chip b">SaaS 管理员视图</span></div>' +
    '<div class="sub">账号创建、角色分配与所属企业绑定；所有写操作进审计</div>' +
    '<table><thead><tr><th>账号</th><th>显示名</th><th>角色</th><th>所属企业</th></tr></thead><tbody>' +
    d.users.map(u => '<tr><td class="mono">' + esc(u.username) + '</td><td>' + esc(u.display) + '</td><td>' + esc(u.roleName) + '</td><td>' + (u.orgId ? esc(ename(u.orgId)) : '—') + '</td></tr>').join('') +
    '</tbody></table>' +
    '<div class="note" style="margin-top:12px"><div class="row" style="gap:8px">' +
    '<input class="f" id="nuName" placeholder="账号" style="max-width:130px" />' +
    '<input class="f" id="nuPwd" placeholder="初始密码" style="max-width:130px" />' +
    '<input class="f" id="nuDisplay" placeholder="显示名" style="max-width:170px" />' +
    '<select class="f" id="nuRole" style="max-width:150px"><option value="jiaowu">教务管理员</option><option value="teacher">实习指导教师</option><option value="mentor">企业实习导师</option><option value="audit">风险合规</option></select>' +
    '<select class="f" id="nuOrg" style="max-width:140px"><option value="">—（全校）</option>' + d.enterprises.map(e => '<option value="' + e.id + '">' + esc(e.name) + '</option>').join('') + '</select>' +
    '<button class="btn small" onclick="addUser()">新增账号</button></div></div></div>' +

    '<div class="card"><h3>权限矩阵（§5.4）</h3><div class="sub">跨企业个体评价一律不可见；成绩字段对所有角色都不存在</div>' + matrix + '</div>' +

    '<div class="card"><h3>越权演示</h3><div class="sub">两个被制度禁止的动作，看后端如何拒绝并留痕</div>' +
    '<div class="row"><button class="btn ghost small" onclick="testScore()">调用 POST /api/scores（成绩写回）</button>' +
    '<button class="btn ghost small" onclick="testDenied()">以企业导师身份访问管理端</button></div>' +
    '<div id="adOut" class="note" style="margin-top:10px">点上面按钮查看返回结果。</div></div>';
}
function addUser() {
  const body = { username: $('nuName').value.trim(), password: $('nuPwd').value, display: $('nuDisplay').value.trim(), role: $('nuRole').value, orgId: $('nuOrg').value || null };
  if (!body.username || !body.password || !body.display) { toast('账号、密码、显示名都要填', 'err'); return; }
  const r = req('POST', '/api/admin/users', body);
  if (r.code === 200) { toast('已新增账号并留痕', 'ok'); renderAd(); } else toast(r.data.detail, 'err');
}
function testScore() {
  const r = req('POST', '/api/scores', { sid: '202301010001', score: 95 });
  $('adOut').innerHTML = '<b>返回 ' + r.code + '</b> · ' + esc(r.data.detail) + '<br/><span style="color:var(--mute)">已写入审计，前往「审计」页可见 score.write.attempt / DENIED</span>';
  toast('成绩写回被拒绝（' + r.code + '）', 'err');
}
function testDenied() {
  const login = api('POST', '/api/login', { username: 'yesh', password: 'ye123' });
  const r = api('GET', '/api/admin/users', {}, login.data.token);
  const out = $('adOut') || null;
  const msg = '<b>企业导师访问 /api/admin/users → ' + r.code + '</b> · ' + esc(r.data.detail) + '<br/><span style="color:var(--mute)">越权已留痕（perm.deny / DENIED）</span>';
  if (out) out.innerHTML = msg; else toast('403：企业导师无权访问管理端', 'err');
  if (out) toast('越权被拒绝并留痕', 'err');
}

/* ---------------- 审计 ---------------- */
function renderAu() {
  const rows = req('GET', '/api/audit').data;
  const color = r => r.result === 'DENIED' || r.result === 'REJECTED' ? 'bad' : r.result === 'HELD' || r.result === 'DRAFT' ? 'warn' : 'ok';
  $('view').innerHTML =
    '<div class="card"><div class="row"><h3 style="margin:0">审计日志</h3><div class="spacer"></div>' +
    '<span class="chip">' + rows.length + ' 条</span><span class="chip g">只追加</span></div>' +
    '<div class="sub">' + (can(['admin', 'audit']) ? '全量视图' : '仅本人操作视图') + ' · 无 UPDATE / DELETE 路由（DELETE /api/audit/1 → 404）</div>' +
    '<div class="scroll" style="max-height:520px"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>详情</th><th>结果</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td class="mono">' + fmtT(r.ts) + '</td><td>' + esc(r.actor) + '</td><td class="mono">' + esc(r.action) + '</td>' +
      '<td class="mono">' + esc(r.target) + '</td><td style="color:#42566e;max-width:380px">' + esc(r.detail) + '</td>' +
      '<td><span class="st ' + color(r) + '">' + esc(r.result) + '</span></td></tr>').join('') +
    '</tbody></table></div></div>';
}
