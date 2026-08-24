import type { SoulDocumentView, SoulMode } from "@story-forge/shared";
import { Eye, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { useI18n } from "../i18n";

export function SoulSettingsSection(props: {
  soulMode: SoulMode;
  settingsSaving: boolean;
  onSoulModeChange: (mode: SoulMode) => void;
}) {
  const t = useI18n();
  const [document, setDocument] = useState<SoulDocumentView>();
  const [draft, setDraft] = useState("");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const byteLength = useMemo(() => new TextEncoder().encode(draft).byteLength, [draft]);
  const dirty = Boolean(document) && draft !== document?.content;
  const overLimit = Boolean(document) && byteLength > document!.maxBytes;

  useEffect(() => {
    let disposed = false;
    void window.storyForge.soul.get()
      .then((next) => {
        if (disposed) return;
        setDocument(next);
        setDraft(next.content);
      })
      .catch((loadError: unknown) => {
        if (!disposed) setError(formatError(loadError));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function save(): Promise<void> {
    if (!document || !dirty || overLimit || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await window.storyForge.soul.save({
        content: draft,
        expectedRevision: document.revision,
      });
      setDocument(saved);
      setDraft(saved.content);
    } catch (saveError) {
      setError(formatError(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-forge-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t.settings.soulTitle}</h3>
          <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">
            {t.settings.soulDescription}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-forge-line p-0.5">
          <button
            aria-pressed={view === "edit"}
            className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
              view === "edit" ? "bg-forge-ink text-white" : "text-forge-muted hover:bg-forge-canvas"
            }`}
            onClick={() => setView("edit")}
            type="button"
          >
            <Pencil aria-hidden="true" size={14} />
            {t.settings.soulEdit}
          </button>
          <button
            aria-pressed={view === "preview"}
            className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
              view === "preview" ? "bg-forge-ink text-white" : "text-forge-muted hover:bg-forge-canvas"
            }`}
            onClick={() => setView("preview")}
            type="button"
          >
            <Eye aria-hidden="true" size={14} />
            {t.settings.soulPreview}
          </button>
        </div>
      </div>

      <div aria-label={t.settings.soulModeTitle} className="mt-5 grid gap-2 sm:grid-cols-3" role="radiogroup">
        {t.settings.soulModeOptions.map((option) => {
          const descriptionId = `soul-mode-${option.value}-description`;
          return (
            <button
              aria-checked={props.soulMode === option.value}
              aria-describedby={descriptionId}
              aria-label={option.label}
              className={`rounded-md border px-3 py-3 text-left disabled:opacity-60 ${
                props.soulMode === option.value
                  ? "border-2 border-forge-ember text-forge-ember"
                  : "border-forge-line hover:bg-slate-50"
              }`}
              disabled={props.settingsSaving}
              key={option.value}
              onClick={() => props.onSoulModeChange(option.value)}
              role="radio"
              type="button"
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500" id={descriptionId}>
                {option.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-md border border-forge-line bg-forge-canvas text-sm text-forge-muted">
            {t.settings.soulLoading}
          </div>
        ) : view === "edit" ? (
          <textarea
            aria-label={t.settings.soulEditorLabel}
            className="h-64 w-full resize-y rounded-md border border-forge-line bg-white px-3 py-3 font-mono text-sm leading-6 text-forge-ink outline-none focus:border-forge-ink/50"
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={t.settings.soulPlaceholder}
            spellCheck={false}
            value={draft}
          />
        ) : (
          <div className="min-h-64 rounded-md border border-forge-line bg-forge-canvas px-4 py-3 text-sm leading-6 text-forge-ink">
            {draft.trim() ? (
              <Streamdown mode="static">{draft}</Streamdown>
            ) : (
              <p className="text-forge-muted">{t.settings.soulEmpty}</p>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span className="min-w-0 truncate" title={document?.filePath}>{document?.filePath}</span>
        <span className={overLimit ? "font-medium text-red-600" : undefined}>
          {t.settings.soulSize(byteLength, document?.maxBytes ?? 0)}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{t.settings.soulPrivacyNotice}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-forge-line pt-4">
        <button
          className="flex h-9 items-center gap-2 rounded-md bg-forge-ink px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!dirty || overLimit || saving || loading}
          onClick={() => void save()}
          type="button"
        >
          <Save aria-hidden="true" size={16} />
          {saving ? t.settings.soulSaving : t.settings.soulSave}
        </button>
        <button
          aria-label={t.settings.soulRevert}
          className="flex h-9 items-center gap-2 rounded-md border border-forge-line px-3 text-sm font-medium text-forge-muted hover:bg-forge-canvas disabled:opacity-50"
          disabled={!dirty || saving}
          onClick={() => setDraft(document?.content ?? "")}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
          {t.settings.soulRevert}
        </button>
        <button
          aria-label={t.settings.soulClear}
          className="ml-auto flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          disabled={!draft || saving}
          onClick={() => setDraft("")}
          type="button"
        >
          <Trash2 aria-hidden="true" size={16} />
          {t.settings.soulClear}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
