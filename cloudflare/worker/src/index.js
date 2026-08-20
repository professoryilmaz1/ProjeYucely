import * as Sentry from "@sentry/cloudflare";
import { runIngestion, rankOpportunities } from "./ingest.js";

const SENTRY_DSN =
  "https://da4e27baed26868fdb8051b050789a8a@o4511888786915328.ingest.us.sentry.io/4511888807100416";
const PUBLIC_SUPABASE_URL = "https://hfqjiehsdqwqeivcqfzg.supabase.co";
const PUBLIC_SUPABASE_KEY = "sb_publishable_GQLUsMvxJ4-TgdxtAD3WXw_aKpp5Qm2";
const DEFAULT_DISCOVERY_LIMIT = 100;
const DEFAULT_MAP_LIMIT = 250;
const DEFAULT_SYNC_LIMIT = 40;
const DEFAULT_RADIUS_MILES = 25;
const DEFAULT_OPPORTUNITY_TTL_HOURS = 168;
const OPPORTUNITY_SELECT =
  "id,owner_id,title,description,amount,city,country,remote,status,kind,company_name,source_provider,source_id,source_url,location_text,latitude,longitude,employment_type,salary_text,currency,skills,tags,classification,external,public_visibility,map_visibility,created_at,updated_at,expires_at,last_seen_at,search_radius_miles";
const MAP_SELECT =
  "id,title,city,country,latitude,longitude,remote,kind,company_name,source_provider,map_visibility,external";
const SKILL_DICTIONARY = {
  driver: ["driver", "driving", "delivery", "courier", "ride"],
  customer_service: ["customer service", "call center", "support", "help desk"],
  admin: ["admin", "administrative", "assistant", "data entry", "virtual assistant"],
  sales: ["sales", "account executive", "lead generation", "business development"],
  marketing: ["marketing", "seo", "content", "social media", "growth"],
  software: ["software", "developer", "engineer", "javascript", "typescript", "react", "node", "python"],
  design: ["design", "designer", "figma", "ux", "ui", "graphic"],
  writing: ["writer", "writing", "editor", "copywriter", "content"],
  finance: ["finance", "accounting", "bookkeeping", "analyst", "tax"],
  operations: ["operations", "scheduler", "dispatch", "coordinator", "logistics"],
  education: ["teacher", "tutor", "education", "curriculum", "instructor"],
  healthcare: ["healthcare", "medical", "nurse", "caregiver", "clinic"],
  cleaning: ["cleaning", "housekeeping", "janitor", "custodian"],
  hospitality: ["server", "waiter", "barista", "kitchen", "restaurant", "hotel"],
  warehouse: ["warehouse", "picker", "packer", "forklift", "inventory"],
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });

function securityHeaders(resp) {
  const h = new Headers(resp.headers);
  h.set("x-frame-options", "DENY");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=(self)");
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: h,
  });
}

function observe(event, data = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: "krevuno-opportunity-engine",
      event,
      ...data,
    })
  );
}

