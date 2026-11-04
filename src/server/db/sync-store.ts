import "server-only";
import { z } from "zod";
import type { SyncStore } from "../jobs/sync-matches";
import type { AdminSupabase } from "./supabase-admin";

const acquireSchema = z
  .array(z.object({ allowed: z.boolean(), retry_at: z.string().nullable() }))
  .min(1);
const upsertSchema = z.object({ inserted: z.number().int(), updated: z.number().int() });

/** Хранилище синхронизации поверх SQL-функций (доступны только service_role). */
export function createSupabaseSyncStore(client: AdminSupabase): SyncStore {
  return {
    async tryAcquire(provider, limit) {
      const { data, error } = await client.rpc("provider_try_acquire", {
        p_provider: provider,
        p_limit: limit,
      });
      if (error) throw new Error(`provider_try_acquire failed: ${error.code ?? "unknown"}`);
      const row = acquireSchema.parse(data)[0];
      if (!row) throw new Error("provider_try_acquire returned no rows");
      return { allowed: row.allowed, retryAt: row.retry_at };
    },

    async reportRateLimited(provider, retryAfterSeconds) {
      const { data, error } = await client.rpc("provider_report_rate_limited", {
        p_provider: provider,
        p_retry_after_seconds: retryAfterSeconds ?? 60,
      });
      if (error) throw new Error(`provider_report_rate_limited failed: ${error.code ?? "unknown"}`);
      return z.string().parse(data);
    },

    async upsertMatches(provider, payload) {
      const { data, error } = await client.rpc("sync_upsert_matches", {
        p_provider: provider,
        p_payload: payload,
      });
      if (error) throw new Error(`sync_upsert_matches failed: ${error.code ?? "unknown"}`);
      return upsertSchema.parse(data);
    },
  };
}
