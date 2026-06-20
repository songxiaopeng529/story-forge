# Figma 数据抓取流程

## Table of Contents

- [抓取目录](#抓取目录)
- [必需的 Figma 抓取项](#必需的-figma-抓取项)
- [组件级样式节点库](#组件级样式节点库)
- [高分辨率导出](#高分辨率导出)
- [素材提取](#素材提取)
- [样式证据优先级](#样式证据优先级)

## 抓取目录

所有产物落在**项目根目录下的 `.figma-to-product/work/figma-<node-id>/`**（已加入 `.gitignore`），不要写到 skill 自身目录内：

```text
<project-root>/.figma-to-product/work/figma-<node-id>/
├── raw/
├── style-nodes/<component-name>/raw/
├── figma-api/json/
├── figma-api/highres/
├── assets/
└── docs/
```

## 必需的 Figma 抓取项

对目标节点：

1. 抓取 `get_metadata`。
2. 抓取 `get_design_context`。
3. 抓取 `get_variable_defs`。
4. 抓取 `get_screenshot`。

如果 `get_design_context` 提示节点过大，结合 metadata 抓取关键子节点：

- 顶部与筛选区
- 导航或锚点 Tab
- 指标卡片
- 主表格 / 列表 / 图表区域
- 汇总 / 提示行
- 风险图表 / 图例区域
- 任何纯图标节点

## 组件级样式节点库

为精度实现所需的组件级证据建立 `style-nodes/` 目录。结构如下：

```text
<project-root>/.figma-to-product/work/figma-<node-id>/style-nodes/
├── select/
│   ├── raw/get_design_context.json
│   ├── raw/get_metadata.json
│   ├── raw/get_variable_defs.json
│   ├── raw/get_screenshot.json
│   └── assets/node-<id>.png
├── metric-card-active/
└── summary-icon/
```

使用 `scripts/fetch_figma_style_nodes.py`：

```bash
python /path/to/figma-to-product/scripts/fetch_figma_style_nodes.py \
  --nodes select=10053:63672,metric-card-active=10053:63808,summary-icon=10053:64282 \
  --out-dir .figma-to-product/work/figma-10053-63655/style-nodes
```

节点很多时，维护一个节点列表文件：

```text
select	10053:63672
anchor-tab-active	10053:63666
metric-card-active	10053:63808
violation-analysis	10053:63953
analysis-table	10053:64142
summary-icon	10053:64282
risk-overview	10053:64285
```

然后运行：

```bash
python /path/to/figma-to-product/scripts/fetch_figma_style_nodes.py \
  --nodes-file .figma-to-product/work/figma-10053-63655/style-node-list.tsv \
  --out-dir .figma-to-product/work/figma-10053-63655/style-nodes
```

不要无差别地把每个细小图层都抓下来。要抓的是所有有意义的可复用块或视觉敏感块：组件、各种状态、图表基础元件、表格容器、汇总行、纯图标节点，以及任何在截图 diff 中被命中的子节点。

## 高分辨率导出

使用 `scripts/fetch_figma_highres.py` 做整画板与分区级导出：

```bash
FIGMA_TOKEN="..." \
python /path/to/figma-to-product/scripts/fetch_figma_highres.py \
  --file-key <file-key> \
  --nodes <node-id>,<section-node-id> \
  --scale 4 \
  --out-dir .figma-to-product/work/figma-<node-id>/figma-api
```

脚本把 API 元数据写入 `figma-api/json/`，下载的图片写入 `figma-api/highres/`。
当批量导出超时时，优先逐节点导出。

## 素材提取

Figma MCP 的设计上下文经常返回类似下面的常量：

```ts
const imgUnion = "http://localhost:3845/assets/<hash>.svg";
```

直接使用这些素材，而不是手画近似 SVG。可能的话把它们下载进项目：

```bash
curl -sS "http://localhost:3845/assets/<hash>.svg" -o src/assets/figma/<name>.svg
```

重要：分别检查 Figma 节点盒子与 SVG viewBox。一个 `16×16` 的图标节点内部可能是 `12.9×12.2` 的可见 SVG，或一个溢出的内部 Union。要按"最终可见尺寸"渲染，而不是盲目沿用生成出来的内部尺寸。

## 样式证据优先级

当多个来源冲突时，按以下顺序采纳：

1. 精确的 Figma 子节点设计上下文。
2. Figma 变量 / token。
3. 高分辨率截图测量。
4. 项目已有的设计 token / 组件。
5. 视觉判断，并显式标注为"推断"。
