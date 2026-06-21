"""通过 Chrome DevTools Protocol 直接对已打开的 tab 截图。

适用场景（browser-use CLI 失效时的兜底）：

- macOS 上 `~/.browser-use/default.state.json` 因 TCC 保护写不进去，
  导致 `browser-use screenshot` 报 `Session already running with different config`。
- 想在已经带 `--remote-debugging-port=9222` 启动的 Chrome 上，
  对一个**指定 URL 子串的 tab** 直接截图，而不创建新 session。
- 任何"Chrome 已带调试端口启动 + 我只想拿一张图"的场景。

使用前提：
  Chrome 已使用调试端口启动，例如：

    nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --remote-debugging-port=9222 \
      --user-data-dir="$HOME/chrome-debug" \
      --no-first-run --no-default-browser-check \
      >/tmp/chrome-debug.log 2>&1 & disown

  详细的启动与排障流程见 references/browser-use-setup.md。

依赖：httpx + websockets。最方便的运行方式：

    uvx --with httpx --with websockets python \
      .trae/skills/figma-to-product/scripts/cdp_screenshot.py \
      "<url-substring>" "<save-path>"

例如：

    uvx --with httpx --with websockets python \
      .trae/skills/figma-to-product/scripts/cdp_screenshot.py \
      "rmp.bytedance.net/punishment_report" \
      ".figma-to-product/work/figma-<node-id>/product/screenshot.png"
"""

import asyncio
import base64
import json
import sys
from pathlib import Path

import httpx
import websockets


async def capture(
    target_url_substr: str,
    save_path: str,
    cdp_http: str = "http://127.0.0.1:9222",
    full_page: bool = True,
) -> None:
    """根据 URL 子串定位 tab 并截图，保存到 save_path。"""

    # 1) 通过 HTTP 找到目标 tab 的 webSocketDebuggerUrl
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{cdp_http}/json")
        except httpx.RequestError as exc:
            print(
                f"[ERROR] 无法连接到 CDP：{cdp_http}。请先用调试端口启动 Chrome。",
                file=sys.stderr,
            )
            print(f"        原因：{exc}", file=sys.stderr)
            sys.exit(2)
        targets = resp.json()

    tab = next(
        (
            t
            for t in targets
            if t.get("type") == "page" and target_url_substr in t.get("url", "")
        ),
        None,
    )
    if tab is None:
        print(
            f"[ERROR] 找不到 URL 包含 `{target_url_substr}` 的 tab。",
            file=sys.stderr,
        )
        print("当前已打开的 tab：", file=sys.stderr)
        for t in targets:
            print(f"  - {t.get('type')}  {t.get('url')}", file=sys.stderr)
        sys.exit(1)

    ws_url = tab["webSocketDebuggerUrl"]
    print(f"[INFO] 命中 tab: {tab['url']}")
    print(f"[INFO] WS: {ws_url}")

    # 2) 连接到该 tab，发 Page.captureScreenshot
    async with websockets.connect(ws_url, max_size=200_000_000) as ws:
        msg_id = 1

        async def send(method: str, params: dict | None = None) -> dict:
            nonlocal msg_id
            payload: dict = {"id": msg_id, "method": method}
            if params:
                payload["params"] = params
            await ws.send(json.dumps(payload))
            target_id = msg_id
            msg_id += 1
            while True:
                raw = await ws.recv()
                data = json.loads(raw)
                if data.get("id") == target_id:
                    return data

        await send("Page.enable")
        result = await send(
            "Page.captureScreenshot",
            {"format": "png", "captureBeyondViewport": full_page},
        )
        data_b64 = result.get("result", {}).get("data")
        if not data_b64:
            print(f"[ERROR] 截图失败：{result}", file=sys.stderr)
            sys.exit(1)

        out = Path(save_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(data_b64))
        print(
            f"[OK] 截图已保存: {out.resolve()}  size={out.stat().st_size} bytes"
        )


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] in {"-h", "--help"}:
        print(__doc__)
        sys.exit(0)

    target = sys.argv[1]
    save = sys.argv[2] if len(sys.argv) > 2 else ".figma-to-product/screenshot.png"
    cdp = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:9222"

    asyncio.run(capture(target, save, cdp_http=cdp, full_page=True))


if __name__ == "__main__":
    main()
