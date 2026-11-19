# -*- coding: utf-8 -*-
"""FDE MVP · 实习管理与教学改进（知行职业学院 · 机电试点）
FastAPI 单体：①接入（人工补录/种子）②映射③规则④模型(抽取)⑤复核台(本前端)⑥输出 + 审计旁路。
启动：uvicorn main:app --host 0.0.0.0 --port $PORT
"""
import hashlib
import json
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import core
import kb
import rules
from core import audit_log, auth_user, deny, get_conn, login, visible_feedbacks, visible_student

app = FastAPI(title="FDE MVP · 实习管理与教学改进", version="1.0.0")


@app.on_event("startup")
def _startup():
    core.init_db()


# ---------------- 模型 ----------------

class LoginIn(BaseModel):
    username: str
    password: str


class FeedbackIn(BaseModel):
    sid: str
    period: str
    taskHint: str = ""
    comment: str
    scoreRaw: float = None
    scoreType: str = "100"


class AskIn(BaseModel):
    question: str


class ReassignIn(BaseModel):
    newMentor: str


class UserIn(BaseModel):
    username: str
    password: str
    display: str
    role: str
    orgId: str = None


# ---------------- 依赖 ----------------

def need(request: Request, authorization: str = Header(default=None)):
    user = auth_user(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或令牌失效")
    return user



# ---------------- 健康检查 / 登录 ----------------

@app.get("/health")
def health():
    return {"status": "ok", "service": "fde-mvp", "time": time.time()}


@app.post("/api/login")
def api_login(body: LoginIn):
    r = login(body.username, body.password)
    if not r:
        conn = get_conn()
        audit_log(conn, body.username, "auth.fail", "login", "密码错误或用户不存在", "DENIED")
        conn.close()
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return r


@app.get("/api/me")
def api_me(authorization: str = Header(default=None)):
    return need(None, authorization)


# ---------------- 总览指标（M1–M5） ----------------

@app.get("/api/overview")
def api_overview(authorization: str = Header(default=None)):
    user = need(None, authorization)
    conn = get_conn()
    m = rules.metrics_overview(conn)
    m["counts"] = {
        "feedbacks": conn.execute("SELECT COUNT(*) n FROM feedbacks").fetchone()["n"],
        "changes": conn.execute("SELECT COUNT(*) n FROM changes").fetchone()["n"],
        "unsynced": conn.execute("SELECT COUNT(*) n FROM changes WHERE synced=0").fetchone()["n"],
        "triples": conn.execute("SELECT COUNT(*) n FROM triples").fetchone()["n"],
        "suggestions": conn.execute("SELECT COUNT(*) n FROM suggestions").fetchone()["n"],
    }
    conn.close()
    m["llm"] = {"provider": kb.LLM_PROVIDER, "online": kb.llm_available(), "prompt": kb.PROMPT_VERSION}
    return m


# ---------------- 反馈归集（REQ-01/REQ-02） ----------------

@app.get("/api/feedbacks")
def api_feedbacks(authorization: str = Header(default=None)):
    user = need(None, authorization)
    conn = get_conn()
    rows = visible_feedbacks(user, conn)
    out = [dict(r) for r in rows]
    conn.close()
    return out


@app.post("/api/feedbacks")
def api_feedback_create(body: FeedbackIn, authorization: str = Header(default=None)):
    user = need(None, authorization)
    if user["role"] not in ("mentor", "teacher", "jiaowu", "admin"):
        return deny(user, "feedback.create", target="feedback", detail="该角色无提交权限")
    conn = get_conn()
    st = visible_student(user, conn, body.sid)
    if not st:
        conn.close()
        return deny(user, "feedback.create", target=body.sid, detail="跨企业个体数据不可见（ZL-01 第二十二条 / E7）")
    try:
        cur = conn.execute(
            "INSERT INTO feedbacks(sid,intern_id,period,mentor_uid,task_ref,observed,score_raw,"
            "score_type,comment,status,src_version,submitted_by,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (body.sid, st["intern_id"], body.period, st["mentor_uid"],
             body.taskHint or None, None, body.scoreRaw, body.scoreType, body.comment,
             "submitted", "manual-%d" % int(time.time()), user["username"], time.time()))
        fid = cur.lastrowid
        conn.commit()
        audit_log(conn, user["username"], "feedback.create", "feedback:%d" % fid,
                  "sid=%s period=%s" % (body.sid, body.period), "OK")
        conn.close()
        return {"id": fid, "ok": True}
    except Exception as e:
        audit_log(conn, user["username"], "feedback.create", body.sid,
                  "重复提交同一批次（幂等拒绝，E5）：%s" % str(e)[:80], "REJECTED")
        conn.close()
        raise HTTPException(status_code=409, detail="该学生在此周期已有反馈（幂等键 intern_id+period 命中，E5）")