function safeJsonParse(text, fallback = {}) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hashString(input = "") {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `kr_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const token = normalizeToken(value);
  return token === "true" || token === "yes" || token === "1";
}

function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/(-?\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : null;
}

function readOptionalNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function maybeDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return toIso(value);
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const coords = [lat1, lng1, lat2, lng2].map(Number);
  if (coords.some((value) => !Number.isFinite(value))) return null;
  const [aLat, aLng, bLat, bLng] = coords.map((value, index) =>
    index % 2 === 0 ? (value * Math.PI) / 180 : (value * Math.PI) / 180
  );
  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(q));
}

function isRemoteLocation(value) {
  const token = normalizeToken(value);
  return (
    token.includes("remote") ||
    token.includes("worldwide") ||
    token.includes("anywhere") ||
    token.includes("distributed") ||
    token.includes("work from home")
  );
}

function extractLocationParts(value) {
  const text = String(value || "").trim();
  if (!text) return { city: null, country: null, location_text: null };
  const cleaned = text.replace(/\s+/g, " ").trim();
  const segments = cleaned
    .split(/[,|/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return { city: cleaned, country: null, location_text: cleaned };
  if (segments.length === 1) return { city: segments[0], country: null, location_text: cleaned };
  return {
    city: segments[0] || null,
    country: segments.at(-1) || null,
    location_text: cleaned,
  };
}

function extractSkillsFromText(...parts) {
  const haystack = normalizeToken(parts.filter(Boolean).join(" "));
  const skills = [];
  for (const [skill, keywords] of Object.entries(SKILL_DICTIONARY)) {
    if (keywords.some((keyword) => haystack.includes(normalizeToken(keyword)))) {
      skills.push(skill);
    }
  }
  return uniqueStrings(skills);
}

export function classifyOpportunityHeuristic(opportunity = {}) {
  const title = String(opportunity.title || "");
  const description = String(opportunity.description || "");
  const tags = uniqueStrings([
    ...asArray(opportunity.tags),
    ...asArray(opportunity.job_types),
    ...asArray(opportunity.category),
    ...asArray(opportunity.candidate_required_location),
  ]);
  const haystack = normalizeToken([title, description, tags.join(" ")].join(" "));
  const remote =
    parseBoolean(opportunity.remote) ||
    isRemoteLocation(opportunity.location_text) ||
    isRemoteLocation(tags.join(" ")) ||
    /\bremote\b|\bworldwide\b|\banywhere\b/.test(haystack);
  let kind = "JOB";
  if (/gig|task|freelance|contract|project/.test(haystack)) kind = "GIG";
  if (/shift|hourly|same day|weekend/.test(haystack)) kind = "SHIFT";
  if (/helper|clean|care|assistant|errand/.test(haystack)) kind = "HELP";
  const skills = uniqueStrings([
    ...extractSkillsFromText(title, description, tags.join(" ")),
    ...asArray(opportunity.skills),
  ]);
  return {
    remote,
    kind,
    skills,
    tags,
    confidence: skills.length || remote ? 0.72 : 0.48,
    summary: title || description.slice(0, 140) || null,
  };
}

function modelRoutingConfig(env) {
  const baseUrl =
    env.YY_GOVERNMENT_CORE_URL ||
    env.MODEL_ROUTING_URL ||
    env.YY_GOVERNMENT_CORE_MODEL_ROUTING_URL ||
    "";
  if (!baseUrl) return null;
  return {
    url: baseUrl.replace(/\/$/, ""),
    path:
      env.YY_GOVERNMENT_CORE_MODEL_ROUTE_PATH ||
      env.MODEL_ROUTING_PATH ||
      "/model-routing",
    apiKey:
      env.YY_GOVERNMENT_CORE_API_KEY ||
      env.MODEL_ROUTING_API_KEY ||
      "",
  };
}

async function callModelRouter(env, payload) {
  const config = modelRoutingConfig(env);
  if (!config) return null;
  const response = await fetch(`${config.url}${config.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: ["Bearer", config.apiKey].join(" ") } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = safeJsonParse(text, { raw: text });
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `MODEL_ROUTING_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data?.result || data?.classification || data?.match || data;
}

async function classifyOpportunity(opportunity, env) {
  const fallback = classifyOpportunityHeuristic(opportunity);
  if (!modelRoutingConfig(env)) return fallback;
  try {
    const routed = await callModelRouter(env, {
      task: "krevuno-opportunity-classification",
      input: {
        title: opportunity.title,
        description: opportunity.description,
        company_name: opportunity.company_name,
        location_text: opportunity.location_text,
        tags: opportunity.tags,
        source_provider: opportunity.source_provider,
      },
      fallback,
    });
    return {
      ...fallback,
      ...(typeof routed === "object" && routed ? routed : {}),
      remote:
        typeof routed?.remote === "boolean" ? routed.remote : fallback.remote,
      kind: String(routed?.kind || fallback.kind || "JOB").toUpperCase(),
      skills: uniqueStrings([...(fallback.skills || []), ...asArray(routed?.skills)]),
      tags: uniqueStrings([...(fallback.tags || []), ...asArray(routed?.tags)]),
    };
  } catch (error) {
    observe("opportunity.model_routing_failed", {
      message: error.message,
      provider: opportunity.source_provider || "unknown",
    });
    return fallback;
  }
}

function sanitizeOpportunity(opportunity = {}) {
  return {
    id: opportunity.id || null,
    title: opportunity.title || null,
    description: opportunity.description || null,
    amount: opportunity.amount == null ? null : Number(opportunity.amount),
    city: opportunity.city || null,
    country: opportunity.country || null,
    remote: Boolean(opportunity.remote),
    status: opportunity.status || "OPEN",
    kind: opportunity.kind || "JOB",
    company_name: opportunity.company_name || null,
    source_provider: opportunity.source_provider || null,
    source_url: opportunity.source_url || null,
    location_text: opportunity.location_text || null,
    latitude:
      opportunity.map_visibility || opportunity.external
        ? Number.isFinite(Number(opportunity.latitude))
          ? Number(opportunity.latitude)
          : null
        : null,
    longitude:
      opportunity.map_visibility || opportunity.external
        ? Number.isFinite(Number(opportunity.longitude))
          ? Number(opportunity.longitude)
          : null
        : null,
    employment_type: opportunity.employment_type || null,
    salary_text: opportunity.salary_text || null,
    currency: opportunity.currency || null,
    skills: uniqueStrings(asArray(opportunity.skills)),
    tags: uniqueStrings(asArray(opportunity.tags)),
    classification: typeof opportunity.classification === "object" && opportunity.classification ? opportunity.classification : {},
    external: Boolean(opportunity.external),
    created_at: opportunity.created_at || null,
    updated_at: opportunity.updated_at || null,
    expires_at: opportunity.expires_at || null,
    last_seen_at: opportunity.last_seen_at || null,
    search_radius_miles:
      opportunity.search_radius_miles == null
        ? null
        : Number(opportunity.search_radius_miles),
  };
}

function mapOpportunityWithDistance(opportunity, geo) {
  const mapped = sanitizeOpportunity(opportunity);
  const distanceKm =
    geo && !mapped.remote
      ? haversineKm(geo.lat, geo.lng, mapped.latitude, mapped.longitude)
      : null;
  return {
    ...mapped,
    distance_km: distanceKm == null ? null : round(distanceKm, 1),
    distance_miles:
      distanceKm == null ? null : round(distanceKm * 0.621371, distanceKm < 16 ? 1 : 0),
  };
}

function opportunityStillOpen(opportunity, nowIso = new Date().toISOString()) {
  if (String(opportunity.status || "OPEN").toUpperCase() !== "OPEN") return false;
  if (!opportunity.expires_at) return true;
  return Date.parse(opportunity.expires_at) > Date.parse(nowIso);
}

function scoreSkillOverlap(required = [], offered = []) {
  const need = new Set(required.map((item) => normalizeToken(item)).filter(Boolean));
  if (!need.size) return 0.65;
  const have = new Set(offered.map((item) => normalizeToken(item)).filter(Boolean));
  let hits = 0;
  for (const skill of need) if (have.has(skill)) hits += 1;
  return hits / need.size;
}

export function scoreOpportunityMatch(opportunity, input = {}) {
  const skills = uniqueStrings([
    ...asArray(input.profileSkills),
    ...asArray(input.availabilitySkills),
  ]);
  const requiredSkills = uniqueStrings([
    ...asArray(opportunity.skills),
    ...asArray(opportunity.tags),
  ]);
  const skillScore = scoreSkillOverlap(requiredSkills, skills);
  const radiusMiles = clamp(Number(input.radiusMiles || DEFAULT_RADIUS_MILES), 5, 500);
  const distanceMiles =
    input.lat != null && input.lng != null && !opportunity.remote
      ? (haversineKm(input.lat, input.lng, opportunity.latitude, opportunity.longitude) || null) *
        0.621371
      : null;
  let locationScore = opportunity.remote ? 1 : 0.35;
  if (!opportunity.remote && distanceMiles != null) {
    locationScore = distanceMiles > radiusMiles ? 0 : Math.max(0, 1 - distanceMiles / Math.max(radiusMiles, 1));
  }
  const minimumAmount =
    asArray(input.minimumAmounts)
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b)[0] ?? null;
  const amount = opportunity.amount == null ? null : Number(opportunity.amount);
  let compensationScore = 0.7;
  if (minimumAmount != null && amount != null) {
    compensationScore = amount >= minimumAmount ? 1 : Math.max(0.2, amount / minimumAmount);
  }
  const freshnessDays = opportunity.created_at
    ? Math.max(0, (Date.now() - Date.parse(opportunity.created_at)) / 86_400_000)
    : 30;
  const freshnessScore = Math.max(0.25, 1 - freshnessDays / 30);
  const score =
    skillScore * 0.42 +
    locationScore * 0.28 +
    compensationScore * 0.15 +
    freshnessScore * 0.15;
  const reasons = [];
  if (skillScore >= 0.7) reasons.push("SKILLS_ALIGNED");
  else if (skillScore < 0.35) reasons.push("LOW_SKILL_ALIGNMENT");
  if (opportunity.remote) reasons.push("REMOTE_READY");
  else if (distanceMiles != null && distanceMiles <= radiusMiles) reasons.push("WITHIN_RADIUS");
  else if (distanceMiles != null) reasons.push("OUTSIDE_RADIUS");
  if (compensationScore >= 0.9 && minimumAmount != null) reasons.push("MEETS_MINIMUM_AMOUNT");
  return {
    score: round(score * 100, 2),
    reasons,
    components: {
      skills: round(skillScore, 4),
      location: round(locationScore, 4),
      compensation: round(compensationScore, 4),
      freshness: round(freshnessScore, 4),
    },
    distance_miles: distanceMiles == null ? null : round(distanceMiles, distanceMiles < 10 ? 1 : 0),
  };
}

async function maybeEnhanceMatchWithAI(env, matchInput, current) {
  if (!modelRoutingConfig(env)) return current;
  try {
    const routed = await callModelRouter(env, {
      task: "krevuno-opportunity-match",
      input: matchInput,
      current,
    });
    const boost = clamp(Number(routed?.score_boost || 0), -15, 15);
    return {
      ...current,
      score: clamp(round(current.score + boost, 2), 0, 100),
      reasons: uniqueStrings([...current.reasons, ...asArray(routed?.reasons)]),
      ai: typeof routed === "object" && routed ? routed : null,
    };
  } catch (error) {
    observe("opportunity.match_model_routing_failed", { message: error.message });
    return current;
  }
}

function getSupabaseConfig(env) {
  return {
    url: env.SUPABASE_URL || PUBLIC_SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY || PUBLIC_SUPABASE_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

async function supabaseRequest(env, path, options = {}) {
  const { url, anonKey, serviceRoleKey } = getSupabaseConfig(env);
  const {
    method = "GET",
    body,
    headers = {},
    token = null,
    useServiceRole = false,
    expectJson = true,
  } = options;
  const key = useServiceRole ? serviceRoleKey : anonKey;
  if (!url || !key) {
    throw new Error(useServiceRole ? "SUPABASE_SERVICE_ROLE_REQUIRED" : "SUPABASE_PUBLIC_CONFIG_REQUIRED");
  }
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: ["Bearer", token || key].join(" "),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!expectJson) return response;
  const text = await response.text();
  const data = safeJsonParse(text, text ? { message: text } : {});
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || data?.hint || `SUPABASE_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function fetchSupabaseUser(env, token) {
  if (!token) throw new Error("AUTH_REQUIRED");
  const { url, anonKey } = getSupabaseConfig(env);
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: ["Bearer", token].join(" "),
    },
  });
  const text = await response.text();
  const data = safeJsonParse(text, {});
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || "AUTH_REQUIRED");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function listPublicOpportunities(env, { limit = DEFAULT_DISCOVERY_LIMIT } = {}) {
  const rows = await supabaseRequest(
    env,
    `/rest/v1/vovyyvov_opportunities?select=${encodeURIComponent(OPPORTUNITY_SELECT)}&status=eq.OPEN&public_visibility=eq.true&order=created_at.desc&limit=${clamp(Number(limit || DEFAULT_DISCOVERY_LIMIT), 1, 250)}`,
    { useServiceRole: Boolean(getSupabaseConfig(env).serviceRoleKey) }
  );
  return Array.isArray(rows) ? rows : [];
}

