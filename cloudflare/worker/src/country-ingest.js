const FETCH_TIMEOUT_MS = 12_000;
const MAX_JOBS_PER_COUNTRY = 20;
const DEFAULT_TTL_DAYS = 30;

export const TOP_PRIORITY_COUNTRIES = Object.freeze([
  { code: "US", name: "United States" },
  { code: "DE", name: "Germany" },
  { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India" },
  { code: "NL", name: "Netherlands" },
  { code: "FR", name: "France" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "PL", name: "Poland" },
  { code: "CH", name: "Switzerland" },
]);

function stripHtml(value, max = 4000) {
  const text = String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, 30);
}

function toIso(value) {
  if (value == null || value === "") return null;
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function expiresFallback(nowIso) {
  const date = new Date(nowIso);
  date.setUTCDate(date.getUTCDate() + DEFAULT_TTL_DAYS);
  return date.toISOString();
}

function hashString(input = "") {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `kr_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildHimalayasCountryUrl(countryCode, page = 1) {
  const url = new URL("https://himalayas.app/jobs/api/search");
  url.searchParams.set("country", countryCode);
  url.searchParams.set("exclude_worldwide", "true");
  url.searchParams.set("sort", "recent");
  url.searchParams.set("page", String(Math.max(1, Number(page) || 1)));
  return url.toString();
}

function salaryText(job) {
  const min = Number(job?.minSalary);
  const max = Number(job?.maxSalary);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  const currency = String(job?.currency || "USD").toUpperCase();
  const period = String(job?.salaryPeriod || "annual");
  const fmt = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  if (Number.isFinite(min) && Number.isFinite(max)) return `${currency} ${fmt(min)}–${fmt(max)} / ${period}`;
  return `${currency} ${fmt(Number.isFinite(min) ? min : max)} / ${period}`;
}

export function normalizeHimalayasJob(job, country, nowIso = new Date().toISOString()) {
  const guid = String(job?.guid || job?.applicationLink || `${job?.companyName || "company"}:${job?.title || "job"}`);
  const restrictions = Array.isArray(job?.locationRestrictions) ? job.locationRestrictions : [];
  const locationNames = restrictions
    .map((item) => (typeof item === "string" ? item : item?.name || item?.alpha2))
    .filter(Boolean);
  const tags = uniqueStrings([
    ...(Array.isArray(job?.categories) ? job.categories : []),
    ...(Array.isArray(job?.parentCategories) ? job.parentCategories : []),
    ...(Array.isArray(job?.seniority) ? job.seniority : job?.seniority ? [job.seniority] : []),
  ]);
  const createdAt = toIso(job?.pubDate) || nowIso;
  const sourceId = `${country.code}:${guid}`;
  const description = stripHtml(job?.description || job?.excerpt, 4000);
  const minSalary = Number(job?.minSalary);

  return {
    title: String(job?.title || "Job opportunity").slice(0, 200),
    description,
    amount: Number.isFinite(minSalary) ? minSalary : null,
    city: null,
    country: country.name,
    remote: true,
    status: "OPEN",
    kind: "JOB",
    company_name: stripHtml(job?.companyName, 160),
    source_provider: "himalayas",
    source_id: sourceId.slice(0, 500),
    source_url: String(job?.applicationLink || "https://himalayas.app/jobs").slice(0, 2000),
    location_text: locationNames.length ? locationNames.join(", ").slice(0, 500) : country.name,
    currency: String(job?.currency || "USD").slice(0, 12),
    employment_type: String(job?.employmentType || "").slice(0, 80) || null,
    salary_text: salaryText(job),
    skills: uniqueStrings(Array.isArray(job?.categories) ? job.categories : []),
    tags,
    classification: {
      source: "himalayas",
      priority_country: country.code,
      seniority: Array.isArray(job?.seniority) ? job.seniority : job?.seniority || null,
      timezone_restrictions: Array.isArray(job?.timezoneRestrictions) ? job.timezoneRestrictions.slice(0, 20) : [],
    },
    metadata: {
      source_homepage: "https://himalayas.app/",
      attribution: "Sourced from Himalayas; keep visible source name and original link.",
      priority_country_code: country.code,
      company_slug: job?.companySlug || null,
      raw_guid: guid,
    },
    external: true,
    public_visibility: true,
    map_visibility: false,
    dedupe_hash: hashString(`himalayas|${country.code}|${guid}`),
    ingested_at: nowIso,
    last_seen_at: nowIso,
    source_updated_at: createdAt,
    expires_at: toIso(job?.expiryDate) || expiresFallback(nowIso),
    created_at: createdAt,
    updated_at: nowIso,
    search_radius_miles: null,
  };
}

async function fetchCountry(country) {
  const response = await fetch(buildHimalayasCountryUrl(country.code), {
    headers: {
      accept: "application/json",
      "user-agent": "KREVUNO-Open-Jobs/1.0 (+https://krevuno.com)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HIMALAYAS_${country.code}_HTTP_${response.status}`);
  const data = await response.json();
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  return jobs.slice(0, MAX_JOBS_PER_COUNTRY);
}

async function upsertRows(rows, env) {
  if (!rows.length) return 0;
  const url = String(env?.SUPABASE_URL || "").replace(/\/$/, "");
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_REQUIRED");

  let written = 0;
  const batchSize = 40;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const response = await fetch(`${url}/rest/v1/vovyyvov_opportunities?on_conflict=source_provider,source_id`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`SUPABASE_HIMALAYAS_UPSERT_${response.status}:${detail.slice(0, 500)}`);
    }
    written += batch.length;
  }
  return written;
}

export async function runPriorityCountryIngestion(env, options = {}) {
  const countries = Array.isArray(options.countries) && options.countries.length
    ? TOP_PRIORITY_COUNTRIES.filter((country) => options.countries.includes(country.code))
    : TOP_PRIORITY_COUNTRIES;
  const nowIso = new Date().toISOString();
  const rows = [];
  const results = [];

  for (const country of countries) {
    try {
      const jobs = await fetchCountry(country);
      const normalized = jobs.map((job) => normalizeHimalayasJob(job, country, nowIso));
      rows.push(...normalized);
      results.push({ country: country.code, ok: true, fetched: jobs.length });
    } catch (error) {
      results.push({
        country: country.code,
        ok: false,
        fetched: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const written = await upsertRows(rows, env);
  return {
    ok: results.some((item) => item.ok),
    provider: "himalayas",
    countries: results,
    fetched: rows.length,
    written,
    ran_at: nowIso,
  };
}