@app.post("/api/feedbacks/{fid}/extract")
def api_extract(fid: int, authorization: str = Header(default=None)):
    """模型层：评语 → 三元组。低置信转人工队列（停止条件，教育-032）。"""
    user = need(None, authorization)
    conn = get_conn()
    fb = conn.execute("SELECT * FROM feedbacks WHERE id=?", (fid,)).fetchone()
    if not fb:
        conn.close()
        raise HTTPException(status_code=404, detail="反馈不存在")
    if user["role"] == "mentor" and fb["mentor_uid"] != user["username"] and fb["sid"]:
        st = visible_student(user, conn, fb["sid"])
        if not st:
            conn.close()
            return deny(user, "extract", target="feedback:%d" % fid, detail="跨企业个体数据不可见（E7）")
    res = kb.extract_triple(fb["comment"] or "", fb["task_ref"] or "")
    span = json.dumps(res["span"], ensure_ascii=False) if res["span"] else None
    cur = conn.execute(
        "INSERT INTO triples(feedback_id,task_ref,observed_behavior,gap,suggestion,course_hint,"
        "confidence,span,status,prompt_version,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (fid, res["task_ref"], res["observed_behavior"], res["gap"], res["suggestion"],
         res["course_hint"], res["confidence"], span, res["status"], kb.PROMPT_VERSION, time.time()))
    tid = cur.lastrowid
    if res["status"] == "insufficient_evidence":
        conn.execute("UPDATE feedbacks SET status='insufficient' WHERE id=?", (fid,))
    audit_log(conn, user["username"], "extract", "triple:%d" % tid,
              "prompt=%s conf=%s status=%s" % (kb.PROMPT_VERSION, res["confidence"], res["status"]),
              res["status"].upper())
    conn.commit()
    row = conn.execute("SELECT * FROM triples WHERE id=?", (tid,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/triples")
def api_triples(authorization: str = Header(default=None)):
    user = need(None, authorization)
    conn = get_conn()
    q = ("SELECT t.*, f.comment, f.sid, s.name AS sname, s.enterprise_id AS eid, e.name AS ename "
         "FROM triples t JOIN feedbacks f ON f.id=t.feedback_id "
         "JOIN students s ON s.sid=f.sid JOIN enterprises e ON e.id=s.enterprise_id "
         "ORDER BY t.id DESC")
    rows = [dict(r) for r in conn.execute(q).fetchall()]
    conn.close()
    if user["role"] == "mentor":
        rows = [r for r in rows if r["eid"] == user["orgId"]]
    return rows


@app.post("/api/triples/{tid}/promote")
def api_promote(tid: int, authorization: str = Header(default=None)):
    """N1 人工复核通过 → 生成建议草稿；N2 三要素校验决定 draft / 待签核。"""
    user = need(None, authorization)
    if user["role"] not in ("teacher", "jiaowu", "admin"):
        return deny(user, "triple.promote", target="triple:%d" % tid, detail="复核权限仅教师/教务")
    conn = get_conn()
    t = conn.execute("SELECT * FROM triples WHERE id=?", (tid,)).fetchone()
    if not t:
        conn.close()
        raise HTTPException(status_code=404, detail="三元组不存在")
    if t["status"] in ("insufficient_evidence",):
        conn.close()
        raise HTTPException(status_code=409, detail="证据不足，不能进入建议流（教育-004）")
    dup = conn.execute("SELECT 1 FROM suggestions WHERE triple_id=?", (tid,)).fetchone()
    if dup:
        conn.close()
        raise HTTPException(status_code=409, detail="该三元组已生成建议，不可重复提升（幂等拒绝）")
    fb = conn.execute("SELECT * FROM feedbacks WHERE id=?", (t["feedback_id"],)).fetchone()
    chk = rules.check_suggestion_formal({"course_hint": t["course_hint"], "task_ref": t["task_ref"]})
    status = "pending_sign" if chk["ok"] else "draft"
    cur = conn.execute(
        "INSERT INTO suggestions(triple_id,course,task_ref,owner,status,feedback_ref,created) "
        "VALUES(?,?,?,?,?,?,?)",
        (tid, t["course_hint"], t["task_ref"], "唐映秋", status,
         "feedback:%d/sid:%s" % (t["feedback_id"], fb["sid"]), time.time()))
    sid_new = cur.lastrowid
    conn.execute("UPDATE triples SET status=? WHERE id=?",
                 ("human_confirmed" if status == "pending_sign" else "draft", tid))
    audit_log(conn, user["username"], "triple.promote", "suggestion:%d" % sid_new,
              "N2 三要素校验 %s，缺失：%s" % ("通过" if chk["ok"] else "未通过", "、".join(chk["missing"]) or "无"),
              "OK" if chk["ok"] else "DRAFT")
    conn.commit()
    conn.close()
    return {"suggestionId": sid_new, "status": status, "missing": chk["missing"]}


@app.get("/api/suggestions")
def api_suggestions(authorization: str = Header(default=None)):
    user = need(None, authorization)
    conn = get_conn()
    q = ("SELECT s.*, t.gap, t.suggestion, t.confidence, f.sid, s2.name AS sname, "
         "s2.enterprise_id AS eid, e.name AS ename "
         "FROM suggestions s JOIN triples t ON t.id=s.triple_id "
         "JOIN feedbacks f ON f.id=t.feedback_id "
         "JOIN students s2 ON s2.sid=f.sid JOIN enterprises e ON e.id=s2.enterprise_id "
         "ORDER BY s.id DESC")
    rows = [dict(r) for r in conn.execute(q).fetchall()]
    conn.close()
    if user["role"] == "mentor":
        rows = [r for r in rows if r["eid"] == user["orgId"]]
    return rows


@app.post("/api/suggestions/{sid_}/approve")
def api_approve(sid_: int, authorization: str = Header(default=None)):
    """建议签核入库（不可逆动作③：三要素齐备 + 原记录引用 + 签核时间戳）。"""
    user = need(None, authorization)
    if user["role"] not in ("jiaowu", "audit", "admin"):
        return deny(user, "suggestion.approve", target="suggestion:%d" % sid_,
                    detail="签核权限仅教务/风险（N2）")
    conn = get_conn()
    s = conn.execute("SELECT * FROM suggestions WHERE id=?", (sid_,)).fetchone()
    if not s:
        conn.close()
        raise HTTPException(status_code=404, detail="建议不存在")
    if s["status"] == "draft":
        conn.close()
        raise HTTPException(status_code=409, detail="三要素不齐备，仍为草稿，不能签核入库（教育-015）")
    conn.execute("UPDATE suggestions SET status='formal', signed_by=?, signed_at=? WHERE id=?",
                 (user["username"], time.time(), sid_))
    audit_log(conn, user["username"], "suggestion.approve", "suggestion:%d" % sid_,
              "引用=%s 签核人=%s" % (s["feedback_ref"], user["username"]), "FORMAL")
    conn.commit()
    conn.close()
    return {"ok": True, "status": "formal"}


# ---------------- 变更同步（REQ-02 / N3 / E1） ----------------

@app.get("/api/changes")
def api_changes(authorization: str = Header(default=None)):
    user = need(None, authorization)
    conn = get_conn()
    q = ("SELECT c.*, st.name AS sname, st.enterprise_id AS eid, e.name AS ename, "
         "(SELECT COUNT(*) FROM feedbacks f WHERE f.intern_id=c.intern_id AND f.mentor_uid=c.old_mentor) AS stale_hits "
         "FROM changes c JOIN students st ON st.sid=c.sid "
         "JOIN enterprises e ON e.id=st.enterprise_id ORDER BY c.id")
    rows = [dict(r) for r in conn.execute(q).fetchall()]
    conn.close()
    if user["role"] == "mentor":
        rows = [r for r in rows if r["eid"] == user["orgId"]]
    for r in rows:
        r["risk"] = (not r["synced"]) and r["stale_hits"] > 0  # E1：换岗未同步且仍向旧导师产生反馈
    return rows


@app.post("/api/changes/{cid}/reassign")
def api_reassign(cid: int, body: ReassignIn, authorization: str = Header(default=None)):
    """N3 改派确认：前置确定性校验（§6.2）全部通过才允许；否则挂起并写明原因。"""
    user = need(None, authorization)
    if user["role"] not in ("jiaowu", "admin"):
        return deny(user, "change.reassign", target="change:%d" % cid, detail="改派权限仅教务（N3）")
    conn = get_conn()
    ch = conn.execute("SELECT * FROM changes WHERE id=?", (cid,)).fetchone()
    if not ch:
        conn.close()
        raise HTTPException(status_code=404, detail="变更不存在")
    conn.close()
    chk = rules.check_reassign(ch["intern_id"], body.newMentor, user["username"])
    conn = get_conn()
    if chk["ok"]:
        conn.execute("INSERT INTO todos(key_hash,intern_id,kind,assignee,status,note,created) "
                     "VALUES(?,?,?,?,?,?,?)",
                     (chk["key_hash"], ch["intern_id"], "reassign", body.newMentor, "assigned",
                      "变更#%d 改派，承接人 %s" % (cid, body.newMentor), time.time()))
        conn.execute("UPDATE students SET mentor_uid=? WHERE intern_id=?", (body.newMentor, ch["intern_id"]))
        conn.execute("UPDATE changes SET synced=1 WHERE id=?", (cid,))
        audit_log(conn, user["username"], "change.reassign", "change:%d" % cid,
                  "intern=%s -> %s" % (ch["intern_id"], body.newMentor), "OK")
        conn.commit()
        conn.close()
        return {"ok": True, "todo": "assigned"}
    conn.execute("INSERT INTO todos(key_hash,intern_id,kind,assignee,status,note,created) "
                 "VALUES(?,?,?,?,?,?,?)",
                 (chk["key_hash"] + "|held-%d" % cid, ch["intern_id"], "reassign", None, "held",
                  "挂起原因：%s" % "；".join(chk["fails"]), time.time()))
    audit_log(conn, user["username"], "change.reassign.hold", "change:%d" % cid,
              "；".join(chk["fails"]), "HELD")
    conn.commit()
    conn.close()
    return {"ok": False, "held": True, "fails": chk["fails"]}


@app.get("/api/todos")
def api_todos(authorization: str = Header(default=None)):
    need(None, authorization)
    conn = get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM todos ORDER BY id DESC").fetchall()]
    conn.close()
    return rows


# ---------------- 知识库（Wiki + RAG + LLM） ----------------

@app.get("/api/kb/search")
def api_kb_search(q: str, authorization: str = Header(default=None)):
    need(None, authorization)
    return kb.rag_search(q, top_k=6)


@app.post("/api/kb/ask")
def api_kb_ask(body: AskIn, authorization: str = Header(default=None)):
    need(None, authorization)
    return kb.kb_ask(body.question)


@app.get("/api/wiki")
def api_wiki(authorization: str = Header(default=None)):
    need(None, authorization)
    wiki = json.load(open((core.SEED / "wiki.json"), encoding="utf-8"))
    return [{"slug": p["slug"], "title": p["title"], "code": p["code"],
             "tags": p["tags"], "body": p["body"]} for p in wiki["pages"]]


# ---------------- 权限与管理（SaaS 管理员） ----------------

@app.post("/api/scores")
def api_scores(request: Request, authorization: str = Header(default=None)):
    """成绩写回接口【不存在】：任何调用一律 403 + 留痕（ZL-01 第十七条 / 教育-012）。"""
    user = auth_user(authorization)
    conn = get_conn()
    audit_log(conn, user["username"] if user else "anonymous", "score.write.attempt",
              "POST /api/scores", "成绩写回接口不存在（schema 无 score 字段），越权尝试", "DENIED")
    conn.close()
    return JSONResponse(status_code=403, content={"detail": "成绩写回被制度禁止（ZL-01 第十七条），接口不存在，已留痕"})


@app.get("/api/admin/users")
def api_admin_users(authorization: str = Header(default=None)):
    user = need(None, authorization)
    if user["role"] != "admin":
        return deny(user, "admin.users", detail="仅 SaaS 管理员")
    conn = get_conn()
    rows = [dict(r) for r in conn.execute(
        "SELECT username, display, role, org_id FROM users ORDER BY username").fetchall()]
    ents = [dict(r) for r in conn.execute("SELECT * FROM enterprises").fetchall()]
    conn.close()
    for r in rows:
        r["roleName"] = core.ROLES.get(r["role"], r["role"])
    return {"users": rows, "enterprises": ents}


@app.post("/api/admin/users")
def api_admin_add_user(body: UserIn, authorization: str = Header(default=None)):
    user = need(None, authorization)
    if user["role"] != "admin":
        return deny(user, "admin.users.add", detail="仅 SaaS 管理员")
    conn = get_conn()
    try:
        conn.execute("INSERT INTO users VALUES(?,?,?,?,?)",
                     (body.username, hashlib.sha256(body.password.encode()).hexdigest(),
                      body.display, body.role, body.orgId))
        conn.commit()
        audit_log(conn, user["username"], "admin.user.add", body.username,
                  "role=%s org=%s" % (body.role, body.orgId), "OK")
        conn.close()
        return {"ok": True}
    except Exception:
        conn.close()
        raise HTTPException(status_code=409, detail="用户名已存在")


@app.get("/api/audit")
def api_audit(authorization: str = Header(default=None)):
    user = need(None, authorization)
    conn = get_conn()
    if user["role"] in ("admin", "audit"):
        rows = [dict(r) for r in conn.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 200").fetchall()]
    else:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM audit WHERE actor=? ORDER BY id DESC LIMIT 100", (user["username"],)).fetchall()]
    conn.close()
    return rows


@app.get("/api/config")
def api_config(authorization: str = Header(default=None)):
    """口径注册表（版本化，教育-026）：分母、周期、换算备案。"""
    need(None, authorization)
    conn = get_conn()
    ents = [dict(r) for r in conn.execute("SELECT * FROM enterprises").fetchall()]
    conn.close()
    return {"version": "koujing_v1.0", "denominator": "学生 × 双周周期（10 期/学期）",
            "periods": rules.EXPECTED_PERIODS, "scaleMap": rules.SCALE_MAP, "enterprises": ents}


# ---------------- Harness 测试台 ----------------

@app.get("/api/harness/run")
def api_harness(authorization: str = Header(default=None)):
    user = need(None, authorization)
    if user["role"] not in ("admin", "audit", "jiaowu"):
        return deny(user, "harness.run", detail="测试台仅 SaaS 管理员/风险/教务可触发")
    import harness
    report = harness.run_harness()
    conn = get_conn()
    audit_log(conn, user["username"], "harness.run", "api/harness",
              "%d/%d 通过" % (report["passed"], report["total"]),
              "PASS" if report["failed"] == 0 else "FAIL")
    conn.close()
    return report


# ---------------- 前端 ----------------

@app.get("/")
def index():
    return FileResponse(str(core.BASE / "static" / "index.html"))


app.mount("/static", StaticFiles(directory=str(core.BASE / "static")), name="static")


if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
