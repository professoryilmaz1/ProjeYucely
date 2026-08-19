/**
 * KREVUNO Global Opportunity Engine — External Ingestion Module
 *
 * Adapters: Remotive, Arbeitnow, Jobicy, RemoteOK
 * Each adapter fetches from the public API, normalises the result into
 * a canonical Opportunity shape, and returns an array of records ready
 * for upsert into vovyyvov_opportunities.
 *
 * Deduplication: handled by the DB unique index on (source, external_id).
 * Expiration: opportunities older than MAX_AGE_DAYS are marked CLOSED.
 */

const MAX_AGE_DAYS = 30;
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Canonical opportunity shape produced by every adapter
// ---------------------------------------------------------------------------
export function blankOpportunity() {
  return {
    source: "local",
    external_id: null,
    source_url: null,
    title: "",
    description: null,
    company: null,
    city: null,
    country: null,
    remote: false,
    amount: null,
    salary_min: null,
    salary_max: null,
    tags: [],
    ai_labels: [],
    kind: "JOB",
    status: "OPEN",
    expires_at: null,
    ingested_at: new Date().toISOString(),
    latitude: null,
    longitude: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function expiresAt(daysFromNow = MAX_AGE_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

function safeSlice(text, max = 400) {
  if (!text) return null;
  const stripped = String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped.slice(0, max) || null;
}

function parseSalary(raw) {
  if (!raw) return { min: null, max: null };
  const nums = String(raw)
    .replace(/,/g, "")
    .match(/\d{3,7}/g)
    ?.map(Number) ?? [];
  if (nums.length === 0) return { min: null, max: null };
  if (nums.length === 1) return { min: nums[0], max: null };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t ?? "").toLowerCase().trim())
    .filter((t) => t.length > 0 && t.length <= 60)
    .slice(0, 20);
}

/** Classify the posting kind from title/tags */
export function classifyKind(title = "", tags = []) {
  const text = `${title} ${tags.join(" ")}`.toLowerCase();
  if (/\bpart[- ]?time\b|\bhourly\b|\bshift\b|\bgig\b/.test(text)) return "GIG";
  if (/\bcontract\b|\bfreelance\b/.test(text)) return "GIG";
  if (/\bfull[- ]?time\b|\bpermanent\b|\bsalaried\b/.test(text)) return "JOB";
  return "JOB";
}

/** Derive coarse AI labels from title + tags (no LLM call required) */
export function deriveLabels(title = "", tags = [], description = "") {
  const text = `${title} ${tags.join(" ")} ${description}`.toLowerCase();
  const labels = [];
  if (/engineer|developer|software|backend|frontend|fullstack|devops/.test(text)) labels.push("tech");
  if (/design|ux|ui|figma|creative/.test(text)) labels.push("design");
  if (/market|content|seo|social|copywrite/.test(text)) labels.push("marketing");
  if (/sales|account|business development/.test(text)) labels.push("sales");
  if (/support|customer|service|helpdesk/.test(text)) labels.push("support");
  if (/data|analyst|analytics|machine learning|ai|ml/.test(text)) labels.push("data");
  if (/finance|accounting|bookkeep/.test(text)) labels.push("finance");
  if (/hr|recruit|talent|people ops/.test(text)) labels.push("hr");
  if (/legal|compliance|policy/.test(text)) labels.push("legal");
  if (/product|project|program manager/.test(text)) labels.push("product");
  if (/remote|anywhere/.test(text)) labels.push("remote");
  if (/part[- ]?time|hourly|shift/.test(text)) labels.push("part-time");
  return labels.slice(0, 8);
}

// ---------------------------------------------------------------------------
// AI-assisted label augmentation (optional: calls yy-government-core router)
// ---------------------------------------------------------------------------
export async function augmentWithAI(opportunity, env) {
  const endpoint = env?.YY_MODEL_ENDPOINT;
  const apiKey = env?.YY_MODEL_API_KEY;
  if (!endpoint || !apiKey) return opportunity;

  try {
    const prompt = `Classify this job posting into relevant skill labels (comma-separated, max 6):
Title: ${opportunity.title}
Tags: ${(opportunity.tags ?? []).join(", ")}
Description: ${(opportunity.description ?? "").slice(0, 300)}
Reply with ONLY a comma-separated list of labels, nothing else.`;

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `******`,
      },
      body: JSON.stringify({ model: "classify", prompt, max_tokens: 80 }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) return opportunity;

    const data = await resp.json();
    const raw = String(data?.text ?? data?.content ?? data?.output ?? "");
    const extra = raw
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length > 0 && l.length <= 40)
      .slice(0, 6);

    if (extra.length > 0) {
      opportunity.ai_labels = [
        ...new Set([...(opportunity.ai_labels ?? []), ...extra]),
      ].slice(0, 10);
    }
  } catch {
    // AI augmentation is best-effort; never block ingestion
  }

  return opportunity;
}

