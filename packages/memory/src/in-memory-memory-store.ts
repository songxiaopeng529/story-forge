export type MemoryScope = "session" | "project" | "user";

export type MemoryEntry = {
  scope: MemoryScope;
  key: string;
  value: string;
};

export type MemoryQuery = {
  scope: MemoryScope;
  query: string;
};

export interface MemoryStore {
  write(entry: MemoryEntry): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly entries: MemoryEntry[] = [];

  async write(entry: MemoryEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const normalizedQuery = query.query.toLowerCase();

    return this.entries
      .filter((entry) => {
        const searchableText = `${entry.key} ${entry.value}`.toLowerCase();
        return entry.scope === query.scope && searchableText.includes(normalizedQuery);
      })
      .map((entry) => ({ ...entry }));
  }
}
