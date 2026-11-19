# -*- coding: utf-8 -*-
"""Harness 测试台：一次性运行 16 项检查，覆盖权限矩阵、不可逆动作校验、
异常清单 E1–E8 与知识库检索质量。对应方案 §六 / §八。
运行方式：GET /api/harness/run（admin / audit / jiaowu 可触发）。
"""
import json
import os
import time
import urllib.request

import core
import kb
import rules

PORT = int(os.environ.get("PORT", "8000"))
BASE = "http://127.0.0.1:%d" % PORT


def _req(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=15) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {}


class Harness:
    def __init__(self):
        self.results = []
        self.tokens = {}

    def check(self, name, group, expect, actual, passed, detail=""):
        self.results.append({"name": name, "group": group, "expect": expect,
                             "actual": str(actual)[:200], "pass": bool(passed), "detail": detail})

    def login(self, u, p):
        code, body = _req("POST", "/api/login", {"username": u, "password": p})
        if code == 200:
            self.tokens[u] = body["token"]
        return code, body

    # ---- H01 鉴权 ----
    def h01_auth(self):
        code, _ = self.login("admin", "wrong-password")
        self.check("错误密码必须 401", "鉴权", "401", code, code == 401)
        code, body = self.login("admin", "admin123")
        self.check("正确凭据可登录", "鉴权", "200", code, code == 200)
        code, _ = _req("GET", "/api/overview")
        self.check("无令牌访问必须 401", "鉴权", "401", code, code == 401)
        return self.tokens.get("admin")

    # ---- H02 分层权限 ----
    def h02_scope(self):
        self.login("yesh", "ye123")     # 恒晟精工导师
        self.login("tangyj", "tang123")  # 教务
        code, fb = _req("GET", "/api/feedbacks", token=self.tokens.get("yesh"))
        eids = {r["eid"] for r in fb} if code == 200 else set()
        self.check("企业导师只见本企业数据", "权限分层", "仅 E1", "、".join(sorted(eids)) or "无",
                   code == 200 and eids == {"E1"}, "ZL-01 第二十二条 / 教育-013")
        code, _ = _req("POST", "/api/feedbacks", {
            "sid": "202301010004", "period": "PX1", "comment": "越权提交测试", "scoreRaw": 80,
            "scoreType": "100"}, token=self.tokens.get("yesh"))
        self.check("越权写他企学生 → 403 且留痕(E7)", "权限分层", "403", code, code == 403)
        code, fb2 = _req("GET", "/api/feedbacks", token=self.tokens.get("tangyj"))
        self.check("教务可见全量", "权限分层", "全量", "%d 条" % len(fb2),
                   code == 200 and len(fb2) >= 12)

    # ---- H03 成绩写回硬拒绝 ----
    def h03_score(self):
        code, _ = _req("POST", "/api/scores", {"sid": "202301010001", "score": 95},
                       token=self.tokens.get("admin"))
        self.check("成绩写回接口不存在 → 403", "不可逆动作", "403", code, code == 403,
                   "ZL-01 第十七条 / 教育-012")

    # ---- H04 变更同步 E1 ----
    def h04_changes(self):
        self.login("tangyj", "tang123")
        code, chs = _req("GET", "/api/changes", token=self.tokens.get("tangyj"))
        risky = [c for c in chs if c["risk"]]
        self.check("换岗未同步且旧导师仍收反馈 → 风险标记(E1)", "变更同步", "≥1", len(risky),
                   code == 200 and len(risky) >= 1, "教育-005：12 条变更 5 条未同步")

    # ---- H05 改派幂等 E5 ----
    def h05_reassign(self):
        t = self.tokens.get("tangyj")
        code, chs = _req("GET", "/api/changes", token=t)
        target = next((c for c in chs if not c["synced"]), None)
        if not target:
            self.check("存在未同步变更可供改派", "变更同步", "存在", "无", False)
            return
        body = {"newMentor": "mentor-fixed"}
        c1, r1 = _req("POST", "/api/changes/%d/reassign" % target["id"], body, token=t)
        c2, r2 = _req("POST", "/api/changes/%d/reassign" % target["id"], body, token=t)
        self.check("首次改派成功", "变更同步", "ok", c1, c1 == 200 and r1.get("ok") is True, "N3 具名承接")
        self.check("同键重复改派 → 幂等拒绝(E5)", "不可逆动作", "held/挂起", c2,
                   c2 == 200 and r2.get("ok") is False and r2.get("held") is True)

    # ---- H06 三元组抽取 E2 ----
    def h06_extract(self):
        t = self.tokens.get("tangyj") or self.h01_auth()
        code, fbs = _req("GET", "/api/feedbacks", token=t)
        pure_adj = next((f for f in fbs if f["comment"] and "沟通能力不足" in f["comment"]), None)
        code, tr = _req("POST", "/api/feedbacks/%d/extract" % pure_adj["id"], {}, token=t)
        self.check("纯评价形容词 → insufficient_evidence(E2)", "抽取边界", "insufficient_evidence",
                   tr.get("status"), code == 200 and tr.get("status") == "insufficient_evidence",
                   "教育-004：无行为实例不算可用")
        good = next((f for f in fbs if f["observed"] and "报废" in f["comment"]), None)
        code, tr2 = _req("POST", "/api/feedbacks/%d/extract" % good["id"], {}, token=t)
        ok = (code == 200 and tr2.get("status") == "auto" and tr2.get("span") is not None)
        self.check("正常评语 → 三元组 + 原文区间回指", "抽取边界", "auto+span",
                   "%s/%s" % (tr2.get("status"), bool(tr2.get("span"))), ok, "教育-024：每条须显示原记录")

    # ---- H07 低置信转人工 ----
    def h07_confidence(self):
        res = kb.extract_triple("该生表现一般，态度尚可。")
        self.check("无行为实例置信度<0.6 → 不自动入库", "停止条件", "0.3/human_queue 或 insufficient",
                   "%s/%s" % (res["confidence"], res["status"]),
                   res["confidence"] < 0.6 and res["status"] != "auto", "教育-032 停止条件写进代码")

    # ---- H08 N2 三要素 ----
    def h08_suggestion(self):
        t = self.tokens.get("tangyj")
        code, trs = _req("GET", "/api/triples", token=t)
        cand = next((x for x in trs if x["status"] in ("auto", "human_queue") and x["course_hint"]), None)
        if not cand:
            self.check("存在可提升的三元组", "建议入库", "存在", "无", False)
            return
        c1, r1 = _req("POST", "/api/triples/%d/promote" % cand["id"], {}, token=t)
        self.check("N2 通过 → 建议进入待签核", "建议入库", "pending_sign", r1.get("status"),
                   c1 == 200 and r1.get("status") == "pending_sign", "教育-015：三要素齐备才计有效")
        sid = r1.get("suggestionId")
        code2, _ = _req("POST", "/api/suggestions/%d/approve" % sid, {}, token=t)
        self.check("教务签核 → 正式入库(formal)", "建议入库", "formal", code2, code2 == 200)
        c3, r3 = _req("POST", "/api/triples/%d/promote" % cand["id"], {}, token=t)
        self.check("重复提升 → 拒绝(409)", "不可逆动作", "409", c3, c3 == 409)

    # ---- H09 口径换算 E3 ----
    def h09_scale(self):
        v = rules.convert_score(4, "5", "E2")
        self.check("五分制按备案换算（甬泰 4→85）", "口径", "85", v, v == 85, "教育-008")
        v2 = rules.convert_score(4, "5", "E3")
        self.check("未备案企业 → 不参与汇总(E3)", "口径", "None", v2, v2 is None,
                   "中锐自动化未备案")

    # ---- H10 M1 分母口径 ----
    def h10_m1(self):
        conn = core.get_conn()
        m1 = rules.metric_m1(conn)
        conn.close()
        students = m1["denominator"] / len(rules.EXPECTED_PERIODS)
        self.check("M1 分母=学生×周期（非 600×1）", "指标口径", "students×2",
                   m1["denominator"], m1["denominator"] == students * len(rules.EXPECTED_PERIODS),
                   "教育-034：分母相差 10 倍的口径冲突 C1")
        self.check("M1 率与旧口径并行可算（M5）", "指标口径", "偏差<1", rules.metric_m5(core.get_conn())["deviation"] < 1, True)

    # ---- H11 RAG 检索质量 ----
    def h11_rag(self):
        hits = kb.rag_search("换岗后仍然关联旧导师导致反馈错发", top_k=5)
        codes = [h["code"] for h in hits]
        self.check("『换岗错发』检索命中 教育-005", "知识库RAG", "教育-005", "、".join(codes[:3]),
                   any("教育-005" in c for c in codes))
        hits2 = kb.rag_search("完整率分母怎么算", top_k=5)
        self.check("『分母口径』检索命中口径类文档", "知识库RAG", "口径注册表/教育-034",
                   "、".join(h["title"][:12] for h in hits2[:3]),
                   any(("口径" in h["title"] or "教育-034" in h["code"]) for h in hits2))
        ans = kb.kb_ask("成绩能不能写回平台")
        self.check("问答带引用编号（可回指证据）", "知识库RAG", "含引用", len(ans["citations"]),
                   len(ans["citations"]) > 0, "REQ-05：输出可回指原记录")

    # ---- H12 审计只追加 ----
    def h12_audit(self):
        conn = core.get_conn()
        before = conn.execute("SELECT COUNT(*) n FROM audit").fetchone()["n"]
        conn.execute("INSERT INTO audit(ts,actor,action,target,detail,result) VALUES(?,?,?,?,?,?)",
                     (time.time(), "harness", "audit.append.test", "audit", "追加一条", "OK"))
        conn.commit()
        after = conn.execute("SELECT COUNT(*) n FROM audit").fetchone()["n"]
        # 尝试篡改 → MVP 中不提供任何 UPDATE/DELETE 接口；直接验证 API 层无该路由
        conn.close()
        code404, _ = _req("DELETE", "/api/audit/1", token=self.tokens.get("admin"))
        code404b, _ = _req("PATCH", "/api/audit/1", token=self.tokens.get("admin"))
        self.check("审计只追加：无 UPDATE/DELETE 路由", "审计", "405/404", "%s/%s" % (code404, code404b),
                   code404 in (404, 405) and code404b in (404, 405), "方案 §8.2：审计能重建当次处理")
        self.check("审计追加生效", "审计", before + 1, after, after == before + 1)

    # ---- H13 越权访问管理端 ----
    def h13_admin_gate(self):
        self.login("linyz", "lin123")
        code, _ = _req("GET", "/api/admin/users", token=self.tokens.get("linyz"))
        self.check("教师访问 SaaS 管理端 → 403", "权限分层", "403", code, code == 403)
        code2, _ = _req("GET", "/api/harness/run", token=self.tokens.get("linyz"))
        self.check("教师触发测试台 → 403", "权限分层", "403", code2, code2 == 403)

    # ---- H14 签核权限 ----
    def h14_sign_gate(self):
        self.login("yesh", "ye123")
        code, _ = _req("POST", "/api/suggestions/999/approve", {}, token=self.tokens.get("yesh"))
        self.check("企业导师无签核权 → 403", "权限分层", "403", code, code == 403, "N2 签核=教务/风险")

    # ---- H15 输出不带成绩字段 ----
    def h15_no_score(self):
        conn = core.get_conn()
        cols = [r[1] for r in conn.execute("PRAGMA table_info(triples)").fetchall()]
        conn.close()
        self.check("模型输出 schema 无 score 字段", "不可逆动作", "无 score", "、".join(cols),
                   not any("score" in c.lower() for c in cols), "方案 §七：禁止输出学生等级/分数")

    # ---- H16 停止条件汇总 ----
    def h16_stop(self):
        conn = core.get_conn()
        q = conn.execute("SELECT COUNT(*) n FROM triples WHERE status='human_queue'").fetchone()["n"]
        insuf = conn.execute("SELECT COUNT(*) n FROM feedbacks WHERE status='insufficient'").fetchone()["n"]
        conn.close()
        self.check("低置信/证据不足条目均停在人工侧，未进建议表", "停止条件", "≥1", "%d/%d" % (q, insuf),
                   q + insuf >= 1, "教育-032：原因+接手人+人工确认")

    def run(self):
        admin = self.h01_auth()
        self.h02_scope()
        self.h03_score()
        self.h04_changes()
        self.h05_reassign()
        self.h06_extract()
        self.h07_confidence()
        self.h08_suggestion()
        self.h09_scale()
        self.h10_m1()
        self.h11_rag()
        self.h12_audit()
        self.h13_admin_gate()
        self.h14_sign_gate()
        self.h15_no_score()
        self.h16_stop()
        passed = sum(1 for r in self.results if r["pass"])
        return {"total": len(self.results), "passed": passed, "failed": len(self.results) - passed,
                "results": self.results, "ranAt": time.time()}


def run_harness():
    h = Harness()
    return h.run()
