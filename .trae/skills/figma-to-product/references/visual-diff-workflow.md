# 自动化视觉 Diff 工作流

## Table of Contents

- [目录布局](#目录布局)
- [1. 抓取产品截图（browser-use）](#1-抓取产品截图browser-use)
- [2. 跑截图 Diff](#2-跑截图-diff)
- [3. 抽取 DOM 视觉树（browser-use）](#3-抽取-dom-视觉树browser-use)
- [4. 跑 Figma/DOM 定位 Diff](#4-跑-figmadom-定位-diff)
- [5. 合并报告](#5-合并报告)
- [Agent 修复循环](#agent-修复循环)
- [局限](#局限)

精度通过性测试时使用本工作流。它把"截图 diff"与"Figma/DOM 比对"结合：

- 截图 diff 检查最终渲染结果，是视觉的最终判官。
- Figma/DOM 比对提供选择器、计算样式与可能的修复目标。

> 设计端截图来自 Figma MCP / `scripts/fetch_figma_highres.py`；产品端截图统一通过 **browser-use** 抓取。本 skill 不再内置 Playwright 截图脚本，避免依赖 / 登录态问题。

## 目录布局

把所有产物放在**项目根目录下的 `.figma-to-product/work/figma-<node-id>/`** 内（已加入 `.gitignore`）。**不要**写到 skill 自身目录（`.trae/skills/figma-to-product/`）下，skill 应保持对项目无侵入。

```text
<project-root>/.figma-to-product/work/figma-<node-id>/
├── figma-api/highres/
├── product/
│   ├── screenshot.png
│   ├── screenshot.json          # 视口、DPR、URL、时间戳等元数据（手填即可）
│   └── dom-visual-tree.json     # 可选，由 browser-use 生成
└── visual-diff/
    ├── diff.png
    ├── annotated-diff.png
    ├── report.json
    ├── report.md
    ├── figma-dom-report.json
    ├── figma-dom-report.md
    └── precision-report.md
```

下文示例为简洁起见，统一使用相对路径 `.figma-to-product/work/figma-<node-id>/...`，运行命令时假设你已 `cd` 到项目根。

## 1. 抓取产品截图（browser-use）

每轮使用相同的视口。除非 Figma 导出与产品截图都刻意使用高 DPR，否则优先用 DPR 1。

调用 browser-use 时，按以下流程组织指令（具体调用接口以当前会话可用工具为准；下面是给 agent 的"指令模板"）：

1. **打开 URL**：传入产品页 URL（例如 `https://rmp.bytedance.net/punishment_report?collapsed=1`）。沿用浏览器现有登录态。
2. **设置视口**：`width=1440 height=900 deviceScaleFactor=1`（与 `compare_screenshots.py --design-scale 4` 配合）。
3. **等待页面稳定**：等待 `networkidle` 或目标区块的关键选择器出现，再额外等待 500ms 让懒加载完成。
4. **关闭遮挡**：如果有引导浮层、消息气泡，先关闭。
5. **滚动定位**：滚到目标区块（可按 `id`、`data-design-id` 或文本定位）。
6. **截图**：
   - 整页：`fullPage=true`
   - 区块：把视口对齐到目标区块顶部，截可视区
   - 输出到 `.figma-to-product/work/figma-<node-id>/product/screenshot.png`
7. **写元数据**：URL、视口、DPR、滚动位置、时间戳写到 `.figma-to-product/work/figma-<node-id>/product/screenshot.json`，便于复现。

如果当前 browser-use 工具不可用：
- 优先尝试 **CDP 直连兜底脚本**：`scripts/cdp_screenshot.py`。前提是 Chrome 已带 `--remote-debugging-port=9222` 启动，方式见 [browser-use-setup.md](./browser-use-setup.md)。
  ```bash
  uvx --with httpx --with websockets python \
    .trae/skills/figma-to-product/scripts/cdp_screenshot.py \
    "<URL 子串>" \
    ".figma-to-product/work/figma-<node-id>/product/screenshot.png"
  ```
- 若连 Chrome 调试端口都起不来，再让用户手动截图并放到上述路径，比对脚本不变。
- 不要回退到本地 Playwright/Puppeteer——本 skill 的 `scripts/` 已不提供该能力，且产品页通常需要登录态。

如果 browser-use CLI 报 `Session 'default' is already running with different config` 或
`Operation not permitted: ~/.browser-use/default.state.json`：
- 这是 macOS TCC 保护和 CLI session 状态机的已知问题。**不要反复 `browser-use close`**，
  改用上面的 CDP 直连脚本。详细排障表见 [browser-use-setup.md](./browser-use-setup.md) §5。

## 2. 跑截图 Diff

如果 Figma 导出是 4 倍图，用 `--design-scale 4` 在 CSS 像素层面比对：

```bash
python /path/to/figma-to-product/scripts/compare_screenshots.py \
  --design .figma-to-product/work/figma-<node-id>/figma-api/highres/<frame>-4x.png \
  --product .figma-to-product/work/figma-<node-id>/product/screenshot.png \
  --design-scale 4 \
  --threshold 12 \
  --out-dir .figma-to-product/work/figma-<node-id>/visual-diff
```

如果 Figma 图是分区导出，而产品截图是整页，先把产品截图裁到相同视觉区域再比对：

```bash
python /path/to/figma-to-product/scripts/compare_screenshots.py \
  --design .figma-to-product/work/figma-<node-id>/figma-api/highres/<section>-4x.png \
  --product .figma-to-product/work/figma-<node-id>/product/screenshot.png \
  --design-scale 4 \
  --product-crop 48,184,1524,757 \
  --threshold 12 \
  --out-dir .figma-to-product/work/figma-<node-id>/visual-diff
```

当两张图内容相同但需要刻意做相对位移时，使用 offset：

```bash
  --design-offset 0,0 --product-offset 12,-4
```

裁剪值 `x,y,width,height` 使用源图自身像素，且发生在缩放之前。偏移值 `x,y` 使用缩放之后的 CSS 像素。

报告解读：

- `annotated-diff.png` 是产品截图叠加高亮变更区域。
- `report.json` 是结构化的 Agent 可读报告。
- `score` 是粗略的视觉相似度信号，不是产品质量分。
- 大区域通常意味着布局、间距、缺失容器或页面尺寸不匹配。
- 如果整页几乎都被高亮，先检查视口、DPR、滚动位置、裁剪与偏移，再去改实现。
- 小区域通常是图标、文字、圆角、描边、阴影或抗锯齿差异。

## 3. 抽取 DOM 视觉树（browser-use）

需要选择器、样式或组件库覆盖等修复线索时，使用 browser-use 抽取目标区域的可见 DOM 元素与计算样式：

1. 打开同一个 URL，沿用同一视口与 DPR。
2. 滚到目标区块。
3. 通过 browser-use 执行评估脚本（或类似的"读取 DOM 元素 + 计算样式"接口），采集：
   - 元素 `tagName`、`role`、`data-design-id`、`data-testid`、`textContent`
   - `getBoundingClientRect()` 包围盒（视口坐标）
   - 关键 `getComputedStyle()` 字段：`color / backgroundColor / fontSize / lineHeight / fontWeight / borderRadius / borderColor / borderWidth / boxShadow / paddingTop/Right/Bottom/Left / marginTop/Right/Bottom/Left / display / position`
4. 输出 JSON 到 `.figma-to-product/work/figma-<node-id>/product/dom-visual-tree.json`。结构示例：

```json
{
  "viewport": { "width": 1440, "height": 900, "dpr": 1 },
  "url": "...",
  "elements": [
    {
      "selector": "[data-design-id='red-rank-pagination']",
      "role": null,
      "tag": "div",
      "text": "1/5",
      "rect": { "x": 1320, "y": 612, "width": 84, "height": 22 },
      "style": { "color": "rgba(5,12,35,0.42)", "fontSize": "14px", "lineHeight": "22px" }
    }
  ]
}
```

> DOM 视觉树刻意忽略原始 DOM 等价性。它采集可见元素、包围盒、文本、角色与计算样式，为下一步 Figma/DOM 匹配提供输入。

## 4. 跑 Figma/DOM 定位 Diff

可以传入一份或多份 Figma JSON。脚本接受 Figma API JSON 或 MCP 设计上下文 JSON，只要节点包含包围盒与样式字段即可。

```bash
python /path/to/figma-to-product/scripts/compare_figma_dom.py \
  --figma-json .figma-to-product/work/figma-<node-id>/raw/design-context.json \
  --dom-json .figma-to-product/work/figma-<node-id>/product/dom-visual-tree.json \
  --out-dir .figma-to-product/work/figma-<node-id>/visual-diff
```

匹配优先级：

1. `data-design-id` 等于 Figma 节点 id 或 name。
2. 文本 / 角色匹配。
3. 位置与尺寸接近度。

对关键元素，建议在产品代码中显式打标记：

```tsx
<Button data-design-id="create-risk-button">创建风险</Button>
```

这能让报告在使用 Semi UI 等组件库（一个 Figma 节点常常对应多个 DOM 节点）时更稳定，也能让 browser-use 抽取阶段更容易锁定目标节点。

## 5. 合并报告

```bash
python /path/to/figma-to-product/scripts/generate_visual_report.py \
  --screenshot-report .figma-to-product/work/figma-<node-id>/visual-diff/report.json \
  --figma-dom-report .figma-to-product/work/figma-<node-id>/visual-diff/figma-dom-report.json \
  --out .figma-to-product/work/figma-<node-id>/visual-diff/precision-report.md
```

## Agent 修复循环

1. 先修截图 diff 中的大区域：页面宽度、顶部偏移、主要容器、分区间距。
2. 再修重复出现的组件差异：行高、按钮尺寸、卡片圆角、分隔线透明度。
3. 最后修文字与图标细节：字重、行高、可见 SVG 尺寸、基线对齐。
4. 每次有意义的改动后，用 browser-use 重抓产品截图与 DOM 视觉树，再跑同一组比对脚本。
5. 汇报剩余差异，附上截图路径、标注 diff 路径与具体未解决的问题。

## 局限

- 像素比对对字体渲染、浏览器差异、抗锯齿与动态数据敏感。
- Figma/DOM 匹配只是定位手段，不是视觉正确性的证明。
- 如果设计截图与产品截图使用了不同的视口、DPR、滚动位置或数据状态，先修这些输入再去改实现。
- 当 Figma 分区导出与整页产品截图比较时，必须先裁剪或偏移再解读区域报告。
- browser-use 截图依赖会话浏览器的状态（登录、Cookie、扩展、字体）。复现差异时优先核对这些环境因素。
