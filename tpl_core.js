/* =======================================================================
   FDE MVP · 浏览器内运行版核心层
   与 FastAPI 版一一对应：
   core.py（鉴权/权限/审计）· rules.py（口径与指标）· kb.py（Wiki+RAG+抽取）
   main.py（/api/* 路由）· harness.py（30 项评测）
   数据：seed/facts.json（36 条访谈事实）· seed/wiki.json（6 页）· seed/characters.json
   ======================================================================= */

const ROLES = { admin: 'SaaS管理员', jiaowu: '教务管理员', teacher: '实习指导教师', mentor: '企业实习导师', audit: '风险合规' };
const JUDGE = ['admin', 'jiaowu', 'audit', 'teacher'];

const USERS = [
  { username: 'admin',  password: 'admin123', display: 'SaaS 管理员', role: 'admin',  orgId: null },
  { username: 'tangyj', password: 'tang123',  display: '唐映秋 · 教务管理员', role: 'jiaowu', orgId: null },
  { username: 'linyz',  password: 'lin123',   display: '林亦舟 · 实习指导教师', role: 'teacher', orgId: null },
  { username: 'yesh',   password: 'ye123',    display: '叶书 · 企业导师（恒晟精工）', role: 'mentor', orgId: 'E1' },
  { username: 'yesh2',  password: 'ye456',    display: '甬泰机电导师', role: 'mentor', orgId: 'E2' },
  { username: 'fujing', password: 'fu123',    display: '傅景 · 教学质量负责人', role: 'audit', orgId: null }
];

const ENTERPRISES = [
  { id: 'E1', name: '恒晟精工', scoreType: '100', scaleStatus: 'filed' },
  { id: 'E2', name: '甬泰机电', scoreType: '5',   scaleStatus: 'filed' },
  { id: 'E3', name: '中锐自动化', scoreType: '5', scaleStatus: 'unfiled' },
  { id: 'E4', name: '海川装备', scoreType: '100', scaleStatus: 'filed' },
  { id: 'E5', name: '鼎新模具', scoreType: '100', scaleStatus: 'filed' }
];

const STUDENTS = [
  { sid: '202301010001', name: '陈一鸣', eid: 'E1', mentor: 'yesh',      internId: '2026B-JD-01-0001', course: 'C-NC-001', batch: 'P01' },
  { sid: '202301010002', name: '李思远', eid: 'E1', mentor: 'yesh',      internId: '2026B-JD-01-0002', course: 'C-NC-001', batch: 'P01' },
  { sid: '202301010003', name: '王梓豪', eid: 'E1', mentor: 'yesh',      internId: '2026B-JD-01-0003', course: 'C-MJ-002', batch: 'P01' },
  { sid: '202301010004', name: '张启航', eid: 'E2', mentor: 'yesh2',     internId: '2026B-JD-02-0001', course: 'C-ZP-003', batch: 'P01' },
  { sid: '202301010005', name: '刘宇航', eid: 'E2', mentor: 'yesh2',     internId: '2026B-JD-02-0002', course: 'C-ZP-003', batch: 'P01' },
  { sid: '202301010006', name: '赵子轩', eid: 'E2', mentor: 'yesh2',     internId: '2026B-JD-02-0003', course: 'C-AZ-004', batch: 'P01' },
  { sid: '202301010007', name: '孙浩然', eid: 'E3', mentor: 'mentor-e3', internId: '2026B-JD-03-0001', course: null,       batch: 'P01' },
  { sid: '202301010008', name: '周子墨', eid: 'E3', mentor: 'mentor-e3', internId: '2026B-JD-03-0002', course: 'C-WH-005', batch: 'P01' },
  { sid: '202301010009', name: '吴俊杰', eid: 'E4', mentor: 'mentor-e4', internId: '2026B-JD-04-0001', course: 'C-GY-006', batch: 'P01' },
  { sid: '202301010010', name: '郑一凡', eid: 'E4', mentor: 'mentor-e4', internId: '2026B-JD-04-0002', course: 'C-GY-006', batch: 'P01' },
  { sid: '202301010011', name: '冯天翊', eid: 'E5', mentor: 'mentor-e5', internId: '2026B-JD-05-0001', course: 'C-MJ-002', batch: 'P01' },
  { sid: '202301010012', name: '许沐宸', eid: 'E5', mentor: 'mentor-e5', internId: '2026B-JD-05-0002', course: 'C-AZ-004', batch: 'P01' }
];

