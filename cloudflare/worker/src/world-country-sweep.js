import {
  GLOBAL_COUNTRIES,
  activeCountryCount,
  buildHimalayasCountryUrl,
  normalizeHimalayasJob,
  shardIndexFromCron,
} from "./country-ingest.js";

const FETCH_TIMEOUT_MS = 12000;
const SHARD_COUNT = 3;
const MAX_JOBS_PER_COUNTRY = 20;

function countriesForShard(cron) {
  const shard = shardIndexFromCron(cron);
  return GLOBAL_COUNTRIES.filter((_, index) => index % SHARD_COUNT === shard);
}

async function fetchCountry(country) {
  const response = await fetch(buildHimalayasCountryUrl(country.code), {
    headers: {
      accept: "application/json",
      "user-agent": "KREVUNO-World-Scanner/1.0 (+https://krevuno.com)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HIMALAYAS_${country.code}_HTTP_${response.status}`);
  const payload = await response.json();
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.slice(0, MAX_JOBS_PER_COUNTRY);
}

async function upsertRows(rows, env) {
  if (!rows.length) return 0;
  const url = String(env?.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_REQUIRED");

  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 40) {
    const batch = rows.slice(offset, offset + 40);
    const response = await fetch(`${url}/rest/v1/vovyyvov_opportunities?on_conflict=source_provider,source_id`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`SUPABASE_WORLD_SWEEP_UPSERT_${response.status}:${detail.slice(0,500)}`);
    }
    written += batch.length;
  }
  return written;
}

export async function runWorldCountrySweep(env, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cron = options.cron || "0 * * * *";
  const shard = shardIndexFromCron(cron);
  const countries = countriesForShard(cron);
  const activeCount = activeCountryCount(nowMs);
  const activeCodes = new Set(GLOBAL_COUNTRIES.slice(0, activeCount).map((country) => country.code));
  const rows = [];
  const results = [];

  for (let offset = 0; offset < countries.length; offset += 5) {
    const chunk = countries.slice(offset, offset + 5);
    const settled = await Promise.allSettled(
      chunk.map(async (country) => ({ country, jobs: await fetchCountry(country) }))
    );

    for (let index = 0; index < settled.length; index += 1) {
      const country = chunk[index];
      const result = settled[index];
      if (result.status === "fulfilled") {
        const publish = activeCodes.has(country.code);
        const normalized = result.value.jobs.map((job) => {
          const base = normalizeHimalayasJob(job, country, nowIso);
          return {
            ...base,
            public_visibility: publish,
            metadata: {
              ...base.metadata,
              world_scanner: true,
              rollout_public: publish,
            },
          };
        });
        rows.push(...normalized);
        results.push({ country: country.code, ok: true, fetched: result.value.jobs.length, public: publish });
      } else {
        results.push({
          country: country.code,
          ok: false,
          fetched: 0,
          public: activeCodes.has(country.code),
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  const written = await upsertRows(rows, env);
  return {
    ok: results.some((item) => item.ok),
    provider: "himalayas",
    scanner: "world-150-hourly",
    shard: { index: shard, count: SHARD_COUNT, countries: countries.length },
    rollout: {
      public_active_countries: activeCount,
      scanned_total_countries: GLOBAL_COUNTRIES.length,
      add_count: 10,
      add_every_hours: 4,
    },
    fetched: rows.length,
    written,
    countries: results,
    ran_at: nowIso,
  };
}
