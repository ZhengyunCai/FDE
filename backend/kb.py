# -*- coding: utf-8 -*-
"""知识库模块：Wiki 页 + RAG 检索 + LLM 抽取层（可切换在线/离线）。
对应技术方案 §五第④层（模型层）与 §七（模型职责与边界）。
模型只做「抽取与草稿」这一件窄事；置信度 <0.6 一律转人工队列（教育-032）。
"""
import json
import os
import re
from pathlib import Path

SEED = Path(__file__).resolve().parent / "seed"

# ---------------- 知识库文档（facts + characters + wiki 页） ----------------

def load_kb_docs():
    docs = []
    facts = json.load(open(SEED / "facts.json", encoding="utf-8"))
    for f in facts:
        docs.append({
            "kind": "fact",
            "title": "%s（%s · %s）" % (f["code"], f["character"], f["topic"]),
            "code": f["code"],
            "text": "%s。需求：%s 验收：%s" % (f["text"], f.get("requirement", ""), f.get("acceptance", "")),
        })
    wiki = json.load(open(SEED / "wiki.json", encoding="utf-8"))
    for p in wiki["pages"]:
        docs.append({"kind": "wiki", "title": p["title"], "code": p["code"], "text": p["body"], "slug": p["slug"]})
    chars = json.load(open(SEED / "characters.json", encoding="utf-8"))
    for c in chars:
        docs.append({"kind": "wiki", "title": "角色档案：%s（%s）" % (c["name"], c["role"]),
                     "code": "访谈", "text": "%s 关注：%s" % (c["intro"], c["focus"])})
    return docs

KB_DOCS = load_kb_docs()

# ---------------- 中文检索（字符 bigram + 词加权，纯 Python 无依赖） ----------------

_WORD_RE = re.compile(r"[a-zA-Z0-9]+")

def tokenize(text):
    text = text.lower()
    toks = set(_WORD_RE.findall(text))
    han = re.sub(r"[^\u4e00-\u9fff]", "", text)
    for i in range(len(han)):
        toks.add(han[i])
        if i + 1 < len(han):
            toks.add(han[i:i + 2])
    return toks

_DOC_TOKS = [tokenize(d["title"] + " " + d["text"]) for d in KB_DOCS]

def rag_search(query, top_k=5):
    qt = tokenize(query)
    if not qt:
        return []
    scored = []
    for i, dt in enumerate(_DOC_TOKS):
        inter = len(qt & dt)
        if inter == 0:
            continue
        # 命中率 × 标题命中加成
        title_hit = len(qt & tokenize(KB_DOCS[i]["title"]))
        score = inter / (len(qt) ** 0.5) + title_hit * 0.8
        scored.append((score, i))
    scored.sort(reverse=True)
    out = []
    for score, i in scored[:top_k]:
        d = KB_DOCS[i]
        out.append({"score": round(score, 3), "kind": d["kind"], "title": d["title"],
                    "code": d.get("code", ""), "text": d["text"], "slug": d.get("slug")})
    return out

def kb_ask(query):
    """检索式问答：返回带引用编号的答案。在线 LLM 可用时走 llm_complete，否则离线组装。"""
    hits = rag_search(query, top_k=6)
    if not hits:
        return {"answer": "知识库中没有检索到相关内容。请换一个说法，或补充关键词（如：换岗、口径、完整率、权限、停止条件）。",
                "citations": []}
    codes = [h["code"] for h in hits if h["code"]]
    lines = ["根据知识库检索到 %d 条相关记录（%s）：" % (len(hits), "、".join(dict.fromkeys(codes[:4])))]
    for h in hits[:4]:
        lines.append("· 【%s】%s" % (h["title"], h["text"][:160]))
    if any(k in query for k in ("换岗", "错发", "导师")):
        lines.append("处置：变更未办结 → 待办挂起（N3 改派确认，承接人具名），错发 = 0 为硬指标。")
    elif any(k in query for k in ("完整率", "分母", "口径")):
        lines.append("处置：分母按学生 × 双周批次累计；五分制换算未备案的企业不参与汇总。")
    elif any(k in query for k in ("权限", "越权", "成绩")):
        lines.append("处置：跨企业个体评价不可见；成绩写入接口不存在，越权尝试直接拒绝并留痕。")
    ans = llm_complete(query, [h["text"] for h in hits]) if llm_available() else "\n".join(lines)
    return {"answer": ans, "citations": [{"title": h["title"], "code": h["code"]} for h in hits]}

# ---------------- LLM 层（离线抽取器为默认实现，可切在线 API） ----------------

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "offline")  # offline | openai
PROMPT_VERSION = "prompt_v1.0-mvp"

def llm_available():
    if LLM_PROVIDER == "openai" and os.environ.get("OPENAI_API_KEY"):
        return True
    return False