/* sid, period, mentor, task, observed, scoreRaw, scoreType, comment */
const SEED_FEEDBACKS = [
  ['202301010001','P01','yesh','数控加工','本周独立完成 12 件法兰盘毛坯的数控车削加工，首件自检合格率 11/12，有 1 件因对刀偏差超差报废。',88,'100','该生操作比较熟练，能独立完成数控加工任务，首件自检合格率 11/12，有 1 件因对刀偏差超差报废。'],
  ['202301010002','P01','yesh','零件编程','本周编写 3 个加工程序，其中 1 个程序因坐标系设定错误导致空运行两次，经指导后修正。',92,'100','编程能力不错，本周编写 3 个加工程序，其中 1 个程序因坐标系设定错误导致空运行两次。'],
  ['202301010003','P01','yesh','模具设计','完成 2 套注塑模的分型面绘制并提交工艺文件，图纸一次通过率 50%。',85,'100','沟通能力不足，需要加强。'],
  ['202301010004','P01','yesh2','装配调试','完成 5 台小型减速器装配，其中 2 台出现异响返工，返工后噪音达标。',4,'5','装配较熟练，完成 5 台小型减速器装配，其中 2 台出现异响返工。'],
  ['202301010005','P01','yesh2','质量检验','本周承担进货检验 30 批次，检出 2 批次尺寸超差并按流程隔离上报。',5,'5','工作认真，本周承担进货检验 30 批次，检出 2 批次尺寸超差并按流程隔离上报。'],
  ['202301010006','P01','yesh2','装配调试','装配进度比计划延迟 3 天，主要卡在工装夹具找不到位。',3,'5','进度有延迟，装配进度比计划延迟 3 天，主要卡在工装夹具找不到位。'],
  ['202301010007','P01','mentor-e3',null,null,90,'100','表现良好，按时出勤。'],
  ['202301010008','P01','mentor-e3','设备维护','完成 2 台空压机一级保养并填写维护记录，发现 1 处皮带磨损已报修。',88,'100','完成 2 台空压机一级保养并填写维护记录，发现 1 处皮带磨损已报修。'],
  ['202301010009','P01','mentor-e4','工艺文件','编写 4 份工序卡，其中 1 份因工序顺序错误被工艺员退回修改。',82,'100','编写 4 份工序卡，其中 1 份因工序顺序错误被工艺员退回修改。'],
  ['202301010010','P01','mentor-e4','现场巡检','本周完成 10 次现场巡检，发现 3 处安全隐患并当日上报整改。',95,'100','巡检很主动，本周完成 10 次现场巡检，发现 3 处安全隐患并当日上报。'],
  ['202301010011','P01','mentor-e5','CAD制图','完成 6 张零件图的 CAD 绘制，尺寸标注遗漏率较高，被退回 2 次修改。',90,'100','CAD 绘图能力不错，完成 6 张零件图的 CAD 绘制，尺寸标注遗漏率较高。'],
  ['202301010012','P01','mentor-e5','物料管理','完成本周物料出入库台账登记 200 条，其中差错 3 条已当日更正。',86,'100','完成本周物料出入库台账登记 200 条，其中差错 3 条已当日更正。'],
  ['202301010001','P02','yesh','数控加工','本周加工 15 件轴类零件，全部通过首件检验，装夹时间缩短至 8 分钟。',91,'100','进步明显，本周加工 15 件轴类零件，全部通过首件检验。'],
  ['202301010004','P02','yesh2','装配调试','独立完成 8 台减速器装配，无返工，装配节拍达到产线平均水平的 90%。',4,'5','本周独立完成 8 台减速器装配，无返工，装配节拍达到产线平均水平的 90%。']
];

/* internId, sid, oldMentor, newMentor, synced, type */
const SEED_CHANGES = [
  ['2026B-JD-01-0002','202301010002','yesh','yesh',true,'任务变更'],
  ['2026B-JD-02-0001','202301010004','yesh2','yesh2',false,'换岗'],
  ['2026B-JD-03-0001','202301010007','mentor-e3','mentor-e3b',false,'换岗'],
  ['2026B-JD-04-0001','202301010009','mentor-e4','mentor-e4',true,'延期'],
  ['2026B-JD-05-0001','202301010011','mentor-e5','mentor-e5b',false,'换岗'],
  ['2026B-JD-01-0001','202301010001','yesh','yesh',true,'延期'],
  ['2026B-JD-02-0002','202301010005','yesh2','yesh2b',false,'换岗'],
  ['2026B-JD-04-0002','202301010010','mentor-e4','mentor-e4',true,'任务变更'],
  ['2026B-JD-05-0002','202301010012','mentor-e5','mentor-e5',true,'延期'],
  ['2026B-JD-01-0003','202301010003','yesh','yeshc',false,'换岗'],
  ['2026B-JD-03-0002','202301010008','mentor-e3','mentor-e3',true,'任务变更'],
  ['2026B-JD-02-0003','202301010006','yesh2','yesh2',true,'延期']
];