// ---------------------------------------------------------------------------
// Supabase upsert helper
// ---------------------------------------------------------------------------
export async function upsertOpportunities(rows, env) {
  if (!rows.length) return { inserted: 0, updated: 0, errors: 0 };

  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured");
  }

  let inserted = 0;
  let errors = 0;

  // Upsert in batches of 50 to stay within CF Worker CPU limits
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const resp = await fetch(
        `${url}/rest/v1/vovyyvov_opportunities?on_conflict=source,external_id`,
        {
          method: "POST",
          headers: {
            apikey: key,
            authorization: `******`,
            "content-type": "application/json",
            prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!resp.ok) {
        const err = await resp.text().catch(() => `HTTP_${resp.status}`);
        console.error("krevuno-ingest upsert error", err);
        errors++;
      } else {
        inserted += batch.length;
      }
    } catch (e) {
      console.error("krevuno-ingest upsert exception", e?.message);
      errors++;
    }
  }

  return { inserted, updated: 0, errors };
}

// ---------------------------------------------------------------------------
// Expiry sweep: mark expired external opportunities as CLOSED
// ---------------------------------------------------------------------------
export async function expireOldOpportunities(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const now = new Date().toISOString();

  try {
    await fetch(
      `${url}/rest/v1/vovyyvov_opportunities?expires_at=lt.${encodeURIComponent(now)}&status=eq.OPEN&source=neq.local`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          authorization: `******`,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({ status: "CLOSED" }),
        signal: AbortSignal.timeout(15_000),
      }
    );
  } catch (e) {
    console.error("krevuno-ingest expire error", e?.message);
  }
}

// ---------------------------------------------------------------------------
// Fetch helper with timeout + User-Agent
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "user-agent": "KREVUNO-Ingestion-Bot/1.0 (+https://krevuno.com)",
      accept: "application/json",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// ---------------------------------------------------------------------------
// Adapter: Remotive  (https://remotive.com/api/remote-jobs)
// ---------------------------------------------------------------------------
export async function fetchRemotive(env) {
  const resp = await fetchWithTimeout(
    "https://remotive.com/api/remote-jobs?limit=100"
  );
  if (!resp.ok) throw new Error(`Remotive HTTP ${resp.status}`);

  const { jobs = [] } = await resp.json();
  const exp = expiresAt();

  return jobs.map((j) => {
    const tags = cleanTags(j.tags ?? []);
    const desc = safeSlice(j.description);
    const { min, max } = parseSalary(j.salary);
    const opp = {
      ...blankOpportunity(),
      source: "remotive",
      external_id: String(j.id ?? ""),
      source_url: j.url ?? null,
      title: String(j.title ?? "").slice(0, 200),
      description: desc,
      company: safeSlice(j.company_name, 120),
      city: null,
      country: null,
      remote: true,
      amount: min ?? null,
      salary_min: min,
      salary_max: max,
      tags,
      kind: classifyKind(j.title, tags),
      ai_labels: deriveLabels(j.title, tags, desc ?? ""),
      expires_at: exp,
    };
    return opp;
  });
}

