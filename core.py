# -*- coding: utf-8 -*-
"""核心：SQLite 存储、种子数据、鉴权与分层权限、审计旁路。
权限对齐技术方案 §5.4 权限矩阵：
- admin（SaaS 管理员）：用户/口径/审计全量管理
- 分层用户：jiaowu 教务 / teacher 指导教师 / mentor 企业导师 / audit 风险合规
- 跨企业个体评价不可见（教育-013、ZL-01 第二十二条）；成绩字段对所有角色均无（教育-012）
"""
import hashlib
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path

from fastapi.responses import JSONResponse

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "data" / "app.db"
SEED = BASE / "seed"

ROLES = {
    "admin": "SaaS管理员",
    "jiaowu": "教务管理员",
    "teacher": "实习指导教师",
    "mentor": "企业实习导师",
    "audit": "风险合规",
}

DEMO_USERS = [
    ("admin", "admin123", "SaaS管理员", "admin", None),
    ("tangyj", "tang123", "唐映秋 · 教务管理员", "jiaowu", None),
    ("linyz", "lin123", "林亦舟 · 指导教师", "teacher", None),
    ("yesh", "ye123", "叶书 · 企业导师（恒晟精工）", "mentor", "E1"),
    ("yesh2", "ye456", "甬泰导师", "mentor", "E2"),
    ("fujing", "fu123", "傅景 · 教学质量负责人", "audit", None),
]

ENTERPRISES = [
    ("E1", "恒晟精工", "100", "filed"),
    ("E2", "甬泰机电", "5", "filed"),
    ("E3", "中锐自动化", "5", "unfiled"),
    ("E4", "海川装备", "100", "filed"),
    ("E5", "鼎新模具", "100", "filed"),
]

STUDENTS = [  # (sid, name, enterprise_id, mentor_uid, intern_id, course_uid, batch)
    ("202301010001", "陈一鸣", "E1", "yesh", "2026B-JD-01-0001", "C-NC-001", "P01"),
    ("202301010002", "李思远", "E1", "yesh", "2026B-JD-01-0002", "C-NC-001", "P01"),
    ("202301010003", "王梓豪", "E1", "yesh", "2026B-JD-01-0003", "C-MJ-002", "P01"),
    ("202301010004", "张启航", "E2", "yesh2", "2026B-JD-02-0001", "C-ZP-003", "P01"),
    ("202301010005", "刘宇航", "E2", "yesh2", "2026B-JD-02-0002", "C-ZP-003", "P01"),
    ("202301010006", "赵子轩", "E2", "yesh2", "2026B-JD-02-0003", "C-AZ-004", "P01"),
    ("202301010007", "孙浩然", "E3", "mentor-e3", "2026B-JD-03-0001", None, "P01"),
    ("202301010008", "周子墨", "E3", "mentor-e3", "2026B-JD-03-0002", "C-WH-005", "P01"),
    ("202301010009", "吴俊杰", "E4", "mentor-e4", "2026B-JD-04-0001", "C-GY-006", "P01"),
    ("202301010010", "郑一凡", "E4", "mentor-e4", "2026B-JD-04-0002", "C-GY-006", "P01"),
    ("202301010011", "冯天翊", "E5", "mentor-e5", "2026B-JD-05-0001", "C-MJ-002", "P01"),
    ("202301010012", "许沐宸", "E5", "mentor-e5", "2026B-JD-05-0002", "C-AZ-004", "P01"),
]

