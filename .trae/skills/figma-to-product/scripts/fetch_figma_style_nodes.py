#!/usr/bin/env python3
"""调用 Figma MCP 拉取组件级数据，输出到 style-nodes 目录。"""

from __future__ import annotations

import argparse
import base64
import json
import queue
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path


DEFAULT_BASE_URL = "http://127.0.0.1:3845"


class SseClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.messages: queue.Queue[dict] = queue.Queue()
        self.endpoint: str | None = None

    def start(self) -> None:
        def run() -> None:
            request = urllib.request.Request(f"{self.base_url}/sse")
            with urllib.request.urlopen(request, timeout=120) as response:
                event = None
                data_lines: list[str] = []
                for raw in response:
                    line = raw.decode("utf-8", "replace").rstrip("\n")
                    if line.endswith("\r"):
                        line = line[:-1]
                    if not line:
                        if event == "endpoint" and data_lines:
                            self.endpoint = "".join(data_lines)
                        elif event == "message" and data_lines:
                            self.messages.put(json.loads("".join(data_lines)))
                        event = None
                        data_lines = []
                        continue
                    if line.startswith("event:"):
                        event = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line.split(":", 1)[1].strip())

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        deadline = time.time() + 10
        while self.endpoint is None and time.time() < deadline:
            time.sleep(0.05)
        if not self.endpoint:
            raise RuntimeError("Figma MCP 服务端未返回 SSE endpoint")

    def post(self, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{self.endpoint}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            response.read()

    def call(self, request_id: int, method: str, params: dict | None = None, timeout: int = 120) -> dict:
        self.post({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                message = self.messages.get(timeout=0.5)
            except queue.Empty:
                continue
            if message.get("id") == request_id:
                return message
        raise TimeoutError(f"等待 id={request_id} 的响应超时")


def safe_name(value: str) -> str:
    value = value.replace(":", "-")
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "node"


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_nodes(raw_nodes: list[str], nodes_file: str | None) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []

    for raw in raw_nodes:
        for item in raw.split(","):
            item = item.strip()
            if not item:
                continue
            if "=" in item:
                name, node_id = item.split("=", 1)
            else:
                node_id = item
                name = safe_name(node_id)
            pairs.append((safe_name(name), node_id.strip()))

    if nodes_file:
        for line in Path(nodes_file).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "\t" in line:
                name, node_id = line.split("\t", 1)
            elif "=" in line:
                name, node_id = line.split("=", 1)
            else:
                node_id = line
                name = safe_name(node_id)
            pairs.append((safe_name(name.strip()), node_id.strip()))

    seen: set[str] = set()
    deduped: list[tuple[str, str]] = []
    for name, node_id in pairs:
        key = f"{name}\t{node_id}"
        if key not in seen:
            deduped.append((name, node_id))
            seen.add(key)
    return deduped


def call_tool(sse: SseClient, request_id: int, name: str, arguments: dict) -> dict:
    return sse.call(request_id, "tools/call", {"name": name, "arguments": arguments})


def fetch_node(sse: SseClient, start_request_id: int, name: str, node_id: str, out_dir: Path, tool_names: set[str]) -> int:
    node_dir = out_dir / name
    raw_dir = node_dir / "raw"
    assets_dir = node_dir / "assets"
    raw_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)

    request_id = start_request_id
    common = {
        "nodeId": node_id,
        "clientLanguages": "html,css,javascript,typescript",
        "clientFrameworks": "react",
    }
    tool_plan = [
        ("get_design_context", common),
        ("get_metadata", common),
        ("get_variable_defs", common),
        ("get_screenshot", {"nodeId": node_id, "contentsOnly": False}),
    ]

    for tool_name, tool_args in tool_plan:
        if tool_name not in tool_names:
            continue
        result = call_tool(sse, request_id, tool_name, tool_args)
        write_json(raw_dir / f"{tool_name}.json", result)
        if tool_name == "get_screenshot":
            content = result.get("result", {}).get("content", [])
            if content and content[0].get("type") == "image":
                image_data = base64.b64decode(content[0]["data"])
                (assets_dir / f"node-{safe_name(node_id)}.png").write_bytes(image_data)
        request_id += 1

    print(f"{name}\t{node_id}\t{node_dir}")
    return request_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nodes", action="append", default=[], help="逗号分隔的 node ID，或 name=node-id 形式的列表")
    parser.add_argument("--nodes-file", help="每行一个节点的文件，格式为 name<TAB>node-id 或 name=node-id")
    parser.add_argument("--out-dir", required=True, help="输出目录，通常是 .figma-to-product/work/figma-<node>/style-nodes（项目根目录下）")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Figma MCP 的 base URL")
    args = parser.parse_args()

    nodes = parse_nodes(args.nodes, args.nodes_file)
    if not nodes:
        print("未提供任何节点", file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    sse = SseClient(args.base_url)
    sse.start()
    write_json(
        out_dir / "initialize.json",
        sse.call(
            1,
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {"roots": {"listChanged": True}, "sampling": {}},
                "clientInfo": {"name": "codex-figma-style-node-fetch", "version": "0.1.0"},
            },
        ),
    )
    sse.post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    tools = sse.call(2, "tools/list")
    write_json(out_dir / "tools-list.json", tools)
    tool_names = {tool.get("name") for tool in tools.get("result", {}).get("tools", [])}

    request_id = 3
    for name, node_id in nodes:
        request_id = fetch_node(sse, request_id, name, node_id, out_dir, tool_names)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
