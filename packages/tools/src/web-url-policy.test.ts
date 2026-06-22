import { describe, expect, it } from "vitest";
import { assertPublicWebUrl, canonicalizeUrl } from "./web-url-policy";

describe("web-url-policy", () => {
  it("allows public http and https URLs", () => {
    expect(canonicalizeUrl("https://example.com/docs?b=2#intro")).toBe(
      "https://example.com/docs?b=2",
    );
    expect(() => assertPublicWebUrl("http://example.com")).not.toThrow();
  });

  it.each([
    "file:///etc/passwd",
    "data:text/plain,hello",
    "javascript:alert(1)",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "not a url",
  ])("blocks unsafe URL %s", (url) => {
    expect(() => assertPublicWebUrl(url)).toThrow(/web.fetch blocked URL|web.fetch requires/);
  });
});