// ---------------------------------------------------------------------------
// Adapter: Arbeitnow  (https://www.arbeitnow.com/api/job-board-api)
// ---------------------------------------------------------------------------
export async function fetchArbeitnow(env) {
  const resp = await fetchWithTimeout(
    "https://www.arbeitnow.com/api/job-board-api"
  );
  if (!resp.ok) throw new Error(`Arbeitnow HTTP ${resp.status}`);

  const { data = [] } = await resp.json();
  const exp = expiresAt();

  return data.map((j) => {
    const tags = cleanTags(j.tags ?? []);
    const desc = safeSlice(j.description);
    const opp = {
      ...blankOpportunity(),
      source: "arbeitnow",
      external_id: String(j.slug ?? j.url ?? ""),
      source_url: j.url ?? null,
      title: String(j.title ?? "").slice(0, 200),
      description: desc,
      company: safeSlice(j.company_name, 120),
      city: j.location ? String(j.location).slice(0, 120) : null,
      country: null,
      remote: Boolean(j.remote),
      tags,
      kind: classifyKind(j.title, tags),
      ai_labels: deriveLabels(j.title, tags, desc ?? ""),
      expires_at: exp,
    };
    return opp;
  });
}

// ---------------------------------------------------------------------------
// Adapter: Jobicy  (https://jobicy.com/api/v2/remote-jobs)
// ---------------------------------------------------------------------------
export async function fetchJobicy(env) {
  const resp = await fetchWithTimeout(
    "https://jobicy.com/api/v2/remote-jobs?count=50"
  );
  if (!resp.ok) throw new Error(`Jobicy HTTP ${resp.status}`);

  const { jobs = [] } = await resp.json();
  const exp = expiresAt();

  return jobs.map((j) => {
    const cats = Array.isArray(j.jobCategories)
      ? j.jobCategories
      : [j.jobCategory ?? ""].filter(Boolean);
    const tags = cleanTags([...cats, ...(j.jobType ? [j.jobType] : [])]);
    const desc = safeSlice(j.jobDescription);
    const opp = {
      ...blankOpportunity(),
      source: "jobicy",
      external_id: String(j.id ?? j.url ?? ""),
      source_url: j.url ?? null,
      title: String(j.jobTitle ?? "").slice(0, 200),
      description: desc,
      company: safeSlice(j.companyName, 120),
      city: j.jobGeo ? String(j.jobGeo).slice(0, 120) : null,
      country: null,
      remote: true,
      tags,
      kind: classifyKind(j.jobTitle, tags),
      ai_labels: deriveLabels(j.jobTitle, tags, desc ?? ""),
      expires_at: exp,
    };
    return opp;
  });
}

// ---------------------------------------------------------------------------
// Adapter: RemoteOK  (https://remoteok.com/api)
// ---------------------------------------------------------------------------
export async function fetchRemoteOK(env) {
  const resp = await fetchWithTimeout("https://remoteok.com/api");
  if (!resp.ok) throw new Error(`RemoteOK HTTP ${resp.status}`);

  const raw = await resp.json();
  // First element is a metadata/legal notice object, not a job
  const jobs = Array.isArray(raw) ? raw.filter((j) => j.id) : [];
  const exp = expiresAt();

  return jobs.map((j) => {
    const tags = cleanTags(j.tags ?? []);
    const desc = safeSlice(j.description);
    const { min, max } = parseSalary(
      j.salary ?? (j.salary_min != null ? `${j.salary_min}-${j.salary_max}` : null)
    );
    const opp = {
      ...blankOpportunity(),
      source: "remoteok",
      external_id: String(j.id ?? ""),
      source_url: j.url ?? null,
      title: String(j.position ?? "").slice(0, 200),
      description: desc,
      company: safeSlice(j.company, 120),
      city: j.location ? String(j.location).slice(0, 120) : null,
      country: null,
      remote: true,
      amount: min ?? null,
      salary_min: min,
      salary_max: max,
      tags,
      kind: classifyKind(j.position, tags),
      ai_labels: deriveLabels(j.position, tags, desc ?? ""),
      expires_at: exp,
    };
    return opp;
  });
}

// ---------------------------------------------------------------------------
// ADAPTERS registry — extensible: add more adapters here
// ---------------------------------------------------------------------------
export const ADAPTERS = {
  remotive: fetchRemotive,
  arbeitnow: fetchArbeitnow,
  jobicy: fetchJobicy,
  remoteok: fetchRemoteOK,
};

