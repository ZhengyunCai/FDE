# -*- coding: utf-8 -*-
"""把模板、种子数据与三段脚本拼成一个自包含 HTML。"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
SEED = ROOT / "seed"

facts = json.load(open(SEED / "facts.json", encoding="utf-8"))
wiki = json.load(open(SEED / "wiki.json", encoding="utf-8"))
chars = json.load(open(SEED / "characters.json", encoding="utf-8"))

facts_min = [{
    "code": f["code"], "topic": f["topic"], "text": f["text"],
    "requirement": f.get("requirement", ""), "acceptance": f.get("acceptance", ""),
    "character": f["character"], "role": f["role"], "evidenceType": f.get("evidenceType", ""),
} for f in facts]
chars_min = [{"name": c["name"], "role": c["role"], "focus": c.get("focus", ""), "intro": c.get("intro", "")} for c in chars]
seed = {"facts": facts_min, "wiki": {"pages": wiki["pages"]}, "chars": chars_min}
seed_json = json.dumps(seed, ensure_ascii=False, separators=(",", ":"))

head = (BASE / "tpl_head.html").read_text(encoding="utf-8")
core = (BASE / "tpl_core.js").read_text(encoding="utf-8")
harn = (BASE / "tpl_harness.js").read_text(encoding="utf-8")
ui = (BASE / "tpl_ui.js").read_text(encoding="utf-8")

html = (
    head
    + "\n<script>const SEED=" + seed_json + ";</script>\n"
    + "<script>\n" + core + "\n" + harn + "\n" + ui + "\n</script>\n"
    + "<script>window.addEventListener('DOMContentLoaded',function(){document.getElementById('uPwd').value='admin123';});</script>\n"
    + "</body>\n</html>\n"
)
out = BASE / "fde-mvp-demo.html"
out.write_text(html, encoding="utf-8")
print("written", out, len(html), "bytes")
