#!/usr/bin/env python3
"""把归一化后的 Figma 节点与浏览器渲染出的 DOM 视觉树做比对。

本脚本只是一个"定位辅助 + 解释器"，应该作为最终截图差异比对的补充，
而不是替代品。
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class VisualElement:
    source: str
    id: str
    name: str
    text: str
    role: str
    bbox: dict[str, float]
    styles: dict[str, Any]
    selector: str = ""
    data_design_id: str = ""


def walk_json(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def first_solid_paint(paints: Any) -> str:
    if not isinstance(paints, list):
        return ""
    for paint in paints:
        if not isinstance(paint, dict) or not paint.get("visible", True):
            continue
        if paint.get("type") == "SOLID" and isinstance(paint.get("color"), dict):
            color = paint["color"]
            alpha = paint.get("opacity", color.get("a", 1))
            return rgba_to_hex(
                color.get("r", 0) * 255,
                color.get("g", 0) * 255,
                color.get("b", 0) * 255,
                alpha,
            )
    return ""


def rgba_to_hex(r: float, g: float, b: float, a: float = 1) -> str:
    if a is None:
        a = 1
    return f"#{round(r):02X}{round(g):02X}{round(b):02X}" if a >= 0.999 else f"rgba({round(r)}, {round(g)}, {round(b)}, {round(a, 3)})"


def parse_css_color(value: str) -> tuple[int, int, int, float] | None:
    if not value:
        return None
    value = value.strip()
    if value.startswith("#") and len(value) in (4, 7):
        if len(value) == 4:
            r = int(value[1] * 2, 16)
            g = int(value[2] * 2, 16)
            b = int(value[3] * 2, 16)
        else:
            r = int(value[1:3], 16)
            g = int(value[3:5], 16)
            b = int(value[5:7], 16)
        return (r, g, b, 1)
    match = re.match(r"rgba?\(([^)]+)\)", value)
    if not match:
        return None
    parts = [part.strip() for part in match.group(1).split(",")]
    if len(parts) < 3:
        return None
    return (round(float(parts[0])), round(float(parts[1])), round(float(parts[2])), float(parts[3]) if len(parts) > 3 else 1)


def color_distance(a: str, b: str) -> float | None:
    ca = parse_css_color(a)
    cb = parse_css_color(b)
    if ca is None or cb is None:
        return None
    return round(math.sqrt((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2 + (ca[2] - cb[2]) ** 2), 2)


def parse_px(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.match(r"(-?\d+(?:\.\d+)?)px", str(value))
    if match:
        return float(match.group(1))
    try:
        return float(value)
    except ValueError:
        return None


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def bbox_from_figma(node: dict[str, Any]) -> dict[str, float] | None:
    bbox = node.get("absoluteBoundingBox") or node.get("absoluteRenderBounds") or node.get("bounds")
    if not isinstance(bbox, dict):
        return None
    required = ("x", "y", "width", "height")
    if not all(key in bbox for key in required):
        return None
    return {key: round(float(bbox[key]), 2) for key in required}


def extract_figma_elements(paths: list[Path]) -> list[VisualElement]:
    elements: list[VisualElement] = []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for node in walk_json(payload):
            bbox = bbox_from_figma(node)
            if not bbox:
                continue
            node_type = str(node.get("type") or "").lower()
            text = str(node.get("characters") or "")
            name = str(node.get("name") or "")
            if bbox["width"] < 1 or bbox["height"] < 1:
                continue
            styles = {
                "backgroundColor": first_solid_paint(node.get("fills")),
                "borderColor": first_solid_paint(node.get("strokes")),
                "fontSize": None,
                "fontWeight": None,
                "borderRadius": node.get("cornerRadius"),
            }
            style = node.get("style")
            if isinstance(style, dict):
                styles["fontSize"] = style.get("fontSize")
                styles["fontWeight"] = style.get("fontWeight")
                styles["lineHeightPx"] = style.get("lineHeightPx")
            role = "text" if text or node_type == "text" else "container"
            if "button" in name.lower():
                role = "button"
            if "icon" in name.lower() or node_type in {"vector", "boolean_operation"}:
                role = "icon"
            elements.append(
                VisualElement(
                    source="figma",
                    id=str(node.get("id") or ""),
                    name=name,
                    text=text,
                    role=role,
                    bbox=bbox,
                    styles=styles,
                )
            )
    return elements


def extract_dom_elements(path: Path) -> list[VisualElement]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    elements: list[VisualElement] = []
    for item in payload.get("elements", []):
        bbox = item.get("bbox") or {}
        if not all(key in bbox for key in ("x", "y", "width", "height")):
            continue
        styles = item.get("styles") or {}
        elements.append(
            VisualElement(
                source="dom",
                id=str(item.get("id") or ""),
                name=str(item.get("ariaLabel") or item.get("text") or item.get("selector") or ""),
                text=str(item.get("text") or ""),
                role=str(item.get("role") or ""),
                bbox={key: round(float(bbox[key]), 2) for key in ("x", "y", "width", "height")},
                styles=styles,
                selector=str(item.get("selector") or ""),
                data_design_id=str(item.get("dataDesignId") or ""),
            )
        )
    return elements


def center_distance(a: dict[str, float], b: dict[str, float]) -> float:
    ax = a["x"] + a["width"] / 2
    ay = a["y"] + a["height"] / 2
    bx = b["x"] + b["width"] / 2
    by = b["y"] + b["height"] / 2
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def match_score(figma: VisualElement, dom: VisualElement) -> tuple[float, str]:
    if dom.data_design_id and dom.data_design_id in {figma.id, figma.name}:
        return (1000, "data-design-id")
    figma_text = normalize_text(figma.text or figma.name)
    dom_text = normalize_text(dom.text or dom.name)
    text_bonus = 0
    method = "position"
    if figma_text and dom_text and (figma_text == dom_text or figma_text in dom_text or dom_text in figma_text):
        text_bonus = 250
        method = "text"
    role_bonus = 25 if figma.role and figma.role == dom.role else 0
    distance = center_distance(figma.bbox, dom.bbox)
    size_delta = abs(figma.bbox["width"] - dom.bbox["width"]) + abs(figma.bbox["height"] - dom.bbox["height"])
    score = text_bonus + role_bonus - distance - size_delta * 0.5
    return (score, method)


def best_matches(figma_elements: list[VisualElement], dom_elements: list[VisualElement], limit: int) -> list[tuple[VisualElement, VisualElement, str]]:
    matches: list[tuple[VisualElement, VisualElement, str]] = []
    used_dom: set[int] = set()
    important = [
        element for element in figma_elements
        if element.text or element.role in {"button", "icon"} or element.styles.get("backgroundColor")
    ]
    for figma in important:
        scored = []
        for index, dom in enumerate(dom_elements):
            if index in used_dom:
                continue
            score, method = match_score(figma, dom)
            scored.append((score, method, index, dom))
        if not scored:
            continue
        score, method, index, dom = max(scored, key=lambda item: item[0])
        if score < -180:
            continue
        used_dom.add(index)
        matches.append((figma, dom, method))
        if len(matches) >= limit:
            break
    return matches


def compare_match(figma: VisualElement, dom: VisualElement, method: str, tolerances: dict[str, float]) -> dict[str, Any]:
    diffs: list[dict[str, Any]] = []
    for key in ("x", "y", "width", "height"):
        expected = figma.bbox[key]
        actual = dom.bbox[key]
        delta = round(actual - expected, 2)
        tolerance = tolerances["position"] if key in {"x", "y"} else tolerances["size"]
        if abs(delta) > tolerance:
            diffs.append({"type": key, "expected": expected, "actual": actual, "delta": delta})

    figma_bg = figma.styles.get("backgroundColor") or ""
    dom_bg = dom.styles.get("backgroundColor") or ""
    if figma_bg and dom_bg and dom_bg != "rgba(0, 0, 0, 0)":
        distance = color_distance(figma_bg, dom_bg)
        if distance is not None and distance > tolerances["color"]:
            diffs.append({"type": "backgroundColor", "expected": figma_bg, "actual": dom_bg, "delta": distance})

    figma_font = parse_px(figma.styles.get("fontSize"))
    dom_font = parse_px(dom.styles.get("fontSize"))
    if figma_font is not None and dom_font is not None and abs(dom_font - figma_font) > tolerances["font"]:
        diffs.append({"type": "fontSize", "expected": figma_font, "actual": dom_font, "delta": round(dom_font - figma_font, 2)})

    figma_radius = parse_px(figma.styles.get("borderRadius"))
    dom_radius = parse_px(str(dom.styles.get("borderRadius", "")).split(" ")[0])
    if figma_radius is not None and dom_radius is not None and abs(dom_radius - figma_radius) > tolerances["radius"]:
        diffs.append({"type": "borderRadius", "expected": figma_radius, "actual": dom_radius, "delta": round(dom_radius - figma_radius, 2)})

    severity = "none"
    if diffs:
        max_abs = max(abs(float(diff.get("delta") or 0)) for diff in diffs if isinstance(diff.get("delta"), (int, float)))
        severity = "high" if max_abs > 12 or len(diffs) >= 3 else "medium"

    return {
        "figma": {"id": figma.id, "name": figma.name, "text": figma.text, "role": figma.role, "bbox": figma.bbox},
        "dom": {"selector": dom.selector, "text": dom.text, "role": dom.role, "bbox": dom.bbox, "dataDesignId": dom.data_design_id},
        "matchMethod": method,
        "severity": severity,
        "diffs": diffs,
        "suggestion": "请基于此条目作为定位线索修复代码/样式，再用截图差异验证。" if diffs else "",
    }


def write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# Figma 与 DOM 视觉比对",
        "",
        f"- Figma 元素数：{report['summary']['figmaElements']}",
        f"- DOM 元素数：{report['summary']['domElements']}",
        f"- 匹配数：{report['summary']['matches']}",
        f"- 问题数：{report['summary']['issues']}",
        "",
    ]
    for issue in report["issues"]:
        figma = issue["figma"]
        dom = issue["dom"]
        lines.extend(
            [
                f"## {issue['severity'].upper()} {figma.get('name') or figma.get('text') or figma.get('id')}",
                "",
                f"- 匹配方式：{issue['matchMethod']}",
                f"- DOM 选择器：`{dom.get('selector')}`",
                f"- Figma bbox：{figma.get('bbox')}",
                f"- DOM bbox：{dom.get('bbox')}",
            ]
        )
        for diff in issue["diffs"]:
            lines.append(f"- {diff['type']}：期望 `{diff['expected']}`，实际 `{diff['actual']}`，差值 `{diff['delta']}`")
        lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--figma-json", action="append", required=True, help="Figma JSON 文件，可重复传入多份")
    parser.add_argument("--dom-json", required=True, help="browser-use 抽取得到的 DOM 视觉树 JSON（结构见 references/visual-diff-workflow.md 第 3 节）")
    parser.add_argument("--out-dir", required=True, help="输出目录")
    parser.add_argument("--limit", type=int, default=120, help="参与比对的最大匹配元素数量")
    parser.add_argument("--position-tolerance", type=float, default=2)
    parser.add_argument("--size-tolerance", type=float, default=2)
    parser.add_argument("--color-tolerance", type=float, default=8)
    parser.add_argument("--font-tolerance", type=float, default=1)
    parser.add_argument("--radius-tolerance", type=float, default=1)
    args = parser.parse_args()

    figma_paths = [Path(value) for value in args.figma_json]
    dom_path = Path(args.dom_json)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    figma_elements = extract_figma_elements(figma_paths)
    dom_elements = extract_dom_elements(dom_path)
    tolerances = {
        "position": args.position_tolerance,
        "size": args.size_tolerance,
        "color": args.color_tolerance,
        "font": args.font_tolerance,
        "radius": args.radius_tolerance,
    }
    matches = best_matches(figma_elements, dom_elements, args.limit)
    compared = [compare_match(figma, dom, method, tolerances) for figma, dom, method in matches]
    issues = [item for item in compared if item["diffs"]]
    report = {
        "inputs": {
            "figmaJson": [str(path.resolve()) for path in figma_paths],
            "domJson": str(dom_path.resolve()),
            "tolerances": tolerances,
        },
        "summary": {
            "figmaElements": len(figma_elements),
            "domElements": len(dom_elements),
            "matches": len(compared),
            "issues": len(issues),
        },
        "matches": compared,
        "issues": issues,
    }
    report_path = out_dir / "figma-dom-report.json"
    markdown_path = out_dir / "figma-dom-report.md"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(report, markdown_path)
    print(report_path)
    print(markdown_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