# (sid, period, mentor, task_ref, observed, score_raw, score_type, comment)
SEED_FEEDBACKS = [
    ("202301010001", "P01", "yesh", "数控加工", "本周独立完成 12 件法兰盘毛坯的数控车削加工，首件自检合格率 11/12，有 1 件因对刀偏差超差报废。", 88, "100", "该生操作比较熟练，能独立完成数控加工任务，首件自检合格率 11/12，有 1 件因对刀偏差超差报废。"),
    ("202301010002", "P01", "yesh", "零件编程", "本周编写 3 个加工程序，其中 1 个程序因坐标系设定错误导致空运行两次，经指导后修正。", 92, "100", "编程能力不错，本周编写 3 个加工程序，其中 1 个程序因坐标系设定错误导致空运行两次。"),
    ("202301010003", "P01", "yesh", "模具设计", "完成 2 套注塑模的分型面绘制并提交工艺文件，图纸一次通过率 50%。", 85, "100", "沟通能力不足，需要加强。"),  # 纯评价形容词 → E2
    ("202301010004", "P01", "yesh2", "装配调试", "完成 5 台小型减速器装配，其中 2 台出现异响返工，返工后噪音达标。", 4, "5", "装配较熟练，完成 5 台小型减速器装配，其中 2 台出现异响返工。"),
    ("202301010005", "P01", "yesh2", "质量检验", "本周承担进货检验 30 批次，检出 2 批次尺寸超差并按流程隔离上报。", 5, "5", "工作认真，本周承担进货检验 30 批次，检出 2 批次尺寸超差并按流程隔离上报。"),
    ("202301010006", "P01", "yesh2", "装配调试", "装配进度比计划延迟 3 天，主要卡在工装夹具找不到位。", 3, "5", "进度有延迟，装配进度比计划延迟 3 天，主要卡在工装夹具找不到位。"),
    ("202301010007", "P01", "mentor-e3", None, None, 90, "100", "表现良好，按时出勤。"),  # 缺任务+无行为实例
    ("202301010008", "P01", "mentor-e3", "设备维护", "完成 2 台空压机一级保养并填写维护记录，发现 1 处皮带磨损已报修。", 88, "100", "完成 2 台空压机一级保养并填写维护记录，发现 1 处皮带磨损已报修。"),
    ("202301010009", "P01", "mentor-e4", "工艺文件", "编写 4 份工序卡，其中 1 份因工序顺序错误被工艺员退回修改。", 82, "100", "编写 4 份工序卡，其中 1 份因工序顺序错误被工艺员退回修改。"),
    ("202301010010", "P01", "mentor-e4", "现场巡检", "本周完成 10 次现场巡检，发现 3 处安全隐患并当日上报整改。", 95, "100", "巡检很主动，本周完成 10 次现场巡检，发现 3 处安全隐患并当日上报。"),
    ("202301010011", "P01", "mentor-e5", "CAD制图", "完成 6 张零件图的 CAD 绘制，尺寸标注遗漏率较高，被退回 2 次修改。", 90, "100", "CAD 绘图能力不错，完成 6 张零件图的 CAD 绘制，尺寸标注遗漏率较高。"),
    ("202301010012", "P01", "mentor-e5", "物料管理", "完成本周物料出入库台账登记 200 条，其中差错 3 条已当日更正。", 86, "100", "完成本周物料出入库台账登记 200 条，其中差错 3 条已当日更正。"),
    ("202301010001", "P02", "yesh", "数控加工", "本周加工 15 件轴类零件，全部通过首件检验，装夹时间缩短至 8 分钟。", 91, "100", "进步明显，本周加工 15 件轴类零件，全部通过首件检验。"),
    ("202301010004", "P02", "yesh2", "装配调试", "独立完成 8 台减速器装配，无返工，装配节拍达到产线平均水平的 90%。", 4, "5", "本周独立完成 8 台减速器装配，无返工，装配节拍达到产线平均水平的 90%。"),
]

