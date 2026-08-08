import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { RuntimeEnvironmentView } from "@story-forge/shared";
import {
  createRuntimeEnvironment,
  formatRuntimeEnvironmentContext,
  resolveSystemTimezone,
  type RuntimeClock,
  type RuntimeTimezoneResolver,
} from "@story-forge/extensions";

export type RuntimeEnvironmentExtension = {
  extension: {
    name: string;
    hidden: boolean;
    factory: ExtensionFactory;
  };
  getLatest: () => RuntimeEnvironmentView | undefined;
};

export function createRuntimeEnvironmentExtension(options: {
  now?: RuntimeClock;
  getTimezone?: RuntimeTimezoneResolver;
} = {}): RuntimeEnvironmentExtension {
  const now = options.now ?? (() => new Date());
  const getTimezone = options.getTimezone ?? resolveSystemTimezone;
  let latest: RuntimeEnvironmentView | undefined;

  return {
    getLatest: () => latest,
    extension: {
      name: "storyforge-runtime-environment",
      hidden: true,
      factory: (pi) => {
        pi.on("context", (event) => {
          const timestamp = now();
          latest = createRuntimeEnvironment(timestamp, getTimezone());
          return {
            messages: [
              ...event.messages,
              {
                role: "custom",
                customType: "storyforge-runtime-environment",
                content: formatRuntimeEnvironmentContext(latest),
                display: false,
                details: latest,
                timestamp: timestamp.getTime(),
              },
            ],
          };
        });
      },
    },
  };
}