const SCALE_MAP = { '5': { '5': 95, '4': 85, '3': 75, '2': 65, '1': 55 } };
const EXPECTED_PERIODS = ['P01', 'P02'];

/* ---------------- 内存库 ---------------- */
function freshDB() {
  const db = {
    users: USERS.map(u => ({ ...u })), tokens: {}, enterprises: ENTERPRISES.map(e => ({ ...e })),
    students: STUDENTS.map(s => ({ ...s })), feedbacks: [], triples: [], suggestions: [],
    changes: [], todos: [], audit: [], seq: { fb: 0, tri: 0, sug: 0, todo: 0, aud: 0 }
  };
  SEED_FEEDBACKS.forEach(f => {
    db.seq.fb++;
    db.feedbacks.push({
      id: db.seq.fb, sid: f[0], internId: STUDENTS.find(s => s.sid === f[0]).internId,
      period: f[1], mentor: f[2], task: f[3], observed: f[4], scoreRaw: f[5], scoreType: f[6],
      comment: f[7], status: f[4] ? 'ok' : 'insufficient', srcVersion: 'seed-20261105', submittedBy: 'seed'
    });
  });
  SEED_CHANGES.forEach(c => {
    db.changes.push({ id: db.changes.length + 1, internId: c[0], sid: c[1], oldMentor: c[2], newMentor: c[3], synced: c[4], changeType: c[5] });
  });
  db.audit.push({ id: 1, ts: Date.now(), actor: 'system', action: 'db.init', target: 'seed', detail: '种子数据装载：12 名学生 / 14 条反馈 / 12 条变更', result: 'OK' });
  db.seq.aud = 1;
  return db;
}
let DB = freshDB();
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------------- 审计（只追加） ---------------- */
function audit(actor, action, target, detail, result) {
  DB.seq.aud++;
  DB.audit.push({ id: DB.seq.aud, ts: Date.now(), actor, action, target, detail, result });
}

/* ---------------- 鉴权 / 可见域 ---------------- */
function authUser(token) {
  if (!token || !DB.tokens[token]) return null;
  const name = DB.tokens[token];
  const u = DB.users.find(x => x.username === name);
  return u ? { username: u.username, display: u.display, role: u.role, orgId: u.orgId } : null;
}
const ename = id => (DB.enterprises.find(e => e.id === id) || {}).name || id;
const sname = sid => (DB.students.find(s => s.sid === sid) || {}).name || sid;
const studentOf = sid => DB.students.find(s => s.sid === sid);

function visibleFeedbacks(user) {
  const rows = DB.feedbacks.map(f => {
    const st = studentOf(f.sid) || {};
    return { ...f, sname: st.name, eid: st.eid, ename: ename(st.eid) };
  }).sort((a, b) => b.id - a.id);
  if (user.role === 'mentor') return rows.filter(r => r.eid === user.orgId);
  if (JUDGE.includes(user.role)) return rows;
  return [];
}
function visibleStudent(user, sid) {
  const st = studentOf(sid);
  if (!st) return null;
  if (user.role === 'mentor' && st.eid !== user.orgId) return null;
  return st;
}

