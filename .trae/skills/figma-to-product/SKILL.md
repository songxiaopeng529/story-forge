---
name: figma-to-product
description: 高保真 Figma-to-code 实现工作流，用于将 Figma 画板或节点 URL 还原为可交互、可运行的产品页面。当需要在 React/Vite/TypeScript/Tailwind 或其他前端栈中重建 Figma 设计稿，并且用户期望像素级精度、来自 Figma 的图标/资源、详细的样式 token、贴合业务的 mock 数据、交互文档、截图比对、以及反复打磨直至与设计稿一致时使用本 skill。
---

# Figma To Product

使用本 skill 把 Figma 画板实现为高保真、可交互、可运行的产品页面。把截图作为视觉参考，但把 Figma 节点数据作为具体样式值的唯一可信来源。

## 核心原则

不要用肉眼去猜 Figma 本身就能给出的细节。高分辨率截图用于理解布局、业务含义和交互；颜色、字号、行高、圆角、描边、阴影、图标几何、间距、尺寸等具体取值，应来自 Figma 设计上下文与变量。

## Coding Gate（实现前置门禁）

在以下条件全部完成之前，不要开始编码：

1. 已抓取目标节点的 Figma 资源：metadata、设计上下文、变量、截图、高分辨率导出图，以及任何需要的素材资源。
2. 已识别并按需抓取视觉敏感的子节点：表格、分页、下拉、筛选、Tab、图标、Tag、图表、卡片、行状态、汇总行等。
3. 已基于已抓取资源写好交互/规格文档。
4. 用户已确认交互/规格文档，或用户明确表示无需确认直接开始。

即使待实现区域看起来"静态"，本门禁同样适用。表格、分页、筛选项、选中态、可展开行、图表图例、纯图标控件以及数据汇总，常常隐含交互或精确尺寸要求。如果用户要求做一次紧急或纯视觉的修补，请先显式声明跳过了哪一步门禁，并把改动限定在最小范围内。

## Workflow

1. **建立工作目录**
   - 在**项目根目录**下创建 `.figma-to-product/work/figma-<node-id>/`，**不要**把工作产物放到 skill 目录（`.trae/skills/figma-to-product/`）下面。
   - skill 目录只存放工作流文档与脚本，本身应当对所有项目通用，不应被某次任务的产物污染。
   - 把原始 Figma 响应、高清截图、下载的资源、样式笔记、产品截图、交互文档都放在这里。
   - 该目录路径已加入项目 `.gitignore`，产物不会被纳入版本控制；如需共享，单独把 `docs/spec.md` 等关键文档拷贝到代码仓库内。

2. **编码前先抓取 Figma 上下文**
   - 对目标节点抓取 metadata、设计上下文、变量与截图。
   - 如果根节点过大，根据 metadata 找到关键子节点逐个抓取。
   - 为所有影响精度的组件构建 `style-nodes/` 库：筛选项、Tab、卡片、表格、图表、图例、汇总行、图标。
   - 使用 `scripts/fetch_figma_style_nodes.py` 批量抓取组件节点到 `style-nodes/<component>/raw` 并附带截图。
   - 抓取流程详见 `references/figma-data-workflow.md`。

3. **导出高分辨率图**
   - 通过 Figma 图片导出 API，对整个画板及关键子节点导出 3 倍或 4 倍图。
   - 这些图用于全局理解：分区边界、内容层级、业务逻辑、mock 数据形态。
   - 不要仅凭高清图反推具体颜色或间距。
   - 使用 `scripts/fetch_figma_highres.py` 调用 Figma Images API 下载 PNG。

4. **从 Figma 提取素材**
   - 通过 Figma MCP `get_design_context` 拿到的 asset URL 获取图标与 SVG。
   - 当 Figma 已提供本地素材链接时，不要手动重画图标。
   - 当运行时依赖本地 MCP 素材服务会变得脆弱时，把素材下载进项目。
   - 使用 `scripts/extract_asset_urls.py` 从已保存的 Figma JSON 中列出素材链接。

