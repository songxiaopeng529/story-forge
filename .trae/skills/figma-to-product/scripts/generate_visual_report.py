#!/usr/bin/env python3
"""将截图比对与 Figma/DOM 比对结果合并为一份给 agent 阅读的报告。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def read_json(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshot-report", help="compare_screenshots.py 产出的 report.json")
    parser.add_argument("--figma-dom-report", help="compare_figma_dom.py 产出的 figma-dom-report.json")
    parser.add_argument("--out", required=True, help="合并后的 markdown 报告输出路径")
    args = parser.parse_args()

    screenshot = read_json(args.screenshot_report)
    figma_dom = read_json(args.figma_dom_report)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    lines = ["# 精度回归报告", ""]
    if screenshot:
        summary = screenshot["summary"]
        lines.extend(
            [
                "## 截图差异",
                "",
                f"- 分数：{summary['score']}",
                f"- 差异像素数：{summary['changedPixels']}（占比 {summary['changedPixelRatio']:.4%}）",
                f"- 差异区域数：{summary['regionCount']}",
                f"- 标注后的差异图：{screenshot['outputs']['annotatedDiff']}",
                "",
            ]
        )
        for region in screenshot.get("regions", [])[:10]:
            bbox = region["bbox"]
            lines.append(
                f"- {region['severity']} 视觉差异区域：x={bbox['x']}, y={bbox['y']}, "
                f"w={bbox['width']}, h={bbox['height']}；平均色差 {region['meanDelta']}"
            )
        lines.append("")

    if figma_dom:
        summary = figma_dom["summary"]
        lines.extend(
            [
                "## Figma 与 DOM 节点差异",
                "",
                f"- 匹配数：{summary['matches']}",
                f"- 问题数：{summary['issues']}",
                "",
            ]
        )
        for issue in figma_dom.get("issues", [])[:20]:
            figma = issue["figma"]
            dom = issue["dom"]
            label = figma.get("name") or figma.get("text") or figma.get("id")
            lines.append(f"- {issue['severity']} `{label}` -> `{dom.get('selector')}`")
            for diff in issue.get("diffs", [])[:6]:
                lines.append(f"  - {diff['type']}：期望 {diff['expected']}，实际 {diff['actual']}，差值 {diff['delta']}")
        lines.append("")

    lines.extend(
        [
            "## Agent 修复指引",
            "",
            "以截图差异作为视觉真值依据；通过 Figma DOM 差异定位需要调整的选择器与样式属性。每次修复后请使用相同视口重新运行同一组命令。",
            "",
        ]
    )
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
