import amazonBedrockIconUrl from "@lobehub/icons-static-svg/icons/bedrock-color.svg?url";
import anthropicIconUrl from "@lobehub/icons-static-svg/icons/anthropic.svg?url";
import antLingIconUrl from "@lobehub/icons-static-svg/icons/antgroup-color.svg?url";
import azureOpenAiIconUrl from "@lobehub/icons-static-svg/icons/azureai-color.svg?url";
import cerebrasIconUrl from "@lobehub/icons-static-svg/icons/cerebras-color.svg?url";
import cloudflareIconUrl from "@lobehub/icons-static-svg/icons/cloudflare-color.svg?url";
import cloudflareWorkersAiIconUrl from "@lobehub/icons-static-svg/icons/workersai-color.svg?url";
import codexIconUrl from "@lobehub/icons-static-svg/icons/codex-color.svg?url";
import deepseekIconUrl from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import fireworksIconUrl from "@lobehub/icons-static-svg/icons/fireworks-color.svg?url";
import githubCopilotIconUrl from "@lobehub/icons-static-svg/icons/githubcopilot.svg?url";
import googleIconUrl from "@lobehub/icons-static-svg/icons/google-color.svg?url";
import googleVertexIconUrl from "@lobehub/icons-static-svg/icons/vertexai-color.svg?url";
import groqIconUrl from "@lobehub/icons-static-svg/icons/groq.svg?url";
import huggingFaceIconUrl from "@lobehub/icons-static-svg/icons/huggingface-color.svg?url";
import kimiIconUrl from "@lobehub/icons-static-svg/icons/kimi-color.svg?url";
import minimaxIconUrl from "@lobehub/icons-static-svg/icons/minimax-color.svg?url";
import mistralIconUrl from "@lobehub/icons-static-svg/icons/mistral-color.svg?url";
import moonshotIconUrl from "@lobehub/icons-static-svg/icons/moonshot.svg?url";
import nvidiaIconUrl from "@lobehub/icons-static-svg/icons/nvidia-color.svg?url";
import openaiIconUrl from "@lobehub/icons-static-svg/icons/openai.svg?url";
import opencodeIconUrl from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import openrouterIconUrl from "@lobehub/icons-static-svg/icons/openrouter-color.svg?url";
import piIconUrl from "@lobehub/icons-static-svg/icons/pi.svg?url";
import qwenIconUrl from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import togetherIconUrl from "@lobehub/icons-static-svg/icons/together-color.svg?url";
import vercelIconUrl from "@lobehub/icons-static-svg/icons/vercel.svg?url";
import volcanoIconUrl from "@lobehub/icons-static-svg/icons/volcengine-color.svg?url";
import xaiIconUrl from "@lobehub/icons-static-svg/icons/xai.svg?url";
import xiaomiIconUrl from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import zaiIconUrl from "@lobehub/icons-static-svg/icons/zai.svg?url";

const PROVIDER_ICON_URLS: Record<string, string> = {
  "amazon-bedrock": amazonBedrockIconUrl,
  "ant-ling": antLingIconUrl,
  "anthropic": anthropicIconUrl,
  "azure-openai-responses": azureOpenAiIconUrl,
  "cerebras": cerebrasIconUrl,
  "cloudflare-ai-gateway": cloudflareIconUrl,
  "cloudflare-workers-ai": cloudflareWorkersAiIconUrl,
  "deepseek": deepseekIconUrl,
  "fireworks": fireworksIconUrl,
  "github-copilot": githubCopilotIconUrl,
  "google": googleIconUrl,
  "google-vertex": googleVertexIconUrl,
  "groq": groqIconUrl,
  "huggingface": huggingFaceIconUrl,
  "kimi-coding": kimiIconUrl,
  "minimax": minimaxIconUrl,
  "minimax-cn": minimaxIconUrl,
  "mistral": mistralIconUrl,
  "moonshotai": moonshotIconUrl,
  "moonshotai-cn": moonshotIconUrl,
  "nvidia": nvidiaIconUrl,
  "openai": openaiIconUrl,
  "openai-codex": codexIconUrl,
  "opencode": opencodeIconUrl,
  "opencode-go": opencodeIconUrl,
  "openrouter": openrouterIconUrl,
  "qwen-token-plan": qwenIconUrl,
  "qwen-token-plan-cn": qwenIconUrl,
  "radius": piIconUrl,
  "together": togetherIconUrl,
  "vercel-ai-gateway": vercelIconUrl,
  "volcano": volcanoIconUrl,
  "xai": xaiIconUrl,
  "xiaomi": xiaomiIconUrl,
  "xiaomi-token-plan-ams": xiaomiIconUrl,
  "xiaomi-token-plan-cn": xiaomiIconUrl,
  "xiaomi-token-plan-sgp": xiaomiIconUrl,
  "zai": zaiIconUrl,
  "zai-coding-cn": zaiIconUrl,
};

export function getProviderIconUrl(providerId: string): string | undefined {
  return PROVIDER_ICON_URLS[providerId];
}

export function hasProviderIcon(providerId: string): boolean {
  return providerId in PROVIDER_ICON_URLS;
}