# (intern_id, sid, old_mentor, new_mentor, synced, change_type)
SEED_CHANGES = [
    ("2026B-JD-01-0002", "202301010002", "yesh", "yesh", True, "任务变更"),
    ("2026B-JD-02-0001", "202301010004", "yesh2", "yesh2", False, "换岗"),   # 未同步 → E1
    ("2026B-JD-03-0001", "202301010007", "mentor-e3", "mentor-e3b", False, "换岗"),
    ("2026B-JD-04-0001", "202301010009", "mentor-e4", "mentor-e4", True, "延期"),
    ("2026B-JD-05-0001", "202301010011", "mentor-e5", "mentor-e5b", False, "换岗"),
    ("2026B-JD-01-0001", "202301010001", "yesh", "yesh", True, "延期"),
    ("2026B-JD-02-0002", "202301010005", "yesh2", "yesh2b", False, "换岗"),
    ("2026B-JD-04-0002", "202301010010", "mentor-e4", "mentor-e4", True, "任务变更"),
    ("2026B-JD-05-0002", "202301010012", "mentor-e5", "mentor-e5", True, "延期"),
    ("2026B-JD-01-0003", "202301010003", "yesh", "yeshc", False, "换岗"),
    ("2026B-JD-03-0002", "202301010008", "mentor-e3", "mentor-e3", True, "任务变更"),
    ("2026B-JD-02-0003", "202301010006", "yesh2", "yesh2", True, "延期"),
]


def _hash(pwd):
    return hashlib.sha256(pwd.encode("utf-8")).hexdigest()


