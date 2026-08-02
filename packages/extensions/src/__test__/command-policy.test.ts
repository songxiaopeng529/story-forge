import { describe, expect, it } from "vitest";
import { classifyCommand } from "../permissions/command-policy";

describe("classifyCommand", () => {
  it("allows read-only discovery in sentinel mode", () => {
    expect(classifyCommand({
      mode: "sentinel",
      program: "which",
      args: ["agent-browser"],
    })).toMatchObject({ action: "allow", risk: "safe" });
  });

  it("confirms unknown commands in sentinel mode", () => {
    expect(classifyCommand({
      mode: "sentinel",
      program: "agent-browser",
      args: ["screenshot"],
    })).toMatchObject({ action: "confirm", risk: "unknown" });
  });

  it("allows non-destructive unknown commands in cruise mode", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "agent-browser",
      args: ["screenshot"],
    })).toMatchObject({ action: "allow", risk: "low" });
  });

  it("confirms destructive commands in cruise mode", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "rm",
      args: ["-rf", "dist"],
    })).toMatchObject({ action: "confirm", risk: "destructive" });
  });

  it("allows destructive commands in unleashed mode", () => {
    expect(classifyCommand({
      mode: "unleashed",
      program: "rm",
      args: ["-rf", "dist"],
    })).toMatchObject({ action: "allow", risk: "low" });
  });

  it("confirms high-risk commands in sentinel and cruise but not unleashed", () => {
    expect(classifyCommand({
      mode: "sentinel",
      program: "bash",
      args: ["-lc", "echo hi"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "bash",
      args: ["-lc", "echo hi"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "unleashed",
      program: "bash",
      args: ["-lc", "echo hi"],
    })).toMatchObject({ action: "allow", risk: "low" });
  });

  it("treats secret inspection and remote access as high-risk", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "node",
      args: ["-e", "console.log(process.env)"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "ssh",
      args: ["example.com"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "env",
      args: [],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "cat",
      args: [".env"],
    })).toMatchObject({ action: "confirm", risk: "high" });
    expect(classifyCommand({
      mode: "cruise",
      program: "bash",
      args: ["-lc", "cat .env"],
    })).toMatchObject({ action: "confirm", risk: "high" });
  });

  it("does not classify curl or wget as high-risk by themselves", () => {
    expect(classifyCommand({
      mode: "cruise",
      program: "curl",
      args: ["https://example.com/file"],
    })).toMatchObject({ action: "allow", risk: "low" });
    expect(classifyCommand({
      mode: "cruise",
      program: "wget",
      args: ["https://example.com/file"],
    })).toMatchObject({ action: "allow", risk: "low" });
    expect(classifyCommand({
      mode: "sentinel",
      program: "curl",
      args: ["https://example.com/file"],
    })).toMatchObject({ action: "confirm", risk: "unknown" });
  });
});