5. **先写交互文档**
   - 这是必需的实现门禁，不是可选笔记。
   - 在编码前写好交互/规格文档，并请用户确认。
   - 记录锚点、筛选、级联规则、选中态、影响区域、可展开行、图表行为以及 mock 数据的业务前提。
   - 对表格与列表模块，记录列宽、行高、截断/换行规则、滚动行为、分页行为、每页条数选择器行为、空态/加载态，以及数据是否随筛选变化。
   - 对纯图标或小型控件，记录节点盒子、可见素材尺寸、viewBox、内边距、点击区域、hover/disabled 状态以及素材精确来源。
   - 以 `references/interaction-spec-template.md` 作为初始结构。

6. **按真实前端行为实现**
   - 使用项目现有的技术栈与约定实现页面。
   - 使用反映 UI 业务含义的 mock 数据，而不是 lorem ipsum 占位。
   - 严格保持已确认的交互范围。如果只有部分 UI 在范围内，把范围外内容显式删除或打桩。

7. **建立 Figma 样式映射表**
   - 对每个关键组件抓取确切的 Figma 子节点样式并写成样式映射。
   - 包含字体、颜色、尺寸、内边距、间距、圆角、描边、阴影与素材 ID。
   - 使用 `references/style-map-template.md`。
   - 不要止步于根截图。高精度实现需要组件级别的样式证据库。

8. **运行自动化视觉验证**
   - Figma 端截图来自 MCP / `fetch_figma_highres.py`；产品页截图统一通过 **browser-use** 抓取。两端必须保持相同视口与 DPR。
   - 先运行截图 diff 脚本（`compare_screenshots.py`）；把它当作视觉的最终判官，因为它检查的是最终渲染像素。
   - 当需要源码级修复线索时，再用 browser-use 抽取目标区域的 DOM 视觉树，并跑 Figma-vs-DOM 比对（`compare_figma_dom.py`）。
   - 截图 diff 对小型控件不够。对分页箭头、chevron、Tag、表头、行分隔线、选中指示器等少像素但视觉上明显的元素，再做定向裁剪或 DOM/样式校验。
   - 命令与报告解读详见 `references/visual-diff-workflow.md`。

9. **以截图比对反复迭代**
   - 每次有意义的改动后，抓取本地截图、与 Figma 导出图比对。
   - 列出具体差异，逐项修复，反复执行。
   - 不要只凭实现意图就声称已对齐。
   - 完成前查阅 `references/precision-pass-checklist.md`。

## 自动化视觉验证脚本

把内置脚本作为可重复执行的精度通过性测试：

- `scripts/fetch_figma_highres.py`：调用 Figma Images API 下载 PNG（设计端截图来源）。
- `scripts/fetch_figma_style_nodes.py`：批量抓取 Figma 子节点 JSON 与截图，构建样式证据库。
- `scripts/compare_screenshots.py`：比对 Figma 截图与产品截图，输出 `diff.png`、`annotated-diff.png`、`report.json`、`report.md`。
- `scripts/compare_figma_dom.py`：把归一化的 Figma 节点与产品页 DOM 视觉树比对，给出选择器与样式修复线索。
- `scripts/generate_visual_report.py`：把截图报告与 Figma/DOM 报告合并为一份面向 agent 的精度报告。
- `scripts/cdp_screenshot.py`：当 browser-use CLI 失效时的兜底，直接通过 Chrome DevTools Protocol 给指定 tab 截图。前提：Chrome 已带 `--remote-debugging-port=9222` 启动，启动方式见 `references/browser-use-setup.md`。

重要：截图 diff 是最终视觉判官。Figma/DOM 比对是定位与解释的辅助手段，特别是组件库、portal、wrapper 与自定义样式覆盖会导致 DOM 结构与 Figma 节点结构不一致时。

重要：整段截图 diff 容易低估那些"小但明显"的问题，例如 chevron 过大、图标过大、Tag 内边距异常、表头单词换行等。对这类问题，要么做定向裁剪，要么把 DOM 计算尺寸与 Figma 节点尺寸做点对点比对，再判定实现是否完成。

## 截图来源（两种方案，分工明确）

本 skill **刻意不再内置 Playwright 截图脚本**，避免依赖与登录态问题。两端截图按以下方式获取：

### 1. Figma 端：脚本 + MCP

- 优先使用 Figma MCP（`mcp_Figma_AI_Bridge_get_figma_data` / `mcp_Figma_AI_Bridge_download_figma_images`）抓取节点上下文与高清 PNG/SVG。
  - 适合：交互式的逐节点抓取、按需下载图标资源。