def get_conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(
        username TEXT PRIMARY KEY, pwd_hash TEXT NOT NULL, display TEXT,
        role TEXT NOT NULL, org_id TEXT);
    CREATE TABLE IF NOT EXISTS tokens(
        token TEXT PRIMARY KEY, username TEXT NOT NULL, created REAL);
    CREATE TABLE IF NOT EXISTS enterprises(
        id TEXT PRIMARY KEY, name TEXT, score_type TEXT, scale_status TEXT);
    CREATE TABLE IF NOT EXISTS students(
        sid TEXT PRIMARY KEY, name TEXT, enterprise_id TEXT, mentor_uid TEXT,
        intern_id TEXT UNIQUE, course_uid TEXT, batch TEXT);
    CREATE TABLE IF NOT EXISTS feedbacks(
        id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, intern_id TEXT NOT NULL,
        period TEXT NOT NULL, mentor_uid TEXT, task_ref TEXT, observed TEXT,
        score_raw REAL, score_type TEXT, comment TEXT, status TEXT DEFAULT 'submitted',
        src_version TEXT, submitted_by TEXT, created REAL,
        UNIQUE(intern_id, period));
    CREATE TABLE IF NOT EXISTS triples(
        id INTEGER PRIMARY KEY AUTOINCREMENT, feedback_id INTEGER NOT NULL,
        task_ref TEXT, observed_behavior TEXT, gap TEXT, suggestion TEXT,
        course_hint TEXT, confidence REAL, span TEXT, status TEXT,
        prompt_version TEXT, created REAL);
    CREATE TABLE IF NOT EXISTS suggestions(
        id INTEGER PRIMARY KEY AUTOINCREMENT, triple_id INTEGER NOT NULL,
        course TEXT, task_ref TEXT, owner TEXT, status TEXT DEFAULT 'draft',
        feedback_ref TEXT, signed_by TEXT, signed_at REAL, created REAL);
    CREATE TABLE IF NOT EXISTS changes(
        id INTEGER PRIMARY KEY AUTOINCREMENT, intern_id TEXT, sid TEXT,
        old_mentor TEXT, new_mentor TEXT, synced INTEGER, change_type TEXT);
    CREATE TABLE IF NOT EXISTS todos(
        id INTEGER PRIMARY KEY AUTOINCREMENT, key_hash TEXT UNIQUE,
        intern_id TEXT, kind TEXT, assignee TEXT, status TEXT, note TEXT, created REAL);
    CREATE TABLE IF NOT EXISTS audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, actor TEXT, action TEXT,
        target TEXT, detail TEXT, result TEXT);
    """)
    # 种子（幂等）
    if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        for u in DEMO_USERS:
            c.execute("INSERT INTO users VALUES(?,?,?,?,?)", (u[0], _hash(u[1]), u[2], u[3], u[4]))
        for e in ENTERPRISES:
            c.execute("INSERT INTO enterprises VALUES(?,?,?,?)", e)
        for s in STUDENTS:
            c.execute("INSERT INTO students VALUES(?,?,?,?,?,?,?)", s)
        now = time.time()
        for i, f in enumerate(SEED_FEEDBACKS):
            sid, period, mentor, task, obs, raw, stype, comment = f
            st = c.execute("SELECT intern_id FROM students WHERE sid=?", (sid,)).fetchone()[0]
            status = "ok" if obs else "insufficient"
            c.execute("INSERT INTO feedbacks(sid,intern_id,period,mentor_uid,task_ref,observed,"
                      "score_raw,score_type,comment,status,src_version,submitted_by,created) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (sid, st, period, mentor, task, obs, raw, str(stype), comment, status,
                       "seed-20261105", "seed", now + i))
        for ch in SEED_CHANGES:
            c.execute("INSERT INTO changes(intern_id,sid,old_mentor,new_mentor,synced,change_type) "
                      "VALUES(?,?,?,?,?,?)", ch)
        conn.commit()
    conn.close()


# ---------------- 审计旁路（只追加，无更新/删除接口） ----------------

def audit_log(conn, actor, action, target, detail, result):
    conn.execute("INSERT INTO audit(ts,actor,action,target,detail,result) VALUES(?,?,?,?,?,?)",
                 (time.time(), actor, action, target, detail, result))
    conn.commit()


# ---------------- 鉴权 ----------------

def login(username, password):
    conn = get_conn()
    u = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    if not u or u["pwd_hash"] != _hash(password):
        return None
    token = uuid.uuid4().hex
    conn = get_conn()
    conn.execute("INSERT INTO tokens(token,username,created) VALUES(?,?,?)", (token, username, time.time()))
    conn.commit()
    conn.close()
    return {"token": token, "username": u["username"], "display": u["display"],
            "role": u["role"], "roleName": ROLES.get(u["role"], u["role"]), "orgId": u["org_id"]}


def auth_user(auth_header):
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    conn = get_conn()
    row = conn.execute("SELECT u.* FROM tokens t JOIN users u ON u.username=t.username WHERE t.token=?",
                       (token,)).fetchone()
    conn.close()
    if not row:
        return None
    return {"username": row["username"], "display": row["display"], "role": row["role"], "orgId": row["org_id"]}


def deny(user, perm, conn=None, target="", detail=""):
    """越权拒绝：统一留痕（E7 越权访问 → 拒绝 + 留痕）。"""
    if conn is not None:
        audit_log(conn, user["username"] if user else "anonymous", "perm.deny",
                  target or perm, detail or ("无权限执行 " + perm), "DENIED")
    return JSONResponse(status_code=403, content={"detail": "权限不足：%s" % (detail or perm)})


# ---------------- 分层数据可见域（§5.4 权限矩阵的代码化） ----------------

def visible_feedbacks(user, conn):
    """mentor 只见本企业；teacher 只见本人学生（试点由林亦舟带全部学生）；audit 抽检可见；admin/jiaowu 全量。"""
    if user["role"] in ("admin", "jiaowu", "audit", "teacher"):
        return conn.execute("SELECT f.*, s.name AS sname, s.enterprise_id AS eid, e.name AS ename "
                            "FROM feedbacks f JOIN students s ON s.sid=f.sid "
                            "JOIN enterprises e ON e.id=s.enterprise_id ORDER BY f.id DESC").fetchall()
    if user["role"] == "mentor" and user["orgId"]:
        return conn.execute("SELECT f.*, s.name AS sname, s.enterprise_id AS eid, e.name AS ename "
                            "FROM feedbacks f JOIN students s ON s.sid=f.sid "
                            "JOIN enterprises e ON e.id=s.enterprise_id "
                            "WHERE s.enterprise_id=? ORDER BY f.id DESC", (user["orgId"],)).fetchall()
    return []


def visible_student(user, conn, sid):
    """个体评价可见性判定：admin/jiaowu/teacher/audit=True；mentor 仅本企业。"""
    st = conn.execute("SELECT * FROM students WHERE sid=?", (sid,)).fetchone()
    if not st:
        return None
    if user["role"] == "mentor" and st["enterprise_id"] != user["orgId"]:
        return None
    return st
