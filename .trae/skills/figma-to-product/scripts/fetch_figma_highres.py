#!/usr/bin/env python3
"""通过 Figma Images API 导出 Figma 节点的高分辨率 PNG。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


def safe_name(value: str) -> str:
    value = value.replace(":", "-")
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "node"


def request_json(url: str, token: str) -> dict:
    request = urllib.request.Request(url, headers={"X-Figma-Token": token})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, output: Path) -> None:
    request = urllib.request.Request(url)
    with urllib.request.urlopen(request, timeout=120) as response:
        output.write_bytes(response.read())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file-key", required=True, help="Figma 文件 key")
    parser.add_argument("--nodes", required=True, help="逗号分隔的 Figma 节点 ID，例如 10053:63655,10053:63686")
    parser.add_argument("--out-dir", required=True, help="保存 JSON 元数据与 PNG 的输出目录")
    parser.add_argument("--scale", type=float, default=4, help="导出倍率，常用 3 或 4")
    parser.add_argument("--format", default="png", choices=["png", "jpg", "svg", "pdf"], help="Figma 导出格式")
    parser.add_argument("--token-env", default="FIGMA_TOKEN", help="存放 Figma token 的环境变量名")
    parser.add_argument("--prefix", default="", help="可选的文件名前缀")
    parser.add_argument("--sleep", type=float, default=0.2, help="两次下载之间的等待秒数")
    args = parser.parse_args()

    token = os.environ.get(args.token_env)
    if not token:
        print(f"缺失 token：请设置 ${args.token_env}", file=sys.stderr)
        return 2

    node_ids = [node.strip() for node in args.nodes.split(",") if node.strip()]
    if not node_ids:
        print("未提供任何 node ID", file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    json_dir = out_dir / "json"
    highres_dir = out_dir / "highres"
    json_dir.mkdir(parents=True, exist_ok=True)
    highres_dir.mkdir(parents=True, exist_ok=True)

    query = urllib.parse.urlencode(
        {
            "ids": ",".join(node_ids),
            "format": args.format,
            "scale": str(args.scale),
        }
    )
    api_url = f"https://api.figma.com/v1/images/{args.file_key}?{query}"
    payload = request_json(api_url, token)

    metadata_path = json_dir / f"images-scale{safe_name(str(args.scale))}.json"
    metadata_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if payload.get("err"):
        print(f"Figma API 错误：{payload['err']}", file=sys.stderr)
        return 1

    images = payload.get("images") or {}
    missing = [node for node in node_ids if not images.get(node)]
    for node in missing:
        print(f"节点 {node} 没有图片 URL", file=sys.stderr)

    downloaded = 0
    for node in node_ids:
        image_url = images.get(node)
        if not image_url:
            continue
        name = f"{args.prefix}{safe_name(node)}-{safe_name(str(args.scale))}x.{args.format}"
        output = highres_dir / name
        download(image_url, output)
        downloaded += 1
        print(output)
        if args.sleep:
            time.sleep(args.sleep)

    return 0 if downloaded else 1


if __name__ == "__main__":
    raise SystemExit(main())