async function listMapOpportunities(env, { limit = DEFAULT_MAP_LIMIT } = {}) {
  const rows = await supabaseRequest(
    env,
    `/rest/v1/vovyyvov_opportunities?select=${encodeURIComponent(MAP_SELECT)}&status=eq.OPEN&public_visibility=eq.true&order=created_at.desc&limit=${clamp(Number(limit || DEFAULT_MAP_LIMIT), 1, 500)}`,
    { useServiceRole: Boolean(getSupabaseConfig(env).serviceRoleKey) }
  );
  return Array.isArray(rows) ? rows : [];
}

async function upsertOpportunities(env, rows) {
  if (!rows.length) return [];
  return supabaseRequest(
    env,
    "/rest/v1/vovyyvov_opportunities?on_conflict=source_provider,source_id",
    {
      method: "POST",
      body: rows,
      useServiceRole: true,
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
    }
  );
}

async function createSyncRun(env, payload) {
  const rows = await supabaseRequest(env, "/rest/v1/vovyyvov_opportunity_sync_runs", {
    method: "POST",
    body: payload,
    useServiceRole: true,
    headers: { prefer: "return=representation" },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function updateSyncRun(env, runId, payload) {
  await supabaseRequest(
    env,
    `/rest/v1/vovyyvov_opportunity_sync_runs?id=eq.${encodeURIComponent(runId)}`,
    {
      method: "PATCH",
      body: payload,
      useServiceRole: true,
      headers: { prefer: "return=minimal" },
    }
  );
}

async function expireStaleOpportunities(env, providers, runStartedAt) {
  let expiredCount = 0;
  for (const provider of providers) {
    const response = await supabaseRequest(
      env,
      `/rest/v1/vovyyvov_opportunities?source_provider=eq.${encodeURIComponent(provider)}&external=eq.true&status=eq.OPEN&last_seen_at=lt.${encodeURIComponent(runStartedAt)}`,
      {
        method: "PATCH",
        body: { status: "EXPIRED", updated_at: new Date().toISOString() },
        useServiceRole: true,
        headers: { prefer: "return=representation" },
      }
    );
    expiredCount += Array.isArray(response) ? response.length : 0;
  }
  const byExpiry = await supabaseRequest(
    env,
    `/rest/v1/vovyyvov_opportunities?external=eq.true&status=eq.OPEN&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,
    {
      method: "PATCH",
      body: { status: "EXPIRED", updated_at: new Date().toISOString() },
      useServiceRole: true,
      headers: { prefer: "return=representation" },
    }
  );
  return expiredCount + (Array.isArray(byExpiry) ? byExpiry.length : 0);
}

async function loadGeoCache(env, locationKey) {
  const rows = await supabaseRequest(
    env,
    `/rest/v1/vovyyvov_opportunity_geo_cache?select=location_key,query_text,city,country,latitude,longitude,updated_at&location_key=eq.${encodeURIComponent(locationKey)}&limit=1`,
    { useServiceRole: true }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function saveGeoCache(env, payload) {
  await supabaseRequest(env, "/rest/v1/vovyyvov_opportunity_geo_cache?on_conflict=location_key", {
    method: "POST",
    body: payload,
    useServiceRole: true,
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
  });
}

async function geocodeLocation(env, location, memoryCache) {
  const queryText = String(location || "").trim();
  if (!queryText || isRemoteLocation(queryText)) return null;
  const locationKey = hashString(normalizeToken(queryText));
  if (memoryCache.has(locationKey)) return memoryCache.get(locationKey);
  try {
    const cached = await loadGeoCache(env, locationKey);
    if (cached?.latitude != null && cached?.longitude != null) {
      memoryCache.set(locationKey, cached);
      return cached;
    }
  } catch (error) {
    observe("opportunity.geo_cache_read_failed", { message: error.message });
  }
  const endpoint =
    env.OPPORTUNITY_GEOCODER_URL ||
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(queryText)}`;
  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json",
      "user-agent": "KREVUNO Opportunity Engine/2.1",
    },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const first = Array.isArray(payload) ? payload[0] : payload?.results?.[0];
  if (!first) return null;
  const value = {
    location_key: locationKey,
    query_text: queryText,
    city: first.address?.city || first.address?.town || first.address?.village || null,
    country: first.address?.country || first.display_name?.split(", ").at(-1) || null,
    latitude: Number(first.lat),
    longitude: Number(first.lon),
    updated_at: new Date().toISOString(),
  };
  if (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude)) return null;
  memoryCache.set(locationKey, value);
  try {
    await saveGeoCache(env, value);
  } catch (error) {
    observe("opportunity.geo_cache_write_failed", { message: error.message });
  }
  return value;
}

const opportunityAdapters = [
  {
    name: "remotive",
    url: (env) => env.REMOTIVE_API_URL || "https://remotive.com/api/remote-jobs?limit=40",
    parse(data) {
      return Array.isArray(data?.jobs) ? data.jobs : [];
    },
  },
  {
    name: "arbeitnow",
    url: (env) => env.ARBEITNOW_API_URL || "https://www.arbeitnow.com/api/job-board-api",
    parse(data) {
      return Array.isArray(data?.data) ? data.data : [];
    },
  },
  {
    name: "jobicy",
    url: (env) => env.JOBICY_API_URL || "https://jobicy.com/api/v2/remote-jobs",
    parse(data) {
      if (Array.isArray(data?.jobs)) return data.jobs;
      if (Array.isArray(data?.data)) return data.data;
      return Array.isArray(data) ? data : [];
    },
  },
  {
    name: "remoteok",
    url: (env) => env.REMOTEOK_API_URL || "https://remoteok.com/api",
    parse(data) {
      return Array.isArray(data) ? data.filter((item) => item && item.position) : [];
    },
  },
];

function normalizeSalaryText(raw) {
  const values = [
    raw.salary,
    raw.salary_range,
    raw.compensation,
    raw.salaryText,
    raw.salary_raw,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());
  if (values[0]) return values[0];
  const min = parseAmount(raw.salary_min ?? raw.annual_salary_min ?? raw.salaryMin);
  const max = parseAmount(raw.salary_max ?? raw.annual_salary_max ?? raw.salaryMax);
  if (min != null && max != null) return `${min} - ${max}`;
  if (min != null) return String(min);
  return null;
}

async function normalizeExternalOpportunity(provider, raw, env, nowIso, geoMemo) {
  const sourceUrl =
    raw.url ||
    raw.job_url ||
    raw.apply_url ||
    raw.canonical_url ||
    raw.link ||
    null;
  const title = String(raw.title || raw.position || raw.jobTitle || "").trim();
  const description = String(
    raw.description || raw.jobDescription || raw.excerpt || raw.jobExcerpt || ""
  ).trim();
  const companyName = String(
    raw.company_name || raw.company || raw.companyName || raw.company_name_english || ""
  ).trim();
  const locationText =
    raw.candidate_required_location ||
    raw.location ||
    raw.jobGeo ||
    raw.location_text ||
    raw.country ||
    "";
  const parsedLocation = extractLocationParts(locationText);
  const base = {
    title,
    description,
    company_name: companyName || null,
    source_provider: provider,
    source_id: String(raw.id || raw.slug || sourceUrl || hashString(`${provider}:${title}:${companyName}`)),
    source_url: sourceUrl,
    location_text: parsedLocation.location_text,
    city: parsedLocation.city,
    country: parsedLocation.country,
    remote:
      parseBoolean(raw.remote) ||
      parseBoolean(raw.is_remote) ||
      isRemoteLocation(locationText),
    tags: uniqueStrings([
      ...asArray(raw.tags),
      ...asArray(raw.job_types),
      ...asArray(raw.category),
      ...asArray(raw.jobType),
      ...asArray(raw.jobIndustry),
    ]),
    amount:
      parseAmount(raw.salary_min) ||
      parseAmount(raw.salary) ||
      parseAmount(raw.compensation) ||
      parseAmount(raw.salary_range),
    currency: String(raw.salary_currency || raw.currency || "USD").trim() || null,
    employment_type:
      String(raw.job_type || raw.jobType || raw.employment_type || raw.contract_type || "")
        .trim() || null,
    salary_text: normalizeSalaryText(raw),
    created_at:
      maybeDate(raw.publication_date || raw.created_at || raw.pubDate || raw.date || raw.epoch) ||
      nowIso,
    source_updated_at:
      maybeDate(raw.updated_at || raw.publication_date || raw.pubDate || raw.date || raw.epoch) ||
      nowIso,
    external: true,
    public_visibility: true,
    map_visibility: false,
    status: "OPEN",
    ingested_at: nowIso,
    last_seen_at: nowIso,
    expires_at:
      maybeDate(raw.expiry_date || raw.expires_at) ||
      new Date(Date.parse(nowIso) + DEFAULT_OPPORTUNITY_TTL_HOURS * 3_600_000).toISOString(),
    metadata: {
      provider,
      raw_id: raw.id ?? raw.slug ?? null,
    },
  };
  const classification = await classifyOpportunity(base, env);
  const opportunity = {
    ...base,
    remote: classification.remote ?? base.remote,
    kind: String(classification.kind || "JOB").toUpperCase(),
    skills: uniqueStrings([...(classification.skills || []), ...extractSkillsFromText(title, description)]),
    tags: uniqueStrings([...(base.tags || []), ...(classification.tags || [])]),
    classification,
    dedupe_hash: hashString(
      [
        normalizeToken(title),
        normalizeToken(companyName),
        normalizeToken(parsedLocation.city),
        normalizeToken(parsedLocation.country),
        normalizeToken(base.employment_type),
      ].join("|")
    ),
    search_radius_miles: base.remote ? null : DEFAULT_RADIUS_MILES,
  };
  if (!opportunity.remote && opportunity.location_text) {
    try {
      const geocoded = await geocodeLocation(env, opportunity.location_text, geoMemo);
      if (geocoded) {
        opportunity.latitude = geocoded.latitude;
        opportunity.longitude = geocoded.longitude;
        opportunity.city = opportunity.city || geocoded.city || null;
        opportunity.country = opportunity.country || geocoded.country || null;
        opportunity.map_visibility = true;
      }
    } catch (error) {
      observe("opportunity.geocode_failed", {
        provider,
        message: error.message,
        location: opportunity.location_text,
      });
    }
  }
  return opportunity;
}

export function dedupeOpportunities(opportunities = []) {
  const bySource = new Map();
  const byHash = new Map();
  let duplicateCount = 0;
  for (const opportunity of opportunities) {
    const sourceKey = `${opportunity.source_provider}:${opportunity.source_id}`;
    if (bySource.has(sourceKey)) {
      duplicateCount += 1;
      continue;
    }
    bySource.set(sourceKey, opportunity);
    const current = byHash.get(opportunity.dedupe_hash);
    if (!current) {
      byHash.set(opportunity.dedupe_hash, opportunity);
      continue;
    }
    duplicateCount += 1;
    const currentScore =
      Number(Boolean(current.description)) +
      Number(Boolean(current.amount)) +
      Number(Boolean(current.latitude));
    const nextScore =
      Number(Boolean(opportunity.description)) +
      Number(Boolean(opportunity.amount)) +
      Number(Boolean(opportunity.latitude));
    if (nextScore > currentScore) {
      byHash.set(opportunity.dedupe_hash, opportunity);
    }
  }
  return {
    opportunities: [...byHash.values()],
    duplicateCount,
  };
}

async function fetchAdapterPayload(adapter, env) {
  const url = adapter.url(env);
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain;q=0.8, */*;q=0.5",
      ...(adapter.name === "remoteok" ? { "user-agent": "KREVUNO Opportunity Engine/2.1" } : {}),
    },
  });
  const text = await response.text();
  const data = safeJsonParse(text, {});
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `${adapter.name.toUpperCase()}_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return adapter.parse(data);
}

export async function syncExternalOpportunities(env, options = {}) {
  const startedAt = new Date().toISOString();
  const adapters = opportunityAdapters.filter(
    (adapter) =>
      !options.providers?.length || options.providers.includes(adapter.name)
  );
  if (!adapters.length) {
    return {
      ok: false,
      status: "FAILED",
      message: "NO_ADAPTERS_SELECTED",
      providers: [],
    };
  }
  const run =
    getSupabaseConfig(env).serviceRoleKey
      ? await createSyncRun(env, {
          trigger_source: options.trigger || "manual",
          providers: adapters.map((adapter) => adapter.name),
          status: "RUNNING",
          started_at: startedAt,
        })
      : null;
  const geoMemo = new Map();
  const errors = [];
  const normalized = [];
  let fetchedCount = 0;
  for (const adapter of adapters) {
    try {
      const payload = await fetchAdapterPayload(adapter, env);
      fetchedCount += payload.length;
      for (const raw of payload.slice(0, clamp(Number(env.OPPORTUNITY_SYNC_LIMIT || DEFAULT_SYNC_LIMIT), 1, 100))) {
        const item = await normalizeExternalOpportunity(adapter.name, raw, env, startedAt, geoMemo);
        if (item.title) normalized.push(item);
      }
      observe("opportunity.adapter_synced", {
        provider: adapter.name,
        fetched: payload.length,
      });
    } catch (error) {
      errors.push({ provider: adapter.name, message: error.message });
      observe("opportunity.adapter_failed", {
        provider: adapter.name,
        message: error.message,
      });
    }
  }
  const deduped = dedupeOpportunities(normalized);
  let upsertedCount = 0;
  let expiredCount = 0;
  if (getSupabaseConfig(env).serviceRoleKey) {
    const upserted = await upsertOpportunities(env, deduped.opportunities);
    upsertedCount = Array.isArray(upserted) ? upserted.length : 0;
    expiredCount = await expireStaleOpportunities(
      env,
      adapters.map((adapter) => adapter.name),
      startedAt
    );
  }
  const status =
    errors.length && deduped.opportunities.length
      ? "PARTIAL"
      : errors.length
        ? "FAILED"
        : "SUCCESS";
  const summary = {
    providers: adapters.map((adapter) => adapter.name),
    fetched_count: fetchedCount,
    normalized_count: normalized.length,
    upserted_count: upsertedCount,
    expired_count: expiredCount,
    duplicate_count: deduped.duplicateCount,
    error_count: errors.length,
  };
  if (run?.id) {
    await updateSyncRun(env, run.id, {
      status,
      fetched_count: fetchedCount,
      normalized_count: normalized.length,
      upserted_count: upsertedCount,
      expired_count: expiredCount,
      duplicate_count: deduped.duplicateCount,
      error_count: errors.length,
      summary,
      errors,
      finished_at: new Date().toISOString(),
    });
  }
  return {
    ok: status !== "FAILED",
    status,
    sync_run_id: run?.id || null,
    ...summary,
    errors,
  };
}

async function buildDiscoveryResponse(env, url) {
  const limit = clamp(Number(url.searchParams.get("limit") || DEFAULT_DISCOVERY_LIMIT), 1, 250);
  const lat = readOptionalNumber(url.searchParams.get("lat"));
  const lng = readOptionalNumber(url.searchParams.get("lng"));
  const radiusMiles = clamp(
    Number(url.searchParams.get("radius_miles") || DEFAULT_RADIUS_MILES),
    5,
    500
  );
  const skillFilter = splitCsv(url.searchParams.get("skills"));
  const geo =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, radiusMiles } : null;
  let rows = [];
  let degraded = null;
  try {
    rows = await listPublicOpportunities(env, { limit: Math.max(limit, 120) });
  } catch (error) {
    degraded = error.message;
    observe("opportunity.discovery_degraded", { message: error.message });
  }
  const opportunities = rows
    .filter((opportunity) => opportunityStillOpen(opportunity))
    .map((opportunity) => mapOpportunityWithDistance(opportunity, geo))
    .filter((opportunity) => {
      if (!geo || opportunity.remote || opportunity.distance_miles == null) return true;
      return opportunity.distance_miles <= radiusMiles;
    })
    .filter((opportunity) => {
      if (!skillFilter.length) return true;
      return scoreSkillOverlap(skillFilter, [...opportunity.skills, ...opportunity.tags]) > 0;
    })
    .sort((left, right) => {
      if (left.remote && !right.remote) return 1;
      if (!left.remote && right.remote) return -1;
      if (left.distance_miles == null && right.distance_miles != null) return 1;
      if (left.distance_miles != null && right.distance_miles == null) return -1;
      if (left.distance_miles != null && right.distance_miles != null) {
        return left.distance_miles - right.distance_miles;
      }
      return Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0);
    })
    .slice(0, limit);
  return {
    ok: true,
    degraded,
    opportunities,
    filters: {
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      radius_miles: geo?.radiusMiles ?? null,
      skills: skillFilter,
    },
  };
}

async function buildMapResponse(env, url) {
  const limit = clamp(Number(url.searchParams.get("limit") || DEFAULT_MAP_LIMIT), 1, 500);
  let rows = [];
  let degraded = null;
  try {
    rows = await listMapOpportunities(env, { limit });
  } catch (error) {
    degraded = error.message;
    observe("opportunity.map_degraded", { message: error.message });
  }
  return {
    ok: true,
    degraded,
    opportunities: rows
      .filter((opportunity) => opportunityStillOpen(opportunity))
      .filter(
        (opportunity) =>
          opportunity.external ||
          opportunity.map_visibility ||
          (opportunity.latitude != null && opportunity.longitude != null)
      )
      .map((opportunity) => ({
        id: opportunity.id,
        title: opportunity.title,
        city: opportunity.city,
        country: opportunity.country,
        latitude:
          Number.isFinite(Number(opportunity.latitude)) ? Number(opportunity.latitude) : null,
        longitude:
          Number.isFinite(Number(opportunity.longitude)) ? Number(opportunity.longitude) : null,
        remote: Boolean(opportunity.remote),
        kind: opportunity.kind || "JOB",
        company_name: opportunity.company_name || null,
        source_provider: opportunity.source_provider || null,
        external: Boolean(opportunity.external),
      }))
      .filter((opportunity) => opportunity.latitude != null && opportunity.longitude != null)
      .slice(0, limit),
  };
}

async function buildMatchesResponse(env, requestUrl, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("AUTH_REQUIRED");
  const user = await fetchSupabaseUser(env, token);
  const lat = readOptionalNumber(requestUrl.searchParams.get("lat"));
  const lng = readOptionalNumber(requestUrl.searchParams.get("lng"));
  const radiusMiles = clamp(
    Number(requestUrl.searchParams.get("radius_miles") || DEFAULT_RADIUS_MILES),
    5,
    500
  );
  const limit = clamp(Number(requestUrl.searchParams.get("limit") || 25), 1, 50);
  const [profiles, availability, opportunities] = await Promise.all([
    supabaseRequest(
      env,
      `/rest/v1/vovyyvov_profiles?select=user_id,display_name,city,country,skills&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      { useServiceRole: Boolean(getSupabaseConfig(env).serviceRoleKey) }
    ),
    supabaseRequest(
      env,
      `/rest/v1/vovyyvov_availability?select=id,skill,minimum_amount,city,latitude,longitude,search_radius_miles,active&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&order=created_at.desc&limit=100`,
      { useServiceRole: Boolean(getSupabaseConfig(env).serviceRoleKey) }
    ),
    listPublicOpportunities(env, { limit: 200 }),
  ]);
  const profile = Array.isArray(profiles) ? profiles[0] || {} : {};
  const availabilitySkills = availability.flatMap((item) => [item.skill].filter(Boolean));
  const minimumAmounts = availability
    .map((item) => Number(item.minimum_amount))
    .filter((value) => Number.isFinite(value) && value > 0);
  const geo = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const scored = [];
  for (const opportunity of opportunities.filter((item) => opportunityStillOpen(item))) {
    let match = scoreOpportunityMatch(opportunity, {
      profileSkills: profile.skills || [],
      availabilitySkills,
      minimumAmounts,
      lat: geo?.lat,
      lng: geo?.lng,
      radiusMiles,
    });
    if (match.score <= 0) continue;
    match = await maybeEnhanceMatchWithAI(
      env,
      {
        user: {
          id: user.id,
          city: profile.city || null,
          country: profile.country || null,
          skills: uniqueStrings([...(profile.skills || []), ...availabilitySkills]),
          radius_miles: radiusMiles,
        },
        opportunity: sanitizeOpportunity(opportunity),
      },
      match
    );
    if (!opportunity.remote && match.distance_miles != null && match.distance_miles > radiusMiles) continue;
    scored.push({
      ...sanitizeOpportunity(opportunity),
      match,
    });
  }
  scored.sort((left, right) => right.match.score - left.match.score);
  const top = scored.slice(0, limit);
  if (top.length && getSupabaseConfig(env).serviceRoleKey) {
    await supabaseRequest(env, "/rest/v1/vovyyvov_opportunity_matches?on_conflict=user_id,opportunity_id", {
      method: "POST",
      body: top.map((item) => ({
        user_id: user.id,
        opportunity_id: item.id,
        score: item.match.score,
        reasons: item.match.reasons,
        components: item.match.components,
        matched_at: new Date().toISOString(),
        expires_at: item.expires_at,
      })),
      useServiceRole: true,
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }
  return {
    ok: true,
    user_id: user.id,
    opportunities: top,
    profile: {
      display_name: profile.display_name || null,
      skills: uniqueStrings([...(profile.skills || []), ...availabilitySkills]),
      radius_miles: radiusMiles,
    },
  };
}

async function buildSyncStatusResponse(env) {
  if (!getSupabaseConfig(env).serviceRoleKey) {
    return {
      ok: false,
      configured: false,
      message: "SUPABASE_SERVICE_ROLE_REQUIRED",
    };
  }
  const rows = await supabaseRequest(
    env,
    "/rest/v1/vovyyvov_opportunity_sync_runs?select=id,trigger_source,status,fetched_count,normalized_count,upserted_count,expired_count,duplicate_count,error_count,summary,errors,started_at,finished_at&order=started_at.desc&limit=5",
    { useServiceRole: true }
  );
  return {
    ok: true,
    configured: true,
    runs: Array.isArray(rows) ? rows : [],
  };
}

async function handleOpportunityApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/opportunities/discover") {
    return json(await buildDiscoveryResponse(env, url));
  }
  if (request.method === "GET" && url.pathname === "/api/opportunities/map") {
    return json(await buildMapResponse(env, url));
  }
  if (request.method === "GET" && url.pathname === "/api/opportunities/matches") {
    return json(await buildMatchesResponse(env, url, request));
  }
  if (request.method === "GET" && url.pathname === "/api/opportunities/status") {
    return json(await buildSyncStatusResponse(env));
  }
  if (request.method === "POST" && url.pathname === "/api/opportunities/sync") {
    if (!isAdminRequest(request, env)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    const body = safeJsonParse(await request.text(), {});
    return json(
      await syncExternalOpportunities(env, {
        trigger: "manual",
        providers: Array.isArray(body.providers) ? body.providers : null,
      }),
      202
    );
  }
  return null;
}

function getStripeTestKey(env) {
  const key = env.STRIPE_SECRET_KEY || "";
  if (!key.startsWith("rk_test_") && !key.startsWith("sk_test_")) return null;
  return key;
}

function isAdminRequest(request, env) {
  const configured = env.CONNECT_ADMIN_TOKEN || env.OPPORTUNITY_SYNC_TOKEN || "";
  const supplied = request.headers.get("x-admin-token") || "";
  if (!configured || !supplied) return false;
  return supplied === configured;
}

async function stripeJsonRequest(url, stripeKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: ["Bearer", stripeKey].join(" "),
      ...(options.headers || {}),
    },
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  return { ok: response.ok, status: response.status, data };
}

async function stripeFormRequest(url, stripeKey, form) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: ["Bearer", stripeKey].join(" "),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {}
  return { ok: response.ok, status: response.status, data };
}

async function serveAsset(request, env) {
  if (!env.ASSETS?.fetch) return null;
  const response = await env.ASSETS.fetch(request);
  return response.status === 404 ? null : response;
}

async function handleHealth(env) {
  return json({
    ok: true,
    service: "projeyucely-cloudflare-edge",
    version: "2.1.0-krevuno",
    stripe_configured: Boolean(env.STRIPE_SECRET_KEY),
    stripe_test_key: Boolean(getStripeTestKey(env)),
    connect_admin_configured: Boolean(env.CONNECT_ADMIN_TOKEN || env.OPPORTUNITY_SYNC_TOKEN),
    opportunity_sync_configured: Boolean(getSupabaseConfig(env).serviceRoleKey),
    model_routing_configured: Boolean(modelRoutingConfig(env)),
  });
}

async function handleStripeTest(env) {
  const stripeKey = getStripeTestKey(env);
  if (!stripeKey) {
    return json({ ok: false, error: env.STRIPE_SECRET_KEY ? "STRIPE_TEST_KEY_REQUIRED" : "STRIPE_NOT_CONFIGURED" }, env.STRIPE_SECRET_KEY ? 403 : 500);
  }
  try {
    const stripe = await stripeJsonRequest("https://api.stripe.com/v1/balance", stripeKey, {
      method: "GET",
    });
    if (!stripe.ok) {
      return json(
        {
          ok: false,
          stripe_connected: false,
          stripe_status: stripe.status,
          error: stripe.data?.error?.type || "STRIPE_AUTH_FAILED",
          message: stripe.data?.error?.message || "Stripe request failed",
        },
        502
      );
    }
    return json({
      ok: true,
      stripe_connected: true,
      livemode: Boolean(stripe.data.livemode),
      object: stripe.data.object || null,
    });
  } catch {
    return json({ ok: false, stripe_connected: false, error: "STRIPE_REQUEST_FAILED" }, 502);
  }
}

async function handleCreateAccount(request, env) {
  const stripeKey = getStripeTestKey(env);
  if (!stripeKey) return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 403);
  if (!isAdminRequest(request, env)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim().toLowerCase() : "us";
  if (!email || !displayName) {
    return json({ ok: false, error: "EMAIL_AND_DISPLAY_NAME_REQUIRED" }, 400);
  }
  const accountPayload = {
    contact_email: email,
    display_name: displayName,
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    dashboard: "express",
    identity: { country },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
    include: ["configuration.recipient", "identity", "requirements"],
  };
  const stripe = await stripeJsonRequest("https://api.stripe.com/v2/core/accounts", stripeKey, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Stripe-Version": "2026-07-29.preview",
    },
    body: JSON.stringify(accountPayload),
  });
  if (!stripe.ok) {
    return json(
      {
        ok: false,
        error: "CONNECTED_ACCOUNT_CREATE_FAILED",
        stripe_status: stripe.status,
        stripe_error: stripe.data?.error?.type || null,
        message: stripe.data?.error?.message || "Stripe account creation failed",
      },
      502
    );
  }
  return json({
    ok: true,
    account_created: true,
    account_id: stripe.data.id,
    livemode: Boolean(stripe.data.livemode),
  });
}

async function handleOnboardingLink(request, env, url) {
  const stripeKey = getStripeTestKey(env);
  if (!stripeKey) return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 403);
  if (!isAdminRequest(request, env)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
  if (!accountId.startsWith("acct_")) return json({ ok: false, error: "VALID_ACCOUNT_ID_REQUIRED" }, 400);
  const accountLinkPayload = {
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["recipient"],
        collection_options: { fields: "eventually_due" },
        refresh_url: `${url.origin}/connect/refresh?account=${encodeURIComponent(accountId)}`,
        return_url: `${url.origin}/connect/return?account=${encodeURIComponent(accountId)}`,
      },
    },
  };
  const stripe = await stripeJsonRequest("https://api.stripe.com/v2/core/account_links", stripeKey, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Stripe-Version": "2026-07-29.preview",
    },
    body: JSON.stringify(accountLinkPayload),
  });
  if (!stripe.ok) {
    return json(
      {
        ok: false,
        error: "ONBOARDING_LINK_CREATE_FAILED",
        stripe_status: stripe.status,
        stripe_error: stripe.data?.error?.type || null,
        message: stripe.data?.error?.message || "Stripe onboarding link creation failed",
      },
      502
    );
  }
  return json({
    ok: true,
    onboarding_ready: true,
    account_id: accountId,
    onboarding_url: stripe.data.url,
    expires_at: stripe.data.expires_at || null,
  });
}

async function handleTestMarketplace(request, env) {
  const stripeKey = getStripeTestKey(env);
  if (!stripeKey) return json({ ok: false, error: "STRIPE_TEST_KEY_REQUIRED" }, 403);
  if (!isAdminRequest(request, env)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  const accountId = typeof body.account_id === "string" ? body.account_id.trim() : "";
  const amount = Number.isInteger(body.amount) ? body.amount : 10_000;
  const feeBps = Number.isInteger(body.fee_bps) ? body.fee_bps : 500;
  if (!accountId.startsWith("acct_")) return json({ ok: false, error: "VALID_ACCOUNT_ID_REQUIRED" }, 400);
  if (amount < 100 || amount > 1_000_000) return json({ ok: false, error: "INVALID_AMOUNT" }, 400);
  if (feeBps < 0 || feeBps > 3000) return json({ ok: false, error: "INVALID_FEE_BPS" }, 400);
  const platformFee = Math.round((amount * feeBps) / 10_000);
  const workerAmount = amount - platformFee;
  const paymentForm = new URLSearchParams();
  paymentForm.set("amount", String(amount));
  paymentForm.set("currency", "usd");
  paymentForm.set("payment_method", "pm_card_visa");
  paymentForm.set("confirm", "true");
  paymentForm.set("payment_method_types[]", "card");
  paymentForm.set("description", "ProjeYucely sandbox marketplace test");
  paymentForm.set("metadata[platform]", "ProjeYucely");
  paymentForm.set("metadata[test]", "true");
  const payment = await stripeFormRequest("https://api.stripe.com/v1/payment_intents", stripeKey, paymentForm);
  if (!payment.ok) {
    return json(
      {
        ok: false,
        error: "TEST_PAYMENT_FAILED",
        stripe_status: payment.status,
        stripe_error: payment.data?.error?.type || null,
        message: payment.data?.error?.message || "Test payment failed",
      },
      502
    );
  }
  if (payment.data.status !== "succeeded") {
    return json(
      {
        ok: false,
        error: "PAYMENT_NOT_SUCCEEDED",
        payment_intent_id: payment.data.id,
        payment_status: payment.data.status,
      },
      409
    );
  }
  const chargeId = payment.data.latest_charge || null;
  if (!chargeId) {
    return json({ ok: false, error: "CHARGE_ID_MISSING", payment_intent_id: payment.data.id }, 502);
  }
  const transferForm = new URLSearchParams();
  transferForm.set("amount", String(workerAmount));
  transferForm.set("currency", "usd");
  transferForm.set("destination", accountId);
  transferForm.set("source_transaction", chargeId);
  transferForm.set("description", "ProjeYucely sandbox worker transfer");
  transferForm.set("metadata[platform]", "ProjeYucely");
  transferForm.set("metadata[test]", "true");
  const transfer = await stripeFormRequest("https://api.stripe.com/v1/transfers", stripeKey, transferForm);
  if (!transfer.ok) {
    return json(
      {
        ok: false,
        error: "TRANSFER_FAILED",
        payment_succeeded: true,
        payment_intent_id: payment.data.id,
        charge_id: chargeId,
        stripe_status: transfer.status,
        stripe_error: transfer.data?.error?.type || null,
        message: transfer.data?.error?.message || "Transfer failed",
      },
      502
    );
  }
  return json({
    ok: true,
    test_marketplace_payment: true,
    livemode: false,
    amount_cents: amount,
    platform_fee_cents: platformFee,
    worker_transfer_cents: workerAmount,
    payment_intent_id: payment.data.id,
    charge_id: chargeId,
    transfer_id: transfer.data.id,
    destination_account: accountId,
  });
}

async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return handleHealth(env);
  if (request.method === "GET" && url.pathname === "/stripe/test") return handleStripeTest(env);
  if (request.method === "POST" && url.pathname === "/connect/account") return handleCreateAccount(request, env);
  if (request.method === "POST" && url.pathname === "/connect/onboarding-link") return handleOnboardingLink(request, env, url);
  if (request.method === "POST" && url.pathname === "/payments/test-marketplace") return handleTestMarketplace(request, env);
  if (request.method === "GET" && url.pathname === "/connect/return") {
    return json({
      ok: true,
      onboarding_flow_returned: true,
      account_id: url.searchParams.get("account"),
      message:
        "Stripe onboarding flow returned to ProjeYucely. Account status must still be verified before payouts.",
    });
  }
  if (request.method === "GET" && url.pathname === "/connect/refresh") {
    return json(
      {
        ok: false,
        error: "ONBOARDING_LINK_REFRESH_REQUIRED",
        account_id: url.searchParams.get("account"),
        message: "Create a new authenticated onboarding link from the ProjeYucely application.",
      },
      409
    );
  }
  const apiResponse = await handleOpportunityApi(request, env);
  if (apiResponse) return apiResponse;
  if (url.pathname.startsWith("/v1/")) {
    return json(
      {
        error: "API_MIGRATION_IN_PROGRESS",
        message:
          "Core API remains disabled on Cloudflare until D1-backed persistence and auth migration pass regression tests.",
      },
      503
    );
  }
  const asset = await serveAsset(request, env);
  if (asset) return asset;
  return json({ error: "NOT_FOUND" }, 404);
}

export const worker = {
  async fetch(request, env) {
    try {
      return securityHeaders(await routeRequest(request, env));
    } catch (error) {
      observe("request.failed", {
        message: error.message,
        path: new URL(request.url).pathname,
      });
      return securityHeaders(
        json(
          {
            ok: false,

            error: error.message || "INTERNAL_ERROR",

            error: "ONBOARDING_LINK_REFRESH_REQUIRED",
            account_id: url.searchParams.get("account"),
            message:
              "Create a new authenticated onboarding link from the ProjeYucely application.",
          },
          409
        )
      );
    }

    // -----------------------------------------------------------------------
    // POST /api/ingest  — admin-gated manual trigger for the ingestion worker
    // -----------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/ingest") {
      if (!isAdminRequest(request, env)) {
        return securityHeaders(json({ error: "UNAUTHORIZED" }, 401));
      }

      let sources;
      try {
        const body = await request.json().catch(() => ({}));
        sources = Array.isArray(body.sources) ? body.sources : undefined;
      } catch {
        sources = undefined;
      }

      try {
        const result = await runIngestion(env, { sources });
        return securityHeaders(json({ ok: true, ...result }));
      } catch (e) {
        console.error("krevuno /api/ingest error", e?.message);
        return securityHeaders(
          json({ ok: false, error: e?.message ?? "ingestion_failed" }, 500)
        );
      }
    }

    // -----------------------------------------------------------------------
    // POST /api/match  — AI skill/location matching against open opportunities
    // Body: { skills: string[], lat?: number, lng?: number, radiusMiles?: number, limit?: number }
    // Returns: ranked opportunity list with _match scores
    // -----------------------------------------------------------------------
    if (request.method === "POST" && url.pathname === "/api/match") {
      let userProfile = {};
      try {
        userProfile = await request.json().catch(() => ({}));
      } catch {
        userProfile = {};
      }

      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        return securityHeaders(
          json({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, 503)
        );
      }

      try {
        const limit = Math.min(Number(userProfile.limit ?? 100), 200);
        const resp = await fetch(
          `${supabaseUrl}/rest/v1/vovyyvov_opportunities?select=id,title,description,company,city,country,remote,amount,salary_min,salary_max,tags,ai_labels,kind,source,source_url,latitude,longitude,expires_at,created_at&status=eq.OPEN&order=created_at.desc&limit=${limit}`,
          {
            headers: {
              apikey: supabaseKey,
              authorization: `******`,
              accept: "application/json",
            },
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (!resp.ok) {
          throw new Error(`Supabase fetch HTTP ${resp.status}`);
        }

        const opportunities = await resp.json();
        const ranked = rankOpportunities(opportunities, {
          skills: Array.isArray(userProfile.skills) ? userProfile.skills : [],
          lat: Number(userProfile.lat ?? NaN),
          lng: Number(userProfile.lng ?? NaN),
          radiusMiles: Number(userProfile.radiusMiles ?? 25),
        });

        return securityHeaders(
          json({
            ok: true,
            count: ranked.length,
            opportunities: ranked,
          })
        );
      } catch (e) {
        console.error("krevuno /api/match error", e?.message);
        return securityHeaders(
          json({ ok: false, error: e?.message ?? "match_failed" }, 500)
        );
      }
    }

    if (url.pathname.startsWith("/v1/")) {
      return securityHeaders(
        json(
          {
            error: "API_MIGRATION_IN_PROGRESS",
            message:
              "Core API remains disabled on Cloudflare until D1-backed persistence and auth migration pass regression tests.",

          },
          error.message === "AUTH_REQUIRED" ? 401 : error.message.includes("SUPABASE") ? 503 : 500
        )
      );
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      syncExternalOpportunities(env, { trigger: "cron" })
        .then((result) => observe("opportunity.cron_completed", result))
        .catch((error) => observe("opportunity.cron_failed", { message: error.message, cron: controller.cron }))
    );
  },

  // -------------------------------------------------------------------------
  // Scheduled handler — Cloudflare Cron Trigger, runs every hour
  // -------------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    console.log(
      `krevuno-ingest scheduled start cron=${event.cron} t=${event.scheduledTime}`
    );

    ctx.waitUntil(
      runIngestion(env)
        .then((result) => {
          console.log(
            `krevuno-ingest scheduled done fetched=${result.total_fetched} upserted=${result.total_upserted} errors=${result.total_errors} ms=${result.elapsed_ms}`
          );
        })
        .catch((e) => {
          console.error("krevuno-ingest scheduled error", e?.message);
        })
    );
  },
};

export default Sentry.withSentry(
  (env) => ({
    dsn: SENTRY_DSN,
    environment: env.ENVIRONMENT || "production",
    release: "projeyucely@2.1.0-krevuno",
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  }),
  worker
);
