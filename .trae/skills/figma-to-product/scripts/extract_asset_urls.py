#!/usr/bin/env python3
"""从保存的 JSON / 文本文件中抽取 Figma MCP 的 localhost 资源 URL。"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ASSET_RE = re.compile(r"http://localhost:3845/assets/[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]+")


def read_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="ignore")
    if path.suffix == ".json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return text
        return json.dumps(data, ensure_ascii=False)
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="Figma MCP 的 JSON / 文本文件或目录")
    args = parser.parse_args()

    urls: set[str] = set()
    for raw in args.paths:
        path = Path(raw)
        files = [path]
        if path.is_dir():
            files = [p for p in path.rglob("*") if p.is_file()]
        for file in files:
            urls.update(ASSET_RE.findall(read_text(file)))

    for url in sorted(urls):
        print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
