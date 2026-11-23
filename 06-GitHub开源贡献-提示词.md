# 提示词：为指定 GitHub 仓库完成一次「文档同步」开源贡献（Issue + PR）

> 用途：把下面「提示词正文」整段复制给任意 AI 编码助手（WorkBuddy / Claude Code / Cursor 等），替换开头的两处占位符即可，让它自动完成「分析仓库 → 提交 Issue → Fork 分支 → 修改 → 发起 PR → 验证合并状态」的完整开源贡献流程。
>
> 占位符：
> - `{{目标仓库}}`：要贡献的仓库地址，例如 `https://github.com/Mireya-mm/talent-dispatch-1105`
> - `{{我的GitHub用户名}}`：例如 `ZhengyunCai`

---

## 一、提示词正文（复制以下全部内容使用）

```text
你是一名熟悉 GitHub 开源协作规范的开发者。请针对仓库 {{目标仓库}}
完成一次真实、可合并的开源贡献，全程不要使用占位内容或假数据。

【角色与目标】
你是该仓库的外部贡献者（GitHub 用户名：{{我的GitHub用户名}}，无直接写权限）。
目标：找出仓库文档与代码实现之间的不一致（文档漂移），
先提 Issue 报告问题，再通过 Fork + 分支 + Pull Request 的标准流程提交修复。

【第一步：仓库调研】
1. 阅读 README、docs/、示例配置与主要源码，梳理项目定位、运行方式与对外接口。
2. 逐条核对文档中的事实性陈述是否与代码一致，重点检查：
   - 统计数字（如断言/测试数量、覆盖率、接口条数）是否与实际代码相符；
   - 功能清单是否遗漏了已实现的新模块/新阶段；
   - 启动命令、依赖版本、环境变量说明是否可执行；
   - 接口表、参数表与实际路由/函数签名是否一致。
3. 把每处不一致整理成清单：文档原句 → 代码事实 → 建议改法。

【第二步：提交 Issue】
1. 先检查仓库 .github/ISSUE_TEMPLATE/ 是否有现成模板；
   文档类问题优先选 Documentation 模板，功能缺失选 FeatureRequest，
   运行报错选 BugReport；若模板缺失，则按「问题描述 / 复现步骤 /
   期望行为 / 实际行为 / 环境信息」结构自拟。
2. Issue 标题一句话说清问题；正文列出不一致清单（可附证据：文件路径、行号、
   代码片段）；语气客观礼貌，不指责原作者。
3. 记录 Issue 编号（如 #1），后续 PR 描述中用 `Closes #N` 关联。

【第三步：Fork 并提交修复】
1. Fork 仓库到 {{我的GitHub用户名}} 名下，从默认分支切出功能分支，
   分支名规范：文档类 `docs/<主题>`、缺陷修复 `fix/<主题>`、功能 `feat/<主题>`。
2. 只修改与 Issue 相关的文件，保持最小 diff；不要重排版、不改动无关行。
3. 修改 README 等文档时保持原有结构与语气，新增内容遵循已有小节样式。
4. 提交信息用 Conventional Commits：
   - 文档：`docs: sync README with dev-stage4 implementation (+52/-16)`
   - 工程：`chore: add issue/PR templates for community workflow`
5. 推送分支，向原仓库发起 Pull Request：
   - 标题概括改动；描述中写明「改动内容 / 关联 Issue（Closes #N）/ 自测方式」；
   - 若仓库有 PR 模板，按模板逐项填写。

【第四步：验证与交付】
1. 核对 PR 页面：diff 仅包含预期文件、状态为可合并（clean / no conflicts）；
   提交作者为 {{我的GitHub用户名}}。
2. 输出最终交付清单：
   - Issue 链接；
   - PR 链接、分支名、每笔 commit 的哈希与说明；
   - diff 统计（如 +52/-16）；
   - 「在她仓库可见的上传记录」确认截图或链接
     （Issue 列表、PR 列表、PR 文件变更页、Contributors 记录）。

【执行约束】
- 优先用本地 git；若环境无法写入 fork 的引用（如沙箱限制只读），改用
  GitHub REST API 兜底：blob → tree → commit → 更新 refs/heads/<分支> →
  创建 pull。API 需携带用户提供的 PAT，权限至少包含 repo 写 fork 的范围。
- 上传文件内容为多行文本时，先统一为 LF 换行（CRLF 会造成整文件 diff）。
- 无仓库维护权限时，无法给 Issue 打标签，不要假装打标签成功。
- 不伪造任何执行结果；每一步失败都要报告真实错误并给出替代方案。
```

---

## 二、提示词设计要点（写作业报告时可以引用）

| 设计点 | 说明 |
| --- | --- |
| 角色设定 | 明确「外部贡献者」身份，让 AI 走 Fork + PR 路线而非直接 push |
| 事实核对导向 | 要求逐条核对「文档原句 → 代码事实 → 建议改法」，避免泛泛而谈 |
| 模板驱动 | 强制先检查 `.github/ISSUE_TEMPLATE/`，Documentation 问题选对应模板 |
| 关联闭环 | Issue 用 `Closes #N` 关联 PR，体现开源协作闭环 |
| 分支与提交规范 | `docs/` `fix/` `feat/` 前缀 + Conventional Commits |
| 最小 diff 原则 | 只改相关文件、统一 LF 换行，降低被拒概率 |
| 真实性约束 | 禁止伪造标签、合并状态等结果，失败必须如实报告 |
| API 兜底路径 | 沙箱只读环境下给出 GitHub API 的完整提交流程，保证任务可完成 |

## 三、本次按该提示词产出的真实示例

- 目标仓库：`https://github.com/Mireya-mm/talent-dispatch-1105`
- Issue（Documentation 模板）：https://github.com/Mireya-mm/talent-dispatch-1105/issues/1
- Pull Request（状态 clean，等待维护者合并）：https://github.com/Mireya-mm/talent-dispatch-1105/pull/2
- Fork 分支：`ZhengyunCai/talent-dispatch-1105@docs/readme-sync-dev-stage4`
- 提交记录：`732cfa5`（docs: sync README with dev-stage4 implementation）、`6cc43a6`（chore: add issue/PR templates）
- diff 统计：README 同步 +52/-16，另新增 4 个 issue 模板与 1 个 PR 模板
