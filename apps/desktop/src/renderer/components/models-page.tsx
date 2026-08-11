import { Check, Eye, EyeOff, Save } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { ProviderId, ProviderView } from "../../shared/story-forge-api";
import { getProviderIconUrl } from "../utils/provider-icons";
import { formatError } from "../utils/renderer-utils";
import { useI18n } from "../i18n";

const SAVED_API_KEY_MASK = "************";

export function ModelsPage(props: {
  providers: ProviderView[];
  selectedProvider: ProviderView | undefined;
  onProvidersChange: (providers: ProviderView[]) => void;
  onSelect: (providerId: ProviderId) => void;
  onError: (message: string | undefined) => void;
  error: string | undefined;
}) {
  const t = useI18n();
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    setBaseUrl(props.selectedProvider?.baseUrl ?? "");
    setModel(props.selectedProvider?.model ?? "");
    setApiKey(props.selectedProvider?.hasSecret ? SAVED_API_KEY_MASK : "");
    setApiKeyDirty(false);
    setApiKeyVisible(false);
    setModels(props.selectedProvider?.recommendedModels ?? []);
    setNotice(undefined);
  }, [props.selectedProvider?.providerId, props.selectedProvider?.hasSecret]);

  async function save(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }
    setBusy("save");
    props.onError(undefined);
    try {
      const nextApiKey = apiKeyDirty ? apiKey.trim() : "";
      const saved = await window.storyForge.providers.save({
        providerId: props.selectedProvider.providerId,
        baseUrl,
        model,
        ...(nextApiKey ? { apiKey: nextApiKey } : {}),
      });
      props.onProvidersChange(await window.storyForge.providers.list());
      setBaseUrl(saved.baseUrl);
      setModels(saved.recommendedModels);
      setApiKey(saved.hasSecret ? SAVED_API_KEY_MASK : "");
      setApiKeyDirty(false);
      setApiKeyVisible(false);
      setNotice(t.models.providerSaved);
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
      setNotice(t.models.connectionSucceeded(result.models.length));
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
      setNotice(t.models.foundModels(discovered.length));
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
      setApiKeyDirty(false);
      setApiKeyVisible(false);
      setNotice(t.models.apiKeyCleared);
    } catch (clearError) {
      props.onError(formatError(clearError));
    } finally {
      setBusy(undefined);
    }
  }

  async function setDefaultModel(providerId: ProviderId, modelId: string): Promise<void> {
    setBusy("default");
    props.onError(undefined);
    try {
      await window.storyForge.providers.setDefault({
        providerId,
        model: modelId,
      });
      props.onProvidersChange(await window.storyForge.providers.list());
      if (props.selectedProvider?.providerId === providerId) {
        setModel(modelId);
      }
      setNotice(t.models.defaultModelSet(modelId));
    } catch (defaultError) {
      props.onError(formatError(defaultError));
    } finally {
      setBusy(undefined);
    }
  }

  async function toggleApiKeyVisibility(): Promise<void> {
    if (!props.selectedProvider) {
      return;
    }

    props.onError(undefined);
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      if (!apiKeyDirty && props.selectedProvider.hasSecret) {
        setApiKey(SAVED_API_KEY_MASK);
      }
      return;
    }

    if (!apiKeyDirty && props.selectedProvider.hasSecret) {
      setBusy("reveal");
      try {
        const secret = await window.storyForge.providers.revealSecret(
          props.selectedProvider.providerId,
        );
        if (!secret) {
          props.onError(t.models.noSavedKey);
          return;
        }
        setApiKey(secret);
        setApiKeyDirty(false);
        setApiKeyVisible(true);
      } catch (revealError) {
        props.onError(formatError(revealError));
      } finally {
        setBusy(undefined);
      }
      return;
    }

    setApiKeyVisible(true);
  }

  return (
    <div
      className="grid min-h-0 min-w-0 grid-cols-[250px_1fr] overflow-hidden"
      data-testid="models-page"
    >
      <aside className="flex min-h-0 flex-col overflow-hidden border-r border-forge-line bg-white p-3">
        <div className="flex-none px-2 py-3">
          <h2 className="text-sm font-semibold">{t.models.providersTitle}</h2>
          <p className="mt-1 text-xs text-slate-500">{t.models.providersSubtitle}</p>
        </div>
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" data-testid="model-provider-list">
          {props.providers.map((provider) => (
            <button
              className={`flex w-full items-center justify-between rounded-md px-3 py-3 text-left ${
                provider.providerId === props.selectedProvider?.providerId
                  ? "bg-orange-50 text-forge-ember"
                  : "hover:bg-slate-50"
              }`}
              key={provider.providerId}
              onClick={() => props.onSelect(provider.providerId)}
              onDoubleClick={() => {
                props.onSelect(provider.providerId);
                if (provider.hasSecret && provider.model) {
                  void setDefaultModel(provider.providerId, provider.model);
                }
              }}
              title={provider.hasSecret && provider.model
                ? t.models.providerTitle(provider.displayName, provider.model)
                : provider.displayName}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <ProviderLogo provider={provider} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{provider.displayName}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {provider.hasSecret ? t.models.keyConfigured : t.models.notConfigured}
                  </span>
                </span>
              </span>
              {provider.isDefault ? (
                <Check
                  aria-label={t.models.defaultProvider}
                  className="ml-2 flex-none text-emerald-600"
                  size={16}
                />
              ) : null}
            </button>
          ))}
        </div>
      </aside>
      <section className="min-h-0 min-w-0 overflow-y-auto p-8">
        {props.selectedProvider ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{props.selectedProvider.displayName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {t.models.configureModel}
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
              <Field label={t.models.baseUrl}>
                <input
                  aria-label={t.models.baseUrl}
                  className="form-input"
                  onChange={(event) => setBaseUrl(event.target.value)}
                  value={baseUrl}
                />
              </Field>
              <Field label={t.models.modelId}>
                <input
                  aria-label={t.models.modelId}
                  className="form-input"
                  list="provider-models"
                  onChange={(event) => setModel(event.target.value)}
                  value={model}
                />
                <datalist id="provider-models">
                  {models.map((modelId) => <option key={modelId} value={modelId} />)}
                </datalist>
              </Field>
              <ModelOptions
                defaultModel={props.selectedProvider.defaultModel}
                disabled={Boolean(busy)}
                models={models}
                selectedModel={model}
                text={t.models}
                onMakeDefault={(modelId) => {
                  const providerId = props.selectedProvider?.providerId;
                  if (providerId) {
                    void setDefaultModel(providerId, modelId);
                  }
                }}
                onSelect={setModel}
              />
              <Field label={t.models.apiKey}>
                <div className="relative">
                  <input
                    aria-label={t.models.apiKey}
                    autoComplete="off"
                    className="form-input pr-11"
                    onBlur={() => {
                      if (!apiKeyDirty && !apiKeyVisible && props.selectedProvider?.hasSecret) {
                        setApiKey(SAVED_API_KEY_MASK);
                      }
                    }}
                    onChange={(event) => {
                      setApiKey(event.target.value);
                      setApiKeyDirty(true);
                    }}
                    onFocus={() => {
                      if (!apiKeyDirty && apiKey === SAVED_API_KEY_MASK) {
                        setApiKey("");
                      }
                    }}
                    placeholder={props.selectedProvider.hasSecret ? t.models.savedKey : t.models.enterApiKey}
                    type={apiKeyVisible ? "text" : "password"}
                    value={apiKey}
                  />
                  <button
                    aria-label={apiKeyVisible ? t.models.hideApiKey : t.models.showApiKey}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                    disabled={Boolean(busy)}
                    onClick={() => void toggleApiKeyVisibility()}
                    title={apiKeyVisible ? t.models.hideApiKey : t.models.showApiKey}
                    type="button"
                  >
                    {apiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {t.models.apiKeyHelp}
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
                  {t.models.saveProvider}
                </button>
                <button
                  className="secondary-button"
                  disabled={Boolean(busy) || !props.selectedProvider.hasSecret}
                  onClick={() => void testProvider()}
                  type="button"
                >
                  {t.models.testConnection}
                </button>
                <button
                  className="secondary-button"
                  disabled={Boolean(busy) || !props.selectedProvider.hasSecret}
                  onClick={() => void discoverModels()}
                  type="button"
                >
                  {t.models.discoverModels}
                </button>
                {props.selectedProvider.hasSecret ? (
                  <button
                    className="rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    disabled={Boolean(busy)}
                    onClick={() => void clearSecret()}
                    type="button"
                  >
                    {t.models.clearKey}
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

function ModelOptions(props: {
  defaultModel: string | undefined;
  disabled: boolean;
  models: string[];
  selectedModel: string;
  text: ReturnType<typeof useI18n>["models"];
  onMakeDefault: (modelId: string) => void;
  onSelect: (modelId: string) => void;
}) {
  if (props.models.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid="provider-model-options">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{props.text.availableModels}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {props.models.length}
        </span>
      </div>
      <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-1">
        {props.models.map((modelId) => {
          const selected = modelId === props.selectedModel;
          const isDefault = modelId === props.defaultModel;
          return (
            <button
              aria-pressed={selected}
              className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-xs font-medium ${
                selected
                  ? "bg-white text-forge-ember shadow-sm"
                  : "text-slate-600 hover:bg-white"
              }`}
              disabled={props.disabled}
              key={modelId}
              onClick={() => props.onSelect(modelId)}
              onDoubleClick={() => props.onMakeDefault(modelId)}
              title={props.text.modelTitle(modelId)}
              type="button"
            >
              <span className="min-w-0 truncate">{modelId}</span>
              {isDefault ? (
                <span className="flex-none rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-white">
                  {props.text.defaultBadge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProviderLogo(props: { provider: ProviderView }) {
  const iconUrl = getProviderIconUrl(props.provider.providerId);
  if (!iconUrl) {
    return null;
  }

  return (
    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-slate-200 bg-white p-1">
      <img
        alt={getProviderLogoAlt(props.provider)}
        className="h-full w-full object-contain"
        draggable={false}
        src={iconUrl}
      />
    </span>
  );
}

function getProviderLogoAlt(provider: ProviderView): string {
  return getProviderIconUrl(provider.providerId)
    ? `${provider.displayName} provider logo`
    : provider.displayName;
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{props.label}</span>
      {props.children}
    </div>
  );
}