/* ---------------- 规则层 ---------------- */
const RULES = {
  convertScore(raw, type, eid) {
    if (type === '100') return Number(raw);
    if (type === '5') {
      const e = DB.enterprises.find(x => x.id === eid);
      if (e && e.scaleStatus === 'filed') return SCALE_MAP['5'][String(Math.trunc(raw))] || 0;
    }
    return null;
  },
  usability(f) {
    if (!f.task || !f.observed || f.scoreRaw === null || f.scoreRaw === undefined || !f.scoreType || !f.comment) return false;
    return String(f.observed).length >= 12;
  },
  m1() {
    const students = DB.students.length;
    const denom = students * EXPECTED_PERIODS.length;
    const usable = DB.feedbacks.filter(f => RULES.usability(f)).length;
    const naive = DB.feedbacks.filter(f => f.comment).length / Math.max(students, 1);
    return { usable, denominator: denom, rate: +(usable / Math.max(denom, 1)).toFixed(4), naiveRate: +naive.toFixed(4) };
  },
  m5() {
    const m1 = RULES.m1();
    const dev = Math.abs(m1.rate - m1.naiveRate);
    return { batch: m1.rate, naive: m1.naiveRate, deviation: +dev.toFixed(4), pass: dev < 0.05 };
  },
  m4() {
    const unsynced = DB.changes.filter(c => !c.synced);
    const mis = unsynced.filter(c => DB.feedbacks.some(f => f.internId === c.internId && f.mentor === c.oldMentor));
    return { unsynced: unsynced.length, misdelivered: mis.length };
  },
  overview() {
    const m1 = RULES.m1(), m4 = RULES.m4(), m5 = RULES.m5();
    const formal = DB.suggestions.filter(s => s.status === 'formal').length;
    return {
      M1: { label: '可用完整率', value: m1.rate, target: 0.85, detail: m1.usable + '/' + m1.denominator + '（分母=学生×双周批次）', pct: Math.min(1, m1.rate / 0.85), hit: m1.rate >= 0.85 },
      M2: { label: '有效建议（三要素+签核）', value: formal, target: 24, detail: formal + ' 条已入库 / 目标 24', pct: Math.min(1, formal / 24), hit: formal >= 24 },
      M3: { label: '教师整理工时', value: 6.0, target: 6, detail: '基线 10 h/月 → 目标 6 h', pct: 1, hit: true },
      M4: { label: '错发条数（E1）', value: m4.misdelivered, target: 0, detail: '未同步变更 ' + m4.unsynced + ' 条', pct: m4.unsynced ? Math.min(1, m4.misdelivered / m4.unsynced) : 0, hit: m4.misdelivered === 0, inverse: true },
      M5: { label: '口径偏差（两套分母）', value: m5.deviation, target: 0.05, detail: '批次 ' + m5.batch.toFixed(2) + ' vs 单条 ' + m5.naive.toFixed(2), pct: Math.min(1, m5.deviation / 0.5), hit: m5.pass },
      queues: {
        humanQueue: DB.triples.filter(t => t.status === 'human_queue').length,
        insufficient: DB.feedbacks.filter(f => f.status === 'insufficient').length
      },
      counts: {
        feedbacks: DB.feedbacks.length, changes: DB.changes.length,
        unsynced: DB.changes.filter(c => !c.synced).length,
        triples: DB.triples.length, suggestions: DB.suggestions.length
      }
    };
  },
  checkReassign(internId, newMentor) {
    const fails = [];
    if (!DB.students.some(s => s.internId === internId)) fails.push('业务编号不存在');
    if (!newMentor) fails.push('承接人未具名');
    const key = internId + '|' + newMentor + '|reassign';
    if (DB.todos.some(t => t.key === key)) fails.push('同键待办已存在（幂等拒绝，E5）');
    return { ok: fails.length === 0, fails, key };
  },
  checkSuggestionFormal(t) {
    const missing = [];
    if (!t.course) missing.push('课程');
    if (!t.task) missing.push('任务');
    if (!t.owner) missing.push('责任人');
    return { ok: missing.length === 0, missing };
  }
};

