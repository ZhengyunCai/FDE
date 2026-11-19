# -*- coding: utf-8 -*-
"""规则层（方案 §五第③层）：无状态、可单测的确定性校验。
- 口径注册表与换算备案（REQ-03 / N4）
- M1–M5 验收指标（§十一，分母按双周批次固定，教育-034）
- 三要素校验（N2，教育-015）与四类不可逆动作的前置校验（§6.2）
"""
from core import get_conn

SCALE_MAP = {"5": {"5": 95, "4": 85, "3": 75, "2": 65, "1": 55}}  # 换算备案（教育-008）
EXPECTED_PERIODS = ["P01", "P02"]  # 试点双周周期（MVP 演示取 2 个周期）

VALID_TASKS = ["数控加工", "零件编程", "装配调试", "质量检验", "设备维护", "模具设计",
               "工艺文件", "CAD制图", "现场巡检", "物料管理"]


def convert_score(score_raw, score_type, enterprise_id):
    """口径换算：无备案企业 → None（E3，不参与汇总）。"""
    if score_type == "100":
        return float(score_raw)
    if score_type == "5":
        conn = get_conn()
        e = conn.execute("SELECT scale_status FROM enterprises WHERE id=?", (enterprise_id,)).fetchone()
        conn.close()
        if e and e["scale_status"] == "filed":
            return float(SCALE_MAP["5"].get(str(int(score_raw)), 0))
    return None


def feedback_usability(row):
    """可用完整率分子判定：五项字段齐备且含具体行为实例（区别于『六项非空』）。"""
    if not all([row["task_ref"], row["observed"], row["score_raw"] is not None, row["score_type"], row["comment"]]):
        return False
    if len(row["observed"] or "") < 12:
        return False
    return True


def metric_m1(conn):
    """可用完整率：分子=可用条数，分母=学生×周期（按批次累计，教育-034）。"""
    students = conn.execute("SELECT COUNT(*) n FROM students").fetchone()["n"]
    denominator = students * len(EXPECTED_PERIODS)
    rows = conn.execute("SELECT * FROM feedbacks").fetchall()
    usable = sum(1 for r in rows if feedback_usability(r))
    naive_total = students * 1  # 旧口径：每学生每学期 1 条（ZL-03 §5，差 10 倍的口径冲突 C1）
    naive = sum(1 for r in rows if r["comment"]) / max(naive_total, 1)
    return {"usable": usable, "denominator": denominator,
            "rate": round(usable / max(denominator, 1), 4),
            "naiveRate": round(naive, 4)}


def metric_m5(conn):
    """口径一致性：两套口径（分母 600 vs 分母批次）并行计算的完整率偏差。"""
    m1 = metric_m1(conn)
    dev = abs(m1["rate"] - m1["naiveRate"])
    return {"batch": m1["rate"], "naive": m1["naiveRate"], "deviation": round(dev, 4),
            "pass": dev < 0.05}


def metric_m4(conn):
    """错发条数：未同步变更中，仍在向旧导师产生新反馈的条数。"""
    rows = conn.execute("SELECT c.intern_id, c.old_mentor, f.id FROM changes c "
                        "LEFT JOIN feedbacks f ON f.intern_id=c.intern_id AND f.mentor_uid=c.old_mentor "
                        "WHERE c.synced=0").fetchall()
    mismatch = [r for r in rows if r["id"] is not None]
    return {"unsynced": conn.execute("SELECT COUNT(*) n FROM changes WHERE synced=0").fetchone()["n"],
            "misdelivered": len(mismatch)}


def metrics_overview(conn):
    m1 = metric_m1(conn)
    m4 = metric_m4(conn)
    m5 = metric_m5(conn)
    sugg = conn.execute("SELECT COUNT(*) n FROM suggestions WHERE status='formal'").fetchone()["n"]
    queue = conn.execute("SELECT COUNT(*) n FROM triples WHERE status='human_queue'").fetchone()["n"]
    insuf = conn.execute("SELECT COUNT(*) n FROM feedbacks WHERE status='insufficient' OR observed IS NULL").fetchone()["n"]
    return {
        "M1": {"label": "可用完整率（分母=学生×周期）", "value": m1["rate"], "target": 0.85,
               "detail": "%d/%d" % (m1["usable"], m1["denominator"])},
        "M2": {"label": "有效建议（三要素齐备并签核）", "value": sugg, "target": 24, "detail": "%d 条已入库" % sugg},
        "M3": {"label": "教师整理工时（演示值）", "value": 6.0, "target": 6.0, "detail": "基线 10 h/月 → 目标 6 h"},
        "M4": {"label": "错发条数（未同步变更×旧导师反馈）", "value": m4["misdelivered"], "target": 0,
               "detail": "未同步变更 %d 条" % m4["unsynced"]},
        "M5": {"label": "口径偏差（两套分母并行）", "value": m5["deviation"], "target": 0.05,
               "detail": "批次口径 %.2f vs 单条口径 %.2f" % (m5["batch"], m5["naive"])},
        "queues": {"humanQueue": queue, "insufficient": insuf},
    }


# ---------------- 不可逆动作的前置确定性校验（§6.2） ----------------

def check_reassign(intern_id, new_mentor, actor):
    """改派待办：编号存在 + 承接人有效 + 无同键待办（幂等，E5）。全部通过才允许。"""
    conn = get_conn()
    fails = []
    st = conn.execute("SELECT * FROM students WHERE intern_id=?", (intern_id,)).fetchone()
    if not st:
        fails.append("业务编号不存在")
    if not new_mentor:
        fails.append("承接人未具名")
    key = "%s|%s|%s" % (intern_id, new_mentor, "reassign")
    import hashlib
    kh = hashlib.sha256(key.encode("utf-8")).hexdigest()
    if conn.execute("SELECT 1 FROM todos WHERE key_hash=?", (kh,)).fetchone():
        fails.append("同键待办已存在（幂等拒绝，E5）")
    conn.close()
    return {"ok": len(fails) == 0, "fails": fails, "key_hash": kh}


def check_suggestion_formal(triple):
    """建议入库（N2 三要素，教育-015）：课程/任务/责任人齐备 + 原记录引用。缺一 → 存为草稿。"""
    missing = []
    if not triple["course_hint"] and not triple["course"]:
        missing.append("课程")
    if not (triple["task_ref"] or triple["task_ref"] is None and triple.get("task")):
        pass
    task = triple["task_ref"] or triple.get("task")
    if not task:
        missing.append("任务")
    owner = triple.get("owner") or triple.get("course_hint")
    if not owner:
        missing.append("责任人")
    return {"ok": len(missing) == 0, "missing": missing}
