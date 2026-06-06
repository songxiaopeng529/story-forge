import type { ProviderId } from "@story-forge/model-gateway";
import { Save } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ProviderView } from "../../shared/story-forge-api";
import { formatError } from "../renderer-utils";

export function ModelsPage(props: {
  providers: ProviderView[];
  selectedProvider: ProviderView | undefined;
  onProvidersChange: (providers: ProviderView[]) => void;
  onSelect: (providerId: ProviderId) => void;
  onError: (message: string | undefined) => void;
  error: string | undefined;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    setBaseUrl(props.selectedProvider?.baseUrl ?? "");
    setModel(props.selectedProvider?.model ?? "");
    setApiKey("");
    setModels(props.selectedProvider?.recommendedModels ?? []);
    setNotice(undefined);
  }, [props.selectedProvider?.providerId]);

  const updateProvider = (provider: ProviderView) => {
    props.onProvidersChange(props.providers.map((candidate) =>
      candidate.providerId === provider.providerId ? provider : candidate
    ));
  };

  async function save(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }
    setBusy("save");
    props.onError(undefined);
    try {
      const saved = await window.storyForge.providers.save({
        providerId: props.selectedProvider.providerId,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      updateProvider(saved);
      setApiKey("");
      setNotice("Provider saved");
    } catch (saveError) {
      props.onError(formatError(saveError));
    } finally {
      setBusy(undefined);
    }
  }

  async function testProvider(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }
    setBusy("test");
    try {
      const result = await window.storyForge.providers.test(
        props.selectedProvider.providerId,
      );
      setModels(result.models);
      setNotice(`Connection succeeded · ${result.models.length} models`);
      props.onProvidersChange(await window.storyForge.providers.list());
    } catch (testError) {
      props.onError(formatError(testError));
    } finally {
      setBusy(undefined);
    }
  }

  async function discoverModels(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }
    setBusy("discover");
    try {
      const discovered = await window.storyForge.providers.discoverModels(
        props.selectedProvider.providerId,
      );
      setModels(discovered);
      setNotice(`Found ${discovered.length} models`);
    } catch (discoverError) {
      props.onError(formatError(discoverError));
    } finally {
      setBusy(undefined);
    }
  }

  async function clearSecret(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }
    setBusy("clear");
    try {
      await window.storyForge.providers.clearSecret(props.selectedProvider.providerId);
      props.onProvidersChange(await window.storyForge.providers.list());
      setApiKey("");
      setNotice("API key cleared");
    } catch (clearError) {
      props.onError(formatError(clearError));
    } finally {
      setBusy(undefined);
    }
  }

  async function setDefault(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }
    await window.storyForge.providers.setDefault(props.selectedProvider.providerId);
    props.onProvidersChange(await window.storyForge.providers.list());
  }

  return (
    <div className="grid min-w-0 grid-cols-[250px_1fr]">
      <aside className="border-r border-forge-line bg-white p-3">
        <div className="px-2 py-3">
          <h2 className="text-sm font-semibold">Model providers</h2>
          <p className="mt-1 text-xs text-slate-500">Keys stay encrypted in Electron.</p>
        </div>
        <div className="mt-2 space-y-1">
          {props.providers.map((provider) => (
            <button
              className={`flex w-full items-center justify-between rounded-md px-3 py-3 text-left ${
                provider.providerId === props.selectedProvider?.providerId
                  ? "bg-orange-50 text-forge-ember"
                  : "hover:bg-slate-50"
              }`}
              key={provider.providerId}
              onClick={() => props.onSelect(provider.providerId)}
              type="button"
            >
              <span>
                <span className="block text-sm font-medium">{provider.displayName}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {provider.hasSecret ? "Key configured" : "Not configured"}
                </span>
              </span>
              {provider.isDefault ? (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-white">
                  Default
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </aside>
      <section className="min-w-0 overflow-y-auto p-8">
        {props.selectedProvider ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{props.selectedProvider.displayName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Configure a recommended or custom model ID.
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs ${
                props.selectedProvider.lastTestStatus === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : props.selectedProvider.lastTestStatus === "failed"
                    ? "bg-red-50 text-red-700"
                    : "bg-slate-100 text-slate-600"
              }`}>
                {props.selectedProvider.lastTestStatus}
              </span>
            </div>

            <div className="mt-7 space-y-5 rounded-xl border border-forge-line bg-white p-6 shadow-sm">
              {props.error ? (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {props.error}
                </div>
              ) : null}
              <Field label="Base URL">
                <input
                  className="form-input"
                  onChange={(event) => setBaseUrl(event.target.value)}
                  value={baseUrl}
                />
              </Field>
              <Field label="Model ID">
                <input
                  className="form-input"
                  list="provider-models"
                  onChange={(event) => setModel(event.target.value)}
                  value={model}
                />
                <datalist id="provider-models">
                  {models.map((modelId) => <option key={modelId} value={modelId} />)}
                </datalist>
              </Field>
              <Field label="API key">
                <input
                  aria-label="API key"
                  autoComplete="off"
                  className="form-input"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={props.selectedProvider.hasSecret ? "Configured" : "Enter API key"}
                  type="password"
                  value={apiKey}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave blank to keep the current key. StoryForge never reads it back.
                </p>
              </Field>

              {notice ? (
                <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {notice}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-5">
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-forge-ember px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => void save()}
                  type="button"
                >
                  <Save size={15} />
                  Save provider
                </button>
                <button
                  className="secondary-button"
                  disabled={Boolean(busy) || !props.selectedProvider.hasSecret}
                  onClick={() => void testProvider()}
                  type="button"
                >
                  Test connection
                </button>
                <button
                  className="secondary-button"
                  disabled={Boolean(busy) || !props.selectedProvider.hasSecret}
                  onClick={() => void discoverModels()}
                  type="button"
                >
                  Discover models
                </button>
                {!props.selectedProvider.isDefault ? (
                  <button
                    className="secondary-button"
                    onClick={() => void setDefault()}
                    type="button"
                  >
                    Set default
                  </button>
                ) : null}
                {props.selectedProvider.hasSecret ? (
                  <button
                    className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    disabled={Boolean(busy)}
                    onClick={() => void clearSecret()}
                    type="button"
                  >
                    Clear key
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{props.label}</span>
      {props.children}
    </label>
  );
}