- 当需要批量按 file key + node id 拉 4× / 3× 高清图时，使用脚本 `scripts/fetch_figma_highres.py`（依赖 `FIGMA_TOKEN` 环境变量）。
- 当需要构建组件级样式证据库时，使用 `scripts/fetch_figma_style_nodes.py`，把样式相关子节点统一拉到 `style-nodes/<component>/raw`。

### 2. 产品页端：browser-use

- 产品页面通常需要登录态（如 `https://rmp.bytedance.net`），且本地启动成本高。统一使用 **browser-use** 工具来：
  - 打开 URL（沿用浏览器现有登录态/cookie）
  - 等待页面加载稳定（可滚动到目标区块、关闭浮层）
  - 截图保存到 `<project-root>/.figma-to-product/work/figma-<node-id>/product/screenshot.png`
  - 必要时同时抽取目标元素的 DOM 视觉树（包围盒、计算样式、`data-design-id`），保存到 `<project-root>/.figma-to-product/work/figma-<node-id>/product/dom-visual-tree.json`
- 截图与 DOM 抽取的视口与 DPR 必须与 Figma 高清图保持一致（默认 1440×900 DPR=1，与 `compare_screenshots.py --design-scale 4` 配合）。
- **首次在本机使用 / 出现任何启动或会话报错**：先按 [references/browser-use-setup.md](./references/browser-use-setup.md) 跑一遍安装与启动流程，里面沉淀了 macOS 上 `--remote-debugging-port` 启动、user-data-dir 选址、TCC 保护、`open -na` 参数被吞、Session 报错等所有已踩过的坑。
- 详细的 browser-use 调用步骤、视口/等待/裁剪规则，见 [references/visual-diff-workflow.md](./references/visual-diff-workflow.md)。

> 不要再尝试在本机用 Playwright / Puppeteer 自动跑产品截图——本 skill 的 `scripts/` 已不提供该能力。如果环境完全没有 browser-use，把产品截图作为"用户提供"的输入处理：让用户手动截图并放到 `<project-root>/.figma-to-product/work/figma-<node-id>/product/screenshot.png`，比对脚本不变。

> **CLI 兜底**：当 `browser-use` CLI 因为 macOS TCC 保护写不了 `~/.browser-use/default.state.json`、或因为 session 配置漂移而无法工作时，使用 [scripts/cdp_screenshot.py](./scripts/cdp_screenshot.py) 直连 Chrome DevTools Protocol 截图。前提是 Chrome 已带 `--remote-debugging-port=9222` 启动；具体启动方式见 [references/browser-use-setup.md](./references/browser-use-setup.md)。
>
> **从 URL 到稳定截图的完整流程**（健康检查 → `PUT /json/new` 开 tab → 等待 → 截图 → 体积稳定判定）见 [references/browser-use-setup.md §6.1](./references/browser-use-setup.md#61-完整截图流程实战版)。该节包含一个可直接复制运行的整合脚本，是当前实战首选路径。

## 常见踩坑

- 用了 Figma 素材却以错误的视觉尺寸渲染。要同时检查节点盒子与素材 viewBox；可见图形可能小于节点，也可能内部溢出。
- 把 Figma 生成的 Tailwind 原样照抄。应当把它当作设计证据，再适配到项目自己的组件与 token。
- 大版型对了但小细节错：图标尺寸、行高、分隔线透明度、选中态描边宽度、行高、分段间距。
- 把表格、分页栏、筛选项或选择器当成静态而未先确认交互与尺寸规则。
- 只看整段 diff 分数，错过明显的小组件问题，例如表头换行或下拉箭头过大。
- 让一个被选中的卡片影响了过多区域。先确认交互合约再连状态。
- 留下 Figma 范围外的临时图例、占位文案或未启用的控件。

## Verification（完成前的验证）

在汇报完成前：

- 跑项目可用的测试命令。
- 跑生产构建或类型检查。
- 用 browser-use 抓取产品页截图（与 Figma 同视口、同 DPR）。
- 用 `compare_screenshots.py` 与 Figma 高清导出图比对，并总结剩余视觉差距。
- 链接保存的截图与相关文档。

如果 Figma 信息不足，明确列出缺什么：节点访问权限、素材 URL、样式取值、状态变体、截图裁剪、或交互行为。
