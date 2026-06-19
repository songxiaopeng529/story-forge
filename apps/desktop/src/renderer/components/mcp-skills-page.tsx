import type { McpConfigView, McpServerView, SkillView } from "@story-forge/shared";
import { Save, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { formatError } from "../renderer-utils";

type ExtensionTab = "skills" | "mcp";

export function McpSkillsPage(props: {
  error: string | undefined;
  onError: (message: string | undefined) => void;
}) {
  const [tab, setTab] = useState<ExtensionTab>("skills");
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [mcpConfig, setMcpConfig] = useState<McpConfigView>();
  const [mcpJson, setMcpJson] = useState("");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const [nextSkills, nextMcpConfig] = await Promise.all([
          window.storyForge.skills.list(),
          window.storyForge.mcp.get(),
        ]);
        if (disposed) {
          return;
        }
        setSkills(nextSkills);
        setMcpConfig(nextMcpConfig);
        setMcpJson(nextMcpConfig.rawJson);
      } catch (loadError) {
        if (!disposed) {
          props.onError(formatError(loadError));
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [props.onError]);

  async function importSkill(): Promise<void> {
    setBusy("import-skill");
    props.onError(undefined);
    setNotice(undefined);
    try {
      const imported = await window.storyForge.skills.importZip();
      if (!imported) {
        return;
      }
      setSkills((current) => [
        ...current.filter((skill) => skill.id !== imported.id),
        imported,
      ]);
      setNotice(`Imported ${imported.name}`);
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function setSkillEnabled(skill: SkillView, enabled: boolean): Promise<void> {
    setBusy(`skill-${skill.id}`);
    props.onError(undefined);
    try {
      const updated = await window.storyForge.skills.setEnabled({
        skillId: skill.id,
        enabled,
      });
      setSkills((current) =>
        current.map((candidate) => candidate.id === updated.id ? updated : candidate)
      );
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function removeSkill(skill: SkillView): Promise<void> {
    setBusy(`skill-${skill.id}`);
    props.onError(undefined);
    try {
      await window.storyForge.skills.remove(skill.id);
      setSkills((current) => current.filter((candidate) => candidate.id !== skill.id));
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function saveMcpConfig(): Promise<void> {
    setBusy("save-mcp");
    props.onError(undefined);
    setNotice(undefined);
    try {
      const saved = await window.storyForge.mcp.save({ rawJson: mcpJson });
      setMcpConfig(saved);
      setMcpJson(saved.rawJson);
      setNotice("MCP config saved");
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function testMcpServer(server: McpServerView): Promise<void> {
    setBusy(`mcp-${server.name}`);
    props.onError(undefined);
    setNotice(undefined);
    try {
      const tested = await window.storyForge.mcp.testServer(server.name);
      setMcpConfig((current) => current
        ? {
            ...current,
            servers: current.servers.map((candidate) =>
              candidate.name === tested.name ? tested : candidate
            ),
          }
        : current
      );
      setNotice(`${tested.name} ${tested.status}`);
    } catch (error) {
      props.onError(formatError(error));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="min-h-0 min-w-0 overflow-y-auto p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">MCP & Skills</h2>
            <p className="mt-1 text-sm text-slate-500">
              Manage callable Skills and MCP server configuration.
            </p>
          </div>
          {notice ? (
            <span className="rounded-md bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700">
              {notice}
            </span>
          ) : null}
        </div>

        <div className="mt-6 inline-flex rounded-md border border-forge-line bg-white p-1" role="tablist">
          <TabButton active={tab === "skills"} label="Skills" onClick={() => setTab("skills")} />
          <TabButton active={tab === "mcp"} label="MCP Servers" onClick={() => setTab("mcp")} />
        </div>

        {props.error ? (
          <div className="mt-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {props.error}
          </div>
        ) : null}

        {tab === "skills" ? (
          <div className="mt-5 rounded-lg border border-forge-line bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Skills</h3>
              <button
                className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={Boolean(busy)}
                onClick={() => void importSkill()}
                type="button"
              >
                <Upload size={15} />
                Import Skill
              </button>
            </div>
            <div className="mt-4 divide-y divide-forge-line">
              {skills.length > 0 ? skills.map((skill) => (
                <div className="flex items-center justify-between gap-4 py-4" key={skill.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold">{skill.name}</h4>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                        {skill.invocationName}
                      </code>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        skill.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {skill.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{skill.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                      <span>Enabled</span>
                      <input
                        aria-label={`Enable ${skill.name}`}
                        checked={skill.enabled}
                        className="h-5 w-9 accent-forge-ember"
                        disabled={Boolean(busy)}
                        onChange={(event) => void setSkillEnabled(skill, event.currentTarget.checked)}
                        role="switch"
                        type="checkbox"
                      />
                    </label>
                    <button
                      aria-label={`Delete ${skill.name}`}
                      className="secondary-button inline-flex items-center gap-2"
                      disabled={Boolean(busy)}
                      onClick={() => void removeSkill(skill)}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )) : (
                <p className="py-5 text-sm text-slate-500">No skills installed.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="rounded-lg border border-forge-line bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">MCP JSON</h3>
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => void saveMcpConfig()}
                  type="button"
                >
                  <Save size={15} />
                  Save MCP config
                </button>
              </div>
              <textarea
                aria-label="MCP configuration JSON"
                className="mt-4 min-h-[360px] w-full resize-y rounded-md border border-forge-line bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-50 outline-none ring-forge-ember focus:ring-2"
                onChange={(event) => setMcpJson(event.currentTarget.value)}
                spellCheck={false}
                value={mcpJson}
              />
            </div>
            <div className="rounded-lg border border-forge-line bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold">Servers</h3>
              <div className="mt-3 space-y-3">
                {mcpConfig?.servers.length ? mcpConfig.servers.map((server) => (
                  <div className="rounded-md border border-forge-line p-3" key={server.name}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold">{server.name}</h4>
                        <p className="mt-0.5 text-xs text-slate-500">{server.transport}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(server.status)}`}>
                        {server.status}
                      </span>
                    </div>
                    {server.lastError ? (
                      <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                        {server.lastError}
                      </p>
                    ) : null}
                    <button
                      aria-label={`Test ${server.name}`}
                      className="secondary-button mt-3 w-full"
                      disabled={Boolean(busy)}
                      onClick={() => void testMcpServer(server)}
                      type="button"
                    >
                      Test connection
                    </button>
                    {server.tools.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {server.tools.map((tool) => (
                          <div className="rounded bg-slate-50 px-2 py-1.5" key={tool.name}>
                            <p className="text-xs font-semibold text-slate-700">{tool.name}</p>
                            {tool.description ? (
                              <p className="mt-0.5 text-xs text-slate-500">{tool.description}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )) : (
                  <p className="text-sm text-slate-500">No MCP servers configured.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-selected={props.active}
      className={`rounded px-3 py-1.5 text-sm font-medium ${
        props.active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
      }`}
      onClick={props.onClick}
      role="tab"
      type="button"
    >
      {props.label}
    </button>
  );
}

function statusClass(status: McpServerView["status"]): string {
  if (status === "success") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "bg-red-50 text-red-700";
  }
  return "bg-slate-100 text-slate-600";
}
