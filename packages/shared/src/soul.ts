export const SOUL_MAX_BYTES = 16 * 1024;

export type SoulMode = "off" | "manual" | "ask";

export type SoulDocumentView = {
  content: string;
  revision: string;
  exists: boolean;
  byteLength: number;
  maxBytes: number;
  filePath: string;
  updatedAt?: string;
};