// ---------------------------------------------------------------------------
// Main ingestion orchestrator
// ---------------------------------------------------------------------------
export async function runIngestion(env, options = {}) {
  const {
    sources = Object.keys(ADAPTERS),
    useAI = Boolean(env?.YY_MODEL_ENDPOINT),
  } = options;

  const start = Date.now();
  const results = {};
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalErrors = 0;

  for (const source of sources) {
    const adapter = ADAPTERS[source];
    if (!adapter) continue;

    try {
      let rows = await adapter(env);

      // Optional AI label augmentation (best-effort, one call per batch)
      if (useAI && rows.length > 0) {
        // Augment a sample to avoid rate limits
        const AUGMENT_LIMIT = 20;
        for (let i = 0; i < Math.min(rows.length, AUGMENT_LIMIT); i++) {
          rows[i] = await augmentWithAI(rows[i], env);
        }
      }

      // Filter out rows with no meaningful title or external_id
      rows = rows.filter(
        (r) => r.external_id && r.title && r.title.length >= 2
      );

      const upsertResult = await upsertOpportunities(rows, env);
      results[source] = {
        fetched: rows.length,
        ...upsertResult,
      };
      totalFetched += rows.length;
      totalUpserted += upsertResult.inserted;
      totalErrors += upsertResult.errors;
    } catch (e) {
      console.error(`krevuno-ingest adapter error [${source}]`, e?.message);
      results[source] = { error: e?.message ?? "unknown" };
      totalErrors++;
    }
  }

  // Sweep expired opportunities
  try {
    await expireOldOpportunities(env);
  } catch (e) {
    console.error("krevuno-ingest expire sweep error", e?.message);
  }

  const elapsed = Date.now() - start;

  return {
    ok: totalErrors === 0,
    elapsed_ms: elapsed,
    total_fetched: totalFetched,
    total_upserted: totalUpserted,
    total_errors: totalErrors,
    sources: results,
  };
}

// ---------------------------------------------------------------------------
// Skill-based AI matching (client-side scoring, no LLM required)
// ---------------------------------------------------------------------------

/**
 * Score a single opportunity against user skills/location/radius.
 * Returns a 0-100 score and a list of match reasons.
 */
export function scoreOpportunity(opportunity, userProfile) {
  const { skills = [], lat, lng, radiusMiles = 25 } = userProfile;

  let score = 0;
  const reasons = [];

  // Skill matching (up to 60 points)
  const opLabels = [
    ...(opportunity.ai_labels ?? []),
    ...(opportunity.tags ?? []),
    opportunity.title?.toLowerCase() ?? "",
  ].join(" ");

  let skillHits = 0;
  for (const skill of skills.map((s) => s.toLowerCase())) {
    if (opLabels.includes(skill)) {
      skillHits++;
    }
  }
  if (skills.length > 0) {
    const skillScore = Math.min(60, Math.round((skillHits / skills.length) * 60));
    score += skillScore;
    if (skillHits > 0) reasons.push(`${skillHits}/${skills.length} skill match`);
  } else {
    score += 30; // neutral if no skills provided
  }

  // Remote bonus (10 points)
  if (opportunity.remote) {
    score += 10;
    reasons.push("remote");
  }

  // Distance scoring (up to 30 points)
  const opLat = Number(opportunity.latitude);
  const opLng = Number(opportunity.longitude);
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Number.isFinite(opLat) &&
    Number.isFinite(opLng)
  ) {
    const dist = haversineMiles(lat, lng, opLat, opLng);
    if (dist <= radiusMiles) {
      const distScore = Math.round(30 * (1 - dist / radiusMiles));
      score += distScore;
      reasons.push(`${dist.toFixed(1)} mi away`);
    } else {
      // Outside radius — only show if remote
      if (!opportunity.remote) {
        return { score: 0, blocked: true, reasons: ["outside radius"] };
      }
    }
  } else if (!opportunity.remote) {
    // No geo data and not remote — neutral
    score += 15;
  }

  return { score: Math.min(100, score), blocked: false, reasons };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.76;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Rank a list of opportunities against a user profile.
 * Returns the opportunities sorted by descending match score,
 * filtered to only include non-blocked results.
 */
export function rankOpportunities(opportunities, userProfile) {
  return opportunities
    .map((opp) => ({ ...opp, _match: scoreOpportunity(opp, userProfile) }))
    .filter((opp) => !opp._match.blocked)
    .sort((a, b) => b._match.score - a._match.score);
}
