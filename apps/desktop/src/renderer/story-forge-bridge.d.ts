import type { StoryForgeApi } from "../shared/story-forge-api";

export {};

declare global {
  interface Window {
    storyForge: StoryForgeApi;
  }
}
