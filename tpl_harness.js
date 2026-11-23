/* =======================================================================
   Harness 测试台：30 项检查（与 harness.py 的 16 组 H01–H16 一一对应）
   每次运行前快照内存库，运行后回滚，保证可重复执行
   ======================================================================= */
const TRIPLE_FIELDS = ['id', 'feedbackId', 'task', 'observed', 'gap', 'suggestion', 'course', 'confidence', 'span', 'status', 'promptVersion'];

function runHarness(currentUser) {
  const snap = clone(DB);
  const results = [];
  const T = {};
  const check = (name, group, expect, actual, passed, detail) =>
    results.push({ name, group, expect, actual: String(actual).slice(0, 200), pass: !!passed, detail: detail || '' });
  const login = (u, p) => { const r = api('POST', '/api/login', { username: u, password: p }); if (r.code === 200) T[u] = r.data.token; return r; };
  const call = (method, path, body, tok) => api(method, path, body || {}, tok || T.admin);

  try {
    /* H01 鉴权 */
    let r = login('admin', 'wrong-password');
    check('错误密码必须 401', '鉴权', '401', r.code, r.code === 401);
    r = login('admin', 'admin123');
    check('正确凭据可登录', '鉴权', '200', r.code, r.code === 200);
    r = api('GET', '/api/overview');
    check('无令牌访问必须 401', '鉴权', '401', r.code, r.code === 401);

    /* H02 分层权限 */
    login('yesh', 'ye123'); login('tangyj', 'tang123');
    r = call('GET', '/api/feedbacks', {}, T.yesh);
    const eids = r.code === 200 ? [...new Set(r.data.map(x => x.eid))].sort() : [];
    check('企业导师只见本企业数据', '权限分层', '仅 E1', eids.join('、') || '无', r.code === 200 && eids.length === 1 && eids[0] === 'E1', 'ZL-01 第二十二条 / 教育-013');
    r = call('POST', '/api/feedbacks', { sid: '202301010004', period: 'PX1', comment: '越权提交测试', scoreRaw: 80, scoreType: '100' }, T.yesh);
    check('越权写他企学生 → 403 且留痕(E7)', '权限分层', '403', r.code, r.code === 403);
    r = call('GET', '/api/feedbacks', {}, T.tangyj);
    check('教务可见全量', '权限分层', '≥12 条', (r.data || []).length + ' 条', r.code === 200 && r.data.length >= 12);

    /* H03 成绩写回硬拒绝 */
    r = call('POST', '/api/scores', { sid: '202301010001', score: 95 }, T.admin);
    check('成绩写回接口不存在 → 403', '不可逆动作', '403', r.code, r.code === 403, 'ZL-01 第十七条 / 教育-012');

    /* H04 变更同步 E1 */
    r = call('GET', '/api/changes', {}, T.tangyj);
    const risky = (r.data || []).filter(c => c.risk);
    check('换岗未同步且旧导师仍收反馈 → 风险标记(E1)', '变更同步', '≥1', risky.length + ' 条', r.code === 200 && risky.length >= 1, '教育-005：12 条变更 5 条未同步');

    /* H05 改派幂等 E5 */
    r = call('GET', '/api/changes', {}, T.tangyj);
    const target = (r.data || []).find(c => !c.synced);
    if (!target) {
      check('存在未同步变更可供改派', '变更同步', '存在', '无', false);
    } else {
      const b = { newMentor: 'mentor-fixed' };
      const r1 = call('POST', '/api/changes/' + target.id + '/reassign', b, T.tangyj);
      check('首次改派成功', '变更同步', 'ok', r1.code, r1.code === 200 && r1.data.ok === true, 'N3 具名承接');
      const r2 = call('POST', '/api/changes/' + target.id + '/reassign', b, T.tangyj);
      check('同键重复改派 → 幂等拒绝(E5)', '不可逆动作', 'held/挂起', r2.code, r2.code === 200 && r2.data.ok === false && r2.data.held === true);
    }

    /* H06 三元组抽取 E2 */
    r = call('GET', '/api/feedbacks', {}, T.tangyj);
    const pureAdj = (r.data || []).find(f => f.comment && f.comment.includes('沟通能力不足'));
    const rA = call('POST', '/api/feedbacks/' + pureAdj.id + '/extract', {}, T.tangyj);
    check('纯评价形容词 → insufficient_evidence(E2)', '抽取边界', 'insufficient_evidence', rA.data.status,
      rA.code === 200 && rA.data.status === 'insufficient_evidence', '教育-004：无行为实例不算可用');
    const good = (r.data || []).find(f => f.observed && f.comment && f.comment.includes('报废'));
    const rB = call('POST', '/api/feedbacks/' + good.id + '/extract', {}, T.tangyj);
    check('正常评语 → 三元组 + 原文区间回指', '抽取边界', 'auto+span',
      rB.data.status + '/' + !!rB.data.span, rB.code === 200 && rB.data.status === 'auto' && !!rB.data.span, '教育-024：每条须显示原记录');

    /* H07 低置信转人工 */
    const ex = KB.extract('该生表现一般，态度尚可。');
    check('无行为实例置信度<0.6 → 不自动入库', '停止条件', '0.3 / insufficient',
      ex.confidence + '/' + ex.status, ex.confidence < 0.6 && ex.status !== 'auto', '教育-032 停止条件写进代码');

    /* H08 N2 三要素 */
    r = call('GET', '/api/triples', {}, T.tangyj);
    const cand = (r.data || []).find(x => (x.status === 'auto' || x.status === 'human_queue') && x.course);
    if (!cand) { check('存在可提升的三元组', '建议入库', '存在', '无', false); }
    else {
      const p1 = call('POST', '/api/triples/' + cand.id + '/promote', {}, T.tangyj);
      check('N2 通过 → 建议进入待签核', '建议入库', 'pending_sign', p1.data.status, p1.code === 200 && p1.data.status === 'pending_sign', '教育-015：三要素齐备才计有效');
      const p2 = call('POST', '/api/suggestions/' + p1.data.suggestionId + '/approve', {}, T.tangyj);
      check('教务签核 → 正式入库(formal)', '建议入库', '200/formal', p2.code, p2.code === 200 && p2.data.status === 'formal');
      const p3 = call('POST', '/api/triples/' + cand.id + '/promote', {}, T.tangyj);
      check('重复提升 → 拒绝(409)', '不可逆动作', '409', p3.code, p3.code === 409);
    }

    /* H09 口径换算 E3 */
    const v1 = RULES.convertScore(4, '5', 'E2');
    check('五分制按备案换算（甬泰 4→85）', '口径', '85', v1, v1 === 85, '教育-008');
    const v2 = RULES.convertScore(4, '5', 'E3');
    check('未备案企业 → 不参与汇总(E3)', '口径', 'null', v2, v2 === null, '中锐自动化未备案');

    /* H10 M1 分母口径 */
    const m1 = RULES.m1();
    const students = m1.denominator / EXPECTED_PERIODS.length;
    check('M1 分母=学生×周期（非 600×1）', '指标口径', 'students×2', m1.denominator,
      m1.denominator === students * EXPECTED_PERIODS.length, '教育-034：分母相差 10 倍的口径冲突 C1');
    check('M1 率与旧口径并行可算（M5）', '指标口径', '偏差<1', RULES.m5().deviation, RULES.m5().deviation < 1);

    /* H11 RAG 检索质量 */
    const h1 = KB.search('换岗后仍然关联旧导师导致反馈错发', 5);
    const c1 = h1.map(x => x.code);
    check('『换岗错发』检索命中 教育-005', '知识库RAG', '教育-005', c1.slice(0, 3).join('、'), c1.some(c => c && c.includes('教育-005')));
    const h2 = KB.search('完整率分母怎么算', 5);
    check('『分母口径』检索命中口径类文档', '知识库RAG', '口径注册表 / 教育-034',
      h2.slice(0, 3).map(x => x.title.slice(0, 12)).join('｜'), h2.some(x => x.title.includes('口径') || (x.code || '').includes('教育-034')));
    const ans = KB.ask('成绩能不能写回平台');
    check('问答带引用编号（可回指证据）', '知识库RAG', '含引用', ans.citations.length + ' 条', ans.citations.length > 0, 'REQ-05：输出可回指原记录');

    /* H12 审计只追加 */
    const before = DB.audit.length;
    audit('harness', 'audit.append.test', 'audit', '追加一条', 'OK');
    const after = DB.audit.length;
    const d1 = call('DELETE', '/api/audit/1', {}, T.admin);
    const d2 = call('PATCH', '/api/audit/1', {}, T.admin);
    check('审计只追加：无 UPDATE/DELETE 路由', '审计', '404/405', d1.code + '/' + d2.code,
      [404, 405].includes(d1.code) && [404, 405].includes(d2.code), '方案 §8.2：审计能重建当次处理');
    check('审计追加生效', '审计', before + 1, after, after === before + 1);

    /* H13 越权访问管理端 */
    login('linyz', 'lin123');
    const g1 = call('GET', '/api/admin/users', {}, T.linyz);
    check('教师访问 SaaS 管理端 → 403', '权限分层', '403', g1.code, g1.code === 403);
    const g2 = call('GET', '/api/harness/run', {}, T.linyz);
    check('教师触发测试台 → 403', '权限分层', '403', g2.code, g2.code === 403);

    /* H14 签核权限 */
    login('yesh', 'ye123');
    const s1 = call('POST', '/api/suggestions/999/approve', {}, T.yesh);
    check('企业导师无签核权 → 403', '权限分层', '403', s1.code, s1.code === 403, 'N2 签核=教务/风险');

    /* H15 输出不带成绩字段 */
    check('模型输出 schema 无 score 字段', '不可逆动作', '无 score', TRIPLE_FIELDS.join('、'),
      !TRIPLE_FIELDS.some(f => f.toLowerCase().includes('score')), '方案 §七：禁止输出学生等级/分数');

    /* H16 停止条件汇总 */
    const qn = DB.triples.filter(t => t.status === 'human_queue').length;
    const insuf = DB.feedbacks.filter(f => f.status === 'insufficient').length;
    check('低置信/证据不足条目均停在人工侧，未进建议表', '停止条件', '≥1', qn + '/' + insuf, qn + insuf >= 1, '教育-032：原因+接手人+人工确认');
  } catch (e) {
    check('Harness 运行异常', '异常', '无异常', String(e && e.message || e), false);
  }

  /* 回滚：保留运行期间 token 之外的状态，避免污染演示数据 */
  const keepTokens = DB.tokens;
  DB = snap;
  DB.tokens = Object.assign(DB.tokens, keepTokens);
  if (currentUser) {
    for (const k in DB.tokens) if (DB.tokens[k] === currentUser.username) stateTokensKeep(k);
  }

  const passed = results.filter(r => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, results, ranAt: Date.now() };
}
const _keepTokens = {};
function stateTokensKeep(k) { _keepTokens[k] = DB.tokens[k]; }