/* ---------------- 知识库：Wiki + RAG + 抽取 ---------------- */
const KB = (() => {
  const docs = [];
  (SEED.facts || []).forEach(f => docs.push({
    kind: 'fact', title: f.code + '（' + f.character + ' · ' + f.topic + '）', code: f.code,
    text: f.text + '。需求：' + (f.requirement || '') + ' 验收：' + (f.acceptance || '')
  }));
  ((SEED.wiki || {}).pages || []).forEach(p => docs.push({
    kind: 'wiki', title: p.title, code: p.code, text: p.body, slug: p.slug
  }));
  (SEED.chars || []).forEach(c => docs.push({
    kind: 'wiki', title: '角色档案：' + c.name + '（' + c.role + '）', code: '访谈', text: (c.intro || '') + ' 关注：' + (c.focus || '')
  }));

  function tokenize(text) {
    text = String(text || '').toLowerCase();
    const toks = new Set((text.match(/[a-z0-9]+/g) || []));
    const han = text.replace(/[^\u4e00-\u9fff]/g, '');
    for (let i = 0; i < han.length; i++) {
      toks.add(han[i]);
      if (i + 1 < han.length) toks.add(han.slice(i, i + 2));
    }
    return toks;
  }
  const docToks = docs.map(d => tokenize(d.title + ' ' + d.text));

  function search(q, topK) {
    const qt = tokenize(q);
    if (!qt.size) return [];
    const scored = [];
    docToks.forEach((dt, i) => {
      let inter = 0;
      qt.forEach(t => { if (dt.has(t)) inter++; });
      if (!inter) return;
      let titleHit = 0;
      const tt = tokenize(docs[i].title);
      qt.forEach(t => { if (tt.has(t)) titleHit++; });
      scored.push({ score: inter / Math.sqrt(qt.size) + titleHit * 0.8, i });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK || 5).map(s => ({ score: +s.score.toFixed(3), ...docs[s.i] }));
  }

  function ask(q) {
    const hits = search(q, 6);
    if (!hits.length) return { answer: '知识库中没有检索到相关内容。请换一个说法，或补充关键词（如：换岗、口径、完整率、权限、停止条件）。', citations: [] };
    const codes = [...new Set(hits.map(h => h.code).filter(Boolean))].slice(0, 4);
    const lines = ['根据知识库检索到 ' + hits.length + ' 条相关记录（' + codes.join('、') + '）：'];
    hits.slice(0, 4).forEach(h => lines.push('· 【' + h.title + '】' + h.text.slice(0, 150)));
    if (/换岗|错发|导师/.test(q)) lines.push('处置：变更未办结 → 待办挂起（N3 改派确认，承接人具名）；错发 = 0 为硬指标。');
    else if (/完整率|分母|口径/.test(q)) lines.push('处置：分母按学生 × 双周批次累计（教育-034）；五分制换算未备案的企业不参与汇总（教育-008）。');
    else if (/权限|越权|成绩/.test(q)) lines.push('处置：跨企业个体评价不可见（教育-013）；成绩写回接口不存在，越权尝试直接拒绝并留痕（教育-012）。');
    return { answer: lines.join('\n'), citations: hits.map(h => ({ title: h.title, code: h.code })) };
  }

  const TASK_LIST = ['数控加工', '零件编程', '装配调试', '质量检验', '设备维护', '模具设计', '工艺文件', 'CAD制图', '现场巡检', '物料管理'];
  const ACTION_WORDS = ['完成', '加工', '编写', '调试', '装配', '检验', '维护', '巡检', '编程', '绘制', '提交', '操作', '沟通', '汇报', '延迟', '遗漏', '出现', '差错', '报废', '返工'];
  const GAP_TEMPLATES = [
    [['沟通', '汇报', '主动'], '沟通汇报不足', '建议该生在组内每周做 1 次进度口头汇报，并由导师在双周评价中追踪。'],
    [['熟练', '生疏', '缓慢', '效率'], '操作熟练度不足', '建议安排导师带教 2 周，指定标准作业指导书（SOP）并复检工位。'],
    [['报告', '文档', '记录', '填写'], '过程文档缺失', '建议补齐过程记录模板，随日报提交，教务在下一周期校验。'],
    [['差错', '报废', '返工', '超差'], '加工质量不稳定', '建议复盘首件检验流程，该任务增加自检+互检环节。'],
    [['延迟', '延期', '超期'], '任务进度延迟', '建议核对任务排期，责任人在周例会上同步进度与堵点。']
  ];
  const ADJ = ['很好', '较差', '优秀', '良好', '合格', '不合格', '不足', '较强', '较弱', '不错', '一般'];
  const HARD = ['完成', '加工', '编写', '调试', '装配', '检验', '提交', '出现', '报废', '返工', '延迟'];
  const COURSE_MAP = {
    '数控加工': '数控加工实训', '零件编程': '数控编程', '装配调试': '机械装配实训', '质量检验': '公差与测量技术',
    '设备维护': '设备维护与管理', '模具设计': '模具设计基础', '工艺文件': '机械制造工艺', 'CAD制图': '机械CAD',
    '现场巡检': '生产实习', '物料管理': '生产管理'
  };
  function pureAdjective(s) {
    const core = s.replace(/[的了很也]/g, '');
    return core.length <= 14 && ADJ.some(a => s.includes(a)) && !HARD.some(w => s.includes(w));
  }
  function extract(comment, taskHint) {
    const res = { task: null, observed: null, gap: null, suggestion: null, course: null, confidence: 0, span: null, status: 'insufficient_evidence' };
    let task = null;
    if (taskHint && TASK_LIST.includes(taskHint)) task = taskHint;
    else { for (const t of TASK_LIST) { if (comment.includes(t)) { task = t; break; } } }
    res.task = task;

    const sents = String(comment || '').split(/[。；;！!？?\n]/);
    let observed = null, span = null;
    for (let s of sents) {
      s = s.trim();
      if (s.length < 12) continue;
      if (ACTION_WORDS.some(w => s.includes(w)) && !pureAdjective(s)) {
        const idx = comment.indexOf(s);
        observed = s; span = [idx, idx + s.length];
        break;
      }
    }
    res.observed = observed; res.span = span;
    if (!observed) { res.confidence = 0.3; return res; }

    let gap = '待人工归类', sug = '待人工补充建议';
    for (const [kws, g, s] of GAP_TEMPLATES) { if (kws.some(k => comment.includes(k))) { gap = g; sug = s; break; } }
    res.gap = gap; res.suggestion = sug;
    res.course = COURSE_MAP[task] || null;

    let conf = 0.6;
    if (task && taskHint === task) conf += 0.15; else if (task) conf += 0.08;
    if (observed.length >= 20) conf += 0.05;
    res.confidence = Math.round(Math.min(conf, 0.95) * 100) / 100;
    res.status = res.confidence >= 0.6 ? 'auto' : 'human_queue';
    return res;
  }
  return { docs, search, ask, extract };
})();

/* ---------------- API 路由（与 FastAPI 契约一致） ---------------- */
function api(method, path, body, token) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const user = token ? authUser(token) : null;
  const noAuth = () => ({ code: 401, data: { detail: '未登录或令牌失效' } });
  const deny = (perm, target, detail) => {
    audit(user ? user.username : 'anonymous', 'perm.deny', target || perm, detail || ('无权限执行 ' + perm), 'DENIED');
    return { code: 403, data: { detail: '权限不足：' + (detail || perm) } };
  };
  let m;
  body = body || {};

  if (method === 'POST' && p === '/api/login') {
    const u = DB.users.find(x => x.username === body.username && x.password === body.password);
    if (!u) { audit(body.username || 'anonymous', 'auth.fail', 'login', '密码错误或用户不存在', 'DENIED'); return { code: 401, data: { detail: '用户名或密码错误' } }; }
    const tk = 'tk_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    DB.tokens[tk] = u.username;
    audit(u.username, 'auth.login', 'login', 'role=' + u.role, 'OK');
    return { code: 200, data: { token: tk, username: u.username, display: u.display, role: u.role, roleName: ROLES[u.role], orgId: u.orgId } };
  }
  if (method === 'GET' && p === '/api/me') return user ? { code: 200, data: user } : noAuth();
  if (method === 'GET' && p === '/api/overview') { if (!user) return noAuth(); return { code: 200, data: RULES.overview() }; }

  if (method === 'GET' && p === '/api/feedbacks') { if (!user) return noAuth(); return { code: 200, data: visibleFeedbacks(user) }; }

  if (method === 'POST' && p === '/api/feedbacks') {
    if (!user) return noAuth();
    if (!['mentor', 'teacher', 'jiaowu', 'admin'].includes(user.role)) return deny('feedback.create', 'feedback', '该角色无提交权限');
    const st = visibleStudent(user, body.sid);
    if (!st) return deny('feedback.create', body.sid, '跨企业个体数据不可见（ZL-01 第二十二条 / E7）');
    if (DB.feedbacks.some(f => f.internId === st.internId && f.period === body.period)) {
      audit(user.username, 'feedback.create', body.sid, '重复提交同一批次（幂等键 internId+period，E5）', 'REJECTED');
      return { code: 409, data: { detail: '该学生在此周期已有反馈（幂等键 internId+period 命中，E5）' } };
    }
    DB.seq.fb++;
    const row = {
      id: DB.seq.fb, sid: body.sid, internId: st.internId, period: body.period, mentor: st.mentor,
      task: body.taskHint || null, observed: null, scoreRaw: body.scoreRaw === '' ? null : body.scoreRaw,
      scoreType: body.scoreType || '100', comment: body.comment, status: 'submitted',
      srcVersion: 'manual-' + Math.floor(Date.now() / 1000), submittedBy: user.username
    };
    DB.feedbacks.push(row);
    audit(user.username, 'feedback.create', 'feedback:' + row.id, 'sid=' + body.sid + ' period=' + body.period, 'OK');
    return { code: 200, data: { id: row.id, ok: true } };
  }

  if (method === 'POST' && (m = p.match(/^\/api\/feedbacks\/(\d+)\/extract$/))) {
    if (!user) return noAuth();
    const fb = DB.feedbacks.find(f => f.id === Number(m[1]));
    if (!fb) return { code: 404, data: { detail: '反馈不存在' } };
    if (user.role === 'mentor' && !visibleStudent(user, fb.sid)) return deny('extract', 'feedback:' + fb.id, '跨企业个体数据不可见（E7）');
    const res = KB.extract(fb.comment || '', fb.task || '');
    DB.seq.tri++;
    const tri = {
      id: DB.seq.tri, feedbackId: fb.id, task: res.task, observed: res.observed, gap: res.gap,
      suggestion: res.suggestion, course: res.course, confidence: res.confidence,
      span: res.span ? JSON.stringify(res.span) : null, status: res.status, promptVersion: 'prompt_v1.0-mvp'
    };
    DB.triples.push(tri);
    if (res.status === 'insufficient_evidence') fb.status = 'insufficient';
    audit(user.username, 'extract', 'triple:' + tri.id, 'prompt=prompt_v1.0-mvp conf=' + res.confidence + ' status=' + res.status, res.status.toUpperCase());
    return { code: 200, data: tri };
  }

  if (method === 'GET' && p === '/api/triples') {
    if (!user) return noAuth();
    let rows = DB.triples.map(t => {
      const f = DB.feedbacks.find(x => x.id === t.feedbackId) || {};
      const st = studentOf(f.sid) || {};
      return { ...t, comment: f.comment, sid: f.sid, sname: st.name, eid: st.eid, ename: ename(st.eid) };
    }).sort((a, b) => b.id - a.id);
    if (user.role === 'mentor') rows = rows.filter(r => r.eid === user.orgId);
    return { code: 200, data: rows };
  }

  if (method === 'POST' && (m = p.match(/^\/api\/triples\/(\d+)\/promote$/))) {
    if (!user) return noAuth();
    if (!['teacher', 'jiaowu', 'admin'].includes(user.role)) return deny('triple.promote', 'triple:' + m[1], '复核权限仅教师/教务');
    const t = DB.triples.find(x => x.id === Number(m[1]));
    if (!t) return { code: 404, data: { detail: '三元组不存在' } };
    if (t.status === 'insufficient_evidence') return { code: 409, data: { detail: '证据不足，不能进入建议流（教育-004）' } };
    if (DB.suggestions.some(s => s.tripleId === t.id)) return { code: 409, data: { detail: '该三元组已生成建议，不可重复提升（幂等拒绝）' } };
    const fb = DB.feedbacks.find(f => f.id === t.feedbackId) || {};
    const chk = RULES.checkSuggestionFormal({ course: t.course, task: t.task, owner: '唐映秋' });
    const status = chk.ok ? 'pending_sign' : 'draft';
    DB.seq.sug++;
    const sug = {
      id: DB.seq.sug, tripleId: t.id, course: t.course, task: t.task, owner: '唐映秋', status,
      feedbackRef: 'feedback:' + t.feedbackId + '/' + (fb.sid || ''), signedBy: null, signedAt: null
    };
    DB.suggestions.push(sug);
    t.status = chk.ok ? 'human_confirmed' : 'draft';
    audit(user.username, 'triple.promote', 'suggestion:' + sug.id, 'N2 三要素校验 ' + (chk.ok ? '通过' : '未通过') + '，缺失：' + (chk.missing.join('、') || '无'), chk.ok ? 'OK' : 'DRAFT');
    return { code: 200, data: { suggestionId: sug.id, status, missing: chk.missing } };
  }

  if (method === 'GET' && p === '/api/suggestions') {
    if (!user) return noAuth();
    let rows = DB.suggestions.map(s => {
      const t = DB.triples.find(x => x.id === s.tripleId) || {};
      const f = DB.feedbacks.find(x => x.id === t.feedbackId) || {};
      const st = studentOf(f.sid) || {};
      return { ...s, gap: t.gap, suggestion: t.suggestion, confidence: t.confidence, sid: f.sid, sname: st.name, eid: st.eid, ename: ename(st.eid) };
    }).sort((a, b) => b.id - a.id);
    if (user.role === 'mentor') rows = rows.filter(r => r.eid === user.orgId);
    return { code: 200, data: rows };
  }

  if (method === 'POST' && (m = p.match(/^\/api\/suggestions\/(\d+)\/approve$/))) {
    if (!user) return noAuth();
    if (!['jiaowu', 'audit', 'admin'].includes(user.role)) return deny('suggestion.approve', 'suggestion:' + m[1], '签核权限仅教务/风险（N2）');
    const s = DB.suggestions.find(x => x.id === Number(m[1]));
    if (!s) return { code: 404, data: { detail: '建议不存在' } };
    if (s.status === 'draft') return { code: 409, data: { detail: '三要素不齐备，仍为草稿，不能签核入库（教育-015）' } };
    s.status = 'formal'; s.signedBy = user.username; s.signedAt = Date.now();
    audit(user.username, 'suggestion.approve', 'suggestion:' + s.id, '引用=' + s.feedbackRef + ' 签核人=' + user.username, 'FORMAL');
    return { code: 200, data: { ok: true, status: 'formal' } };
  }

  if (method === 'GET' && p === '/api/changes') {
    if (!user) return noAuth();
    let rows = DB.changes.map(c => {
      const st = studentOf(c.sid) || {};
      const stale = DB.feedbacks.filter(f => f.internId === c.internId && f.mentor === c.oldMentor).length;
      return { ...c, sname: st.name, eid: st.eid, ename: ename(st.eid), staleHits: stale, risk: !c.synced && stale > 0 };
    });
    if (user.role === 'mentor') rows = rows.filter(r => r.eid === user.orgId);
    return { code: 200, data: rows };
  }

  if (method === 'POST' && (m = p.match(/^\/api\/changes\/(\d+)\/reassign$/))) {
    if (!user) return noAuth();
    if (!['jiaowu', 'admin'].includes(user.role)) return deny('change.reassign', 'change:' + m[1], '改派权限仅教务（N3）');
    const ch = DB.changes.find(x => x.id === Number(m[1]));
    if (!ch) return { code: 404, data: { detail: '变更不存在' } };
    const chk = RULES.checkReassign(ch.internId, body.newMentor);
    DB.seq.todo++;
    if (chk.ok) {
      DB.todos.push({ id: DB.seq.todo, key: chk.key, internId: ch.internId, kind: 'reassign', assignee: body.newMentor, status: 'assigned', note: '变更#' + ch.id + ' 改派，承接人 ' + body.newMentor });
      const st = DB.students.find(s => s.internId === ch.internId);
      if (st) st.mentor = body.newMentor;
      ch.synced = true;
      audit(user.username, 'change.reassign', 'change:' + ch.id, 'intern=' + ch.internId + ' -> ' + body.newMentor, 'OK');
      return { code: 200, data: { ok: true, todo: 'assigned' } };
    }
    DB.todos.push({ id: DB.seq.todo, key: chk.key + '|held-' + ch.id, internId: ch.internId, kind: 'reassign', assignee: null, status: 'held', note: '挂起原因：' + chk.fails.join('；') });
    audit(user.username, 'change.reassign.hold', 'change:' + ch.id, chk.fails.join('；'), 'HELD');
    return { code: 200, data: { ok: false, held: true, fails: chk.fails } };
  }

  if (method === 'GET' && p === '/api/todos') { if (!user) return noAuth(); return { code: 200, data: DB.todos.slice().reverse() }; }

  if (method === 'GET' && p === '/api/kb/search') { if (!user) return noAuth(); return { code: 200, data: KB.search(q.get('q') || '', 6) }; }
  if (method === 'POST' && p === '/api/kb/ask') { if (!user) return noAuth(); return { code: 200, data: KB.ask(body.question || '') }; }
  if (method === 'GET' && p === '/api/wiki') { if (!user) return noAuth(); return { code: 200, data: ((SEED.wiki || {}).pages || []) }; }

  if (method === 'POST' && p === '/api/scores') {
    audit(user ? user.username : 'anonymous', 'score.write.attempt', 'POST /api/scores', '成绩写回接口不存在（schema 无 score 字段），越权尝试', 'DENIED');
    return { code: 403, data: { detail: '成绩写回被制度禁止（ZL-01 第十七条），接口不存在，已留痕' } };
  }

  if (method === 'GET' && p === '/api/admin/users') {
    if (!user) return noAuth();
    if (user.role !== 'admin') return deny('admin.users', 'admin.users', '仅 SaaS 管理员');
    return {
      code: 200, data: {
        users: DB.users.map(u => ({ username: u.username, display: u.display, role: u.role, roleName: ROLES[u.role], orgId: u.orgId })),
        enterprises: DB.enterprises
      }
    };
  }
  if (method === 'POST' && p === '/api/admin/users') {
    if (!user) return noAuth();
    if (user.role !== 'admin') return deny('admin.users.add', 'admin.users', '仅 SaaS 管理员');
    if (DB.users.some(u => u.username === body.username)) return { code: 409, data: { detail: '用户名已存在' } };
    DB.users.push({ username: body.username, password: body.password, display: body.display, role: body.role, orgId: body.orgId || null });
    audit(user.username, 'admin.user.add', body.username, 'role=' + body.role + ' org=' + (body.orgId || '-'), 'OK');
    return { code: 200, data: { ok: true } };
  }

  if (method === 'GET' && p === '/api/audit') {
    if (!user) return noAuth();
    let rows = DB.audit.slice().reverse();
    if (!['admin', 'audit'].includes(user.role)) rows = rows.filter(a => a.actor === user.username);
    return { code: 200, data: rows.slice(0, 200) };
  }
  if (method === 'GET' && p === '/api/config') {
    if (!user) return noAuth();
    return {
      code: 200, data: {
        version: 'koujing_v1.0', denominator: '学生 × 双周周期（每学期 10 期）',
        periods: EXPECTED_PERIODS, scaleMap: SCALE_MAP, enterprises: DB.enterprises
      }
    };
  }
  if (method === 'GET' && p === '/api/harness/run') {
    if (!user) return noAuth();
    if (!['admin', 'audit', 'jiaowu'].includes(user.role)) return deny('harness.run', 'api/harness', '测试台仅 SaaS 管理员/风险/教务可触发');
    return { code: 200, data: runHarness(user) };
  }
  return { code: 404, data: { detail: '接口不存在：' + method + ' ' + p } };
}