def llm_complete(prompt, contexts):
    """在线路径：脱敏上下文 + JSON 输出约束。沙箱默认离线，此分支仅在配置密钥时启用。"""
    if not llm_available():
        raise RuntimeError("LLM not configured")
    try:
        import urllib.request
        body = json.dumps({
            "model": os.environ.get("LLM_MODEL", "gpt-4o-mini"),
            "messages": [
                {"role": "system", "content": "你是实习反馈抽取助手。只依据给定上下文回答，输出 JSON："
                                              "{\"answer\":\"...\"}。禁止输出学生分数、能力标签或对外文本。"},
                {"role": "user", "content": "问题：%s\n上下文：%s" % (prompt, " || ".join(contexts)[:4000])},
            ],
            "temperature": 0.2,
        }).encode("utf-8")
        req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=body,
                                     headers={"Content-Type": "application/json",
                                              "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
        return json.loads(data["choices"][0]["message"]["content"]).get("answer", "")
    except Exception:
        return "\n".join("· " + c[:160] for c in contexts[:4])

# ---------------- 三元组抽取器（方案 §七输出 schema 的离线实现） ----------------

TASK_LIST = ["数控加工", "零件编程", "装配调试", "质量检验", "设备维护", "模具设计",
             "工艺文件", "CAD制图", "现场巡检", "物料管理"]

ACTION_WORDS = ["完成", "加工", "编写", "调试", "装配", "检验", "维护", "巡检", "编程",
                "绘制", "提交", "操作", "沟通", "汇报", "延迟", "遗漏", "出现", "差错", "报废", "返工"]

GAP_TEMPLATES = [
    (["沟通", "汇报", "主动"], "沟通汇报不足", "建议该生在组内每周做 1 次进度口头汇报，并由导师在双周评价中追踪。"),
    (["熟练", "生疏", "缓慢", "效率"], "操作熟练度不足", "建议安排导师带教 2 周，指定标准作业指导书（SOP）并复检工位。"),
    (["报告", "文档", "记录", "填写"], "过程文档缺失", "建议补齐过程记录模板，随日报提交，教务在下一周期校验。"),
    (["差错", "报废", "返工", "超差"], "加工质量不稳定", "建议复盘首件检验流程，该任务增加自检+互检环节。"),
    (["延迟", "延期", "超期"], "任务进度延迟", "建议核对任务排期，责任人在周例会上同步进度与堵点。"),
]

def extract_triple(comment, task_hint=""):
    """评语 → 三元组。输出 schema 与方案 §七一致，附原文区间与置信度。
    置信度 <0.6 → status=human_queue（停止条件，教育-032）；
    无行为实例 → insufficient_evidence（教育-004/E2）。"""
    res = {"task_ref": None, "observed_behavior": None, "gap": None, "suggestion": None,
           "course_hint": None, "confidence": 0.0, "span": None, "status": "insufficient_evidence"}

    # 1) 岗位任务：优先人工提交的 task_hint，其次评语内命中任务枚举
    task = None
    if task_hint and task_hint in TASK_LIST:
        task = task_hint
    else:
        for t in TASK_LIST:
            if t in comment or t.replace("调试", "") in comment:
                task = t
                break
    res["task_ref"] = task

    # 2) 行为实例：含行为词且 >=12 字的首个句子
    sents = re.split(r"[。；;！!？?\n]", comment)
    observed, span = None, None
    for s in sents:
        s = s.strip()
        if len(s) < 12:
            continue
        if any(w in s for w in ACTION_WORDS) and not _is_pure_adjective(s):
            idx = comment.find(s)
            observed, span = s, [idx, idx + len(s)]
            break
    res["observed_behavior"] = observed
    res["span"] = span

    if observed is None:
        res["confidence"] = 0.3
        return res  # insufficient_evidence：不进 M1 分子，退回补写（E2）

    # 3) 差距与建议（模板匹配，等价于离线草稿生成）
    gap, suggestion = "待人工归类", "待人工补充建议"
    for kws, g, s in GAP_TEMPLATES:
        if any(k in comment for k in kws):
            gap, suggestion = g, s
            break
    res["gap"], res["suggestion"] = gap, suggestion

    # 4) 课程候选映射（任务 → 课程，对应 REQ-06）
    course_map = {"数控加工": "数控加工实训", "零件编程": "数控编程", "装配调试": "机械装配实训",
                  "质量检验": "公差与测量技术", "设备维护": "设备维护与管理", "模具设计": "模具设计基础",
                  "工艺文件": "机械制造工艺", "CAD制图": "机械CAD", "现场巡检": "生产实习", "物料管理": "生产管理"}
    res["course_hint"] = course_map.get(task)

    # 5) 置信度（方案设定阈值 0.6）
    conf = 0.6
    if task and task_hint == task:
        conf += 0.15
    elif task:
        conf += 0.08
    if len(observed) >= 20:
        conf += 0.05
    res["confidence"] = round(min(conf, 0.95), 2)
    res["status"] = "auto" if res["confidence"] >= 0.6 else "human_queue"
    return res

_ADJ = ["很好", "较差", "优秀", "良好", "合格", "不合格", "不足", "较强", "较弱", "不错", "一般"]

def _is_pure_adjective(s):
    """纯评价形容词（如『沟通能力不足』）不算行为实例（教育-004）。"""
    core = re.sub(r"[的了很也]", "", s)
    return len(core) <= 14 and any(a in s for a in _ADJ) and not any(w in s for w in
        ["完成", "加工", "编写", "调试", "装配", "检验", "提交", "出现", "报废", "返工", "延迟"])
