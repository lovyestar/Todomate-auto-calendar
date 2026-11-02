// KV storage.
//   feed:<feedId> -> FeedRecord
//   uid:<uid>     -> feedId   (so reconnecting keeps the same calendar URL)

import type { FeedOptions } from "./ics.ts";

export type FeedSettings = FeedOptions & {
  /** How many days of past todos to show. */
  readonly historyDays?: number;
};

export type FeedRecord = {
  readonly id: string;
  readonly uid: string;
  readonly tokenEnc: string;
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly options: FeedSettings;
};

export class FeedStore {
  constructor(private readonly kv: KVNamespace) {}

  get(id: string): Promise<FeedRecord | null> {
    return this.kv.get<FeedRecord>(`feed:${id}`, "json");
  }

  feedIdForUid(uid: string): Promise<string | null> {
    return this.kv.get(`uid:${uid}`);
  }

  async put(record: FeedRecord): Promise<void> {
    await Promise.all([
      this.kv.put(`feed:${record.id}`, JSON.stringify(record)),
      this.kv.put(`uid:${record.uid}`, record.id),
    ]);
  }

  async delete(record: Pick<FeedRecord, "id" | "uid">): Promise<void> {
    await Promise.all([this.kv.delete(`feed:${record.id}`), this.kv.delete(`uid:${record.uid}`)]);
  }

  deleteFeedOnly(id: string): Promise<void> {
    return this.kv.delete(`feed:${id}`);
  }
}
