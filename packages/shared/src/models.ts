export type ProviderId = string;

export type ProviderView = {
  providerId: ProviderId;
  displayName: string;
  baseUrl: string;
  model: string;
  recommendedModels: string[];
  supportsImageInput: boolean;
  isDefault: boolean;
  hasSecret: boolean;
  lastTestStatus: "untested" | "success" | "failed";
  lastTestedAt?: string;
};

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type ImageAttachmentView = {
  id: string;
  name: string;
  mediaType: string;
  data: string;
  size: number;
};
