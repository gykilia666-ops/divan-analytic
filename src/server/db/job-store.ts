import "server-only";
import { z } from "zod";
import { LeaseLostError, type JobStore } from "../jobs/pipeline";
import type { AdminSupabase } from "./supabase-admin";

const resultsSchema = z.object({
  observed: z.number().int(),
  confirmed: z.number().int(),
  conflicts: z.number().int(),
});
const settleSchema = z.object({
  resolved: z.number().int(),
  void: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
});

function fail(name: string, error: { code?: string; message?: string }): never {
  if (error.message?.includes("LEASE_LOST")) throw new LeaseLostError();
  throw new Error(`${name} failed: ${error.code ?? "unknown"}`);
}

/** Аренда, журнал запусков, подтверждение и расчет поверх SQL-функций (только service_role). */
export function createSupabaseJobStore(client: AdminSupabase): JobStore {
  return {
    async acquireLease(job, owner, seconds) {
      const { data, error } = await client.rpc("job_acquire_lease", {
        p_job: job,
        p_owner: owner,
        p_seconds: seconds,
      });
      if (error) fail("job_acquire_lease", error);
      return data === null ? null : z.number().int().parse(data);
    },
    async releaseLease(job, owner, generation) {
      const { data, error } = await client.rpc("job_release_lease", {
        p_job: job,
        p_owner: owner,
        p_generation: generation,
      });
      if (error) fail("job_release_lease", error);
      return z.boolean().parse(data);
    },
    async startRun(job, generation) {
      const { data, error } = await client.rpc("job_run_start", {
        p_job: job,
        p_generation: generation,
      });
      if (error) fail("job_run_start", error);
      return z.string().parse(data);
    },
    async finishRun(runId, status, summary, errorCode) {
      const { error } = await client.rpc("job_run_finish", {
        p_run: runId,
        p_status: status,
        p_summary: summary,
        p_error: errorCode,
      });
      if (error) fail("job_run_finish", error);
    },
    async confirmResults(provider) {
      const { data, error } = await client.rpc("sync_confirm_results", { p_provider: provider });
      if (error) fail("sync_confirm_results", error);
      return resultsSchema.parse(data);
    },
    async settle(job, owner, generation, limit) {
      const { data, error } = await client.rpc("settle_ready_markets", {
        p_job: job,
        p_owner: owner,
        p_generation: generation,
        p_limit: limit,
      });
      if (error) fail("settle_ready_markets", error);
      return settleSchema.parse(data);
    },
    async cleanup() {
      const { data, error } = await client.rpc("job_cleanup");
      if (error) fail("job_cleanup", error);
      return z.record(z.string(), z.number().int()).parse(data);
    },
  };
}
