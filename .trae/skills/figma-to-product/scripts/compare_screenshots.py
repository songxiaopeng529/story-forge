#!/usr/bin/env python3
"""把 Figma/设计稿截图与产品页面截图做对比。

报告专门面向 coding agent：每个差异区域都包含包围盒、严重程度和具体的
像素 / 颜色证据。
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - depends on runtime environment
    Image = None
    ImageDraw = None


@dataclass
class Region:
    x: int
    y: int
    width: int
    height: int
    area: int
    mean_delta: float
    max_delta: int


def require_pillow() -> None:
    if Image is None or ImageDraw is None:
        print(
            "缺失依赖：本脚本需要 Pillow，请在当前 Python 环境中安装，"
            "或使用自带 PIL 的 Python 解释器运行。",
            file=sys.stderr,
        )
        raise SystemExit(2)


def load_rgb(path: Path) -> Image.Image:
    image = Image.open(path)
    if image.mode == "RGBA":
        background = Image.new("RGBA", image.size, (255, 255, 255, 255))
        image = Image.alpha_composite(background, image)
    return image.convert("RGB")


def resize_by_scale(image: Image.Image, scale: float) -> Image.Image:
    if scale == 1:
        return image
    if scale <= 0:
        raise ValueError("--design-scale 与 --product-scale 必须为正数")
    width = max(1, round(image.width / scale))
    height = max(1, round(image.height / scale))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def parse_rect(value: str | None, label: str) -> tuple[int, int, int, int] | None:
    if not value:
        return None
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError(f"{label} 必须使用 x,y,width,height 格式")
    x, y, width, height = [int(round(float(part))) for part in parts]
    if width <= 0 or height <= 0:
        raise ValueError(f"{label} 的 width 与 height 必须为正数")
    return x, y, width, height


def parse_point(value: str | None, label: str) -> tuple[int, int]:
    if not value:
        return (0, 0)
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 2:
        raise ValueError(f"{label} 必须使用 x,y 格式")
    return int(round(float(parts[0]))), int(round(float(parts[1])))


def crop_image(image: Image.Image, rect: tuple[int, int, int, int] | None) -> Image.Image:
    if rect is None:
        return image
    x, y, width, height = rect
    return image.crop((x, y, x + width, y + height))


def paste_on_canvas(image: Image.Image, size: tuple[int, int], origin: tuple[int, int]) -> Image.Image:
    canvas = Image.new("RGB", size, (255, 255, 255))
    canvas.paste(image, origin)
    return canvas


def aligned_canvases(
    design: Image.Image,
    product: Image.Image,
    design_offset: tuple[int, int],
    product_offset: tuple[int, int],
) -> tuple[Image.Image, Image.Image, dict]:
    min_x = min(0, design_offset[0], product_offset[0])
    min_y = min(0, design_offset[1], product_offset[1])
    max_x = max(design_offset[0] + design.width, product_offset[0] + product.width)
    max_y = max(design_offset[1] + design.height, product_offset[1] + product.height)
    size = (max(1, max_x - min_x), max(1, max_y - min_y))
    design_origin = (design_offset[0] - min_x, design_offset[1] - min_y)
    product_origin = (product_offset[0] - min_x, product_offset[1] - min_y)
    return (
        paste_on_canvas(design, size, design_origin),
        paste_on_canvas(product, size, product_origin),
        {
            "canvasSize": {"width": size[0], "height": size[1]},
            "designOrigin": {"x": design_origin[0], "y": design_origin[1]},
            "productOrigin": {"x": product_origin[0], "y": product_origin[1]},
        },
    )


def pixel_delta(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def build_changed_mask(
    design: Image.Image,
    product: Image.Image,
    threshold: int,
) -> tuple[bytearray, list[int], int, float]:
    width, height = design.size
    design_pixels = design.load()
    product_pixels = product.load()
    mask = bytearray(width * height)
    deltas = [0] * (width * height)
    changed = 0
    total_delta = 0

    for y in range(height):
        offset = y * width
        for x in range(width):
            delta = pixel_delta(design_pixels[x, y], product_pixels[x, y])
            deltas[offset + x] = delta
            total_delta += delta
            if delta > threshold:
                mask[offset + x] = 1
                changed += 1

    mean_delta = total_delta / max(1, width * height)
    return mask, deltas, changed, mean_delta


def connected_regions(
    mask: bytearray,
    deltas: list[int],
    width: int,
    height: int,
    min_area: int,
    max_regions: int,
) -> list[Region]:
    visited = bytearray(width * height)
    regions: list[Region] = []

    for start in range(width * height):
      if not mask[start] or visited[start]:
          continue

      queue: deque[int] = deque([start])
      visited[start] = 1
      min_x = width
      min_y = height
      max_x = 0
      max_y = 0
      area = 0
      total_delta = 0
      max_delta = 0

      while queue:
          current = queue.popleft()
          x = current % width
          y = current // width
          area += 1
          total_delta += deltas[current]
          max_delta = max(max_delta, deltas[current])
          min_x = min(min_x, x)
          min_y = min(min_y, y)
          max_x = max(max_x, x)
          max_y = max(max_y, y)

          for neighbor in (current - 1, current + 1, current - width, current + width):
              if neighbor < 0 or neighbor >= width * height:
                  continue
              if (neighbor == current - 1 and x == 0) or (neighbor == current + 1 and x == width - 1):
                  continue
              if mask[neighbor] and not visited[neighbor]:
                  visited[neighbor] = 1
                  queue.append(neighbor)

      if area >= min_area:
          regions.append(
              Region(
                  x=min_x,
                  y=min_y,
                  width=max_x - min_x + 1,
                  height=max_y - min_y + 1,
                  area=area,
                  mean_delta=round(total_delta / area, 2),
                  max_delta=max_delta,
              )
          )

    regions.sort(key=lambda region: region.area, reverse=True)
    return regions[:max_regions]


def draw_outputs(
    design: Image.Image,
    product: Image.Image,
    mask: bytearray,
    deltas: list[int],
    regions: Iterable[Region],
    diff_path: Path,
    annotated_path: Path,
) -> None:
    width, height = design.size
    diff = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    diff_pixels = diff.load()
    for y in range(height):
        offset = y * width
        for x in range(width):
            index = offset + x
            if mask[index]:
                alpha = max(70, min(220, int(deltas[index] / 255 * 220)))
                diff_pixels[x, y] = (255, 37, 37, alpha)

    base = product.convert("RGBA")
    composite = Image.alpha_composite(base, diff)
    composite.save(diff_path)

    annotated = composite.copy()
    draw = ImageDraw.Draw(annotated)
    for index, region in enumerate(regions, start=1):
        box = [region.x, region.y, region.x + region.width, region.y + region.height]
        draw.rectangle(box, outline=(255, 0, 0, 255), width=2)
        label = f"{index}"
        draw.rectangle([region.x, max(0, region.y - 16), region.x + 24, region.y], fill=(255, 0, 0, 220))
        draw.text((region.x + 4, max(0, region.y - 15)), label, fill=(255, 255, 255, 255))
    annotated.save(annotated_path)


def severity_for(region: Region, image_area: int) -> str:
    pct = region.area / max(1, image_area)
    if pct >= 0.02 or region.width >= 160 or region.height >= 120:
        return "high"
    if pct >= 0.005 or region.width >= 64 or region.height >= 48:
        return "medium"
    return "low"


def write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# 视觉差异报告",
        "",
        f"- 分数：{report['summary']['score']}",
        f"- 差异像素数：{report['summary']['changedPixels']}（占比 {report['summary']['changedPixelRatio']:.4%}）",
        f"- 平均通道色差：{report['summary']['meanDelta']}",
        f"- 设计稿尺寸：{report['summary']['designSize']}",
        f"- 产品截图尺寸：{report['summary']['productSize']}",
        f"- 比对尺寸：{report['summary']['comparedSize']}",
        f"- 设计稿裁剪：{report['inputs']['designCrop'] or '无'}",
        f"- 产品截图裁剪：{report['inputs']['productCrop'] or '无'}",
        f"- 设计稿偏移：{report['inputs']['designOffset'] or '0,0'}",
        f"- 产品截图偏移：{report['inputs']['productOffset'] or '0,0'}",
        "",
        "## 差异区域",
        "",
    ]
    if not report["regions"]:
        lines.append("没有任何区域超过设定阈值。")
    for issue in report["regions"]:
        bbox = issue["bbox"]
        lines.extend(
            [
                f"### {issue['id']}. {issue['severity'].upper()} 区域",
                "",
                f"- BBox：x={bbox['x']}, y={bbox['y']}, w={bbox['width']}, h={bbox['height']}",
                f"- 面积：{issue['area']} px",
                f"- 平均色差：{issue['meanDelta']}",
                f"- 最大色差：{issue['maxDelta']}",
                f"- 建议检查：{issue['suggestion']}",
                "",
            ]
        )
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--design", required=True, help="设计稿 / Figma 截图路径")
    parser.add_argument("--product", required=True, help="产品页面截图路径")
    parser.add_argument("--out-dir", required=True, help="输出目录")
    parser.add_argument("--design-scale", type=float, default=1, help="比对前将设计稿的尺寸除以该缩放系数")
    parser.add_argument("--product-scale", type=float, default=1, help="比对前将产品截图的尺寸除以该缩放系数")
    parser.add_argument("--design-crop", help="缩放前先裁剪设计稿，格式 x,y,width,height")
    parser.add_argument("--product-crop", help="缩放前先裁剪产品截图，格式 x,y,width,height")
    parser.add_argument("--design-offset", help="缩放后将设计稿放置在该偏移处，格式 x,y，默认 0,0")
    parser.add_argument("--product-offset", help="缩放后将产品截图放置在该偏移处，格式 x,y，默认 0,0")
    parser.add_argument("--threshold", type=int, default=12, help="单通道色差超过该阈值时视为像素发生变化")
    parser.add_argument("--min-area", type=int, default=48, help="最小连通域面积，低于该值不进入报告")
    parser.add_argument("--max-regions", type=int, default=30, help="报告中最多包含的差异区域数量")
    args = parser.parse_args()

    require_pillow()

    design_path = Path(args.design)
    product_path = Path(args.product)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    design_crop = parse_rect(args.design_crop, "--design-crop")
    product_crop = parse_rect(args.product_crop, "--product-crop")
    design_offset = parse_point(args.design_offset, "--design-offset")
    product_offset = parse_point(args.product_offset, "--product-offset")

    design_original = crop_image(load_rgb(design_path), design_crop)
    product_original = crop_image(load_rgb(product_path), product_crop)
    design = resize_by_scale(design_original, args.design_scale)
    product = resize_by_scale(product_original, args.product_scale)
    design_canvas, product_canvas, alignment = aligned_canvases(design, product, design_offset, product_offset)
    compared_size = design_canvas.size

    mask, deltas, changed, mean_delta = build_changed_mask(design_canvas, product_canvas, args.threshold)
    regions = connected_regions(mask, deltas, compared_size[0], compared_size[1], args.min_area, args.max_regions)

    diff_path = out_dir / "diff.png"
    annotated_path = out_dir / "annotated-diff.png"
    draw_outputs(design_canvas, product_canvas, mask, deltas, regions, diff_path, annotated_path)

    image_area = compared_size[0] * compared_size[1]
    changed_ratio = changed / max(1, image_area)
    score = max(0, round(100 * (1 - math.sqrt(changed_ratio)), 2))
    size_mismatch = design.size != product.size
    report = {
        "inputs": {
            "design": str(design_path.resolve()),
            "product": str(product_path.resolve()),
            "designScale": args.design_scale,
            "productScale": args.product_scale,
            "designCrop": args.design_crop,
            "productCrop": args.product_crop,
            "designOffset": args.design_offset,
            "productOffset": args.product_offset,
            "threshold": args.threshold,
        },
        "outputs": {
            "diff": str(diff_path.resolve()),
            "annotatedDiff": str(annotated_path.resolve()),
        },
        "summary": {
            "score": score,
            "changedPixels": changed,
            "changedPixelRatio": changed_ratio,
            "meanDelta": round(mean_delta, 2),
            "designSize": {"width": design.width, "height": design.height},
            "productSize": {"width": product.width, "height": product.height},
            "comparedSize": {"width": compared_size[0], "height": compared_size[1]},
            "sizeMismatch": size_mismatch,
            "regionCount": len(regions),
            "alignment": alignment,
        },
        "regions": [
            {
                "id": index,
                "type": "visual",
                "severity": severity_for(region, image_area),
                "bbox": {"x": region.x, "y": region.y, "width": region.width, "height": region.height},
                "area": region.area,
                "meanDelta": region.mean_delta,
                "maxDelta": region.max_delta,
                "suggestion": "请检查该区域内的布局、颜色、图标、文字或间距。",
            }
            for index, region in enumerate(regions, start=1)
        ],
    }

    report_path = out_dir / "report.json"
    markdown_path = out_dir / "report.md"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(report, markdown_path)
    print(report_path)
    print(markdown_path)
    print(annotated_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
