import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyOpportunityHeuristic,
  dedupeOpportunities,
  scoreOpportunityMatch,
  syncExternalOpportunities,
  worker,
} from "./src/index.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setMockFetch(handler) {
  globalThis.fetch = handler;
}

function requestUrl(value) {
  return new URL(String(value));
}

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("heuristic classification extracts remote, kind and skills", () => {
  const classified = classifyOpportunityHeuristic({
    title: "Remote React developer contract",
    description: "Build frontend workflows and TypeScript dashboards.",
    tags: ["javascript", "frontend"],
  });
  assert.equal(classified.remote, true);
  assert.equal(classified.kind, "GIG");
  assert.ok(classified.skills.includes("software"));
});

test("dedupe keeps the richer external opportunity", () => {
  const input = [
    {
      source_provider: "remotive",
      source_id: "1",
      title: "Designer",
      company_name: "KREVUNO",
      city: "Berlin",
      dedupe_hash: "same",
      description: "",
    },
    {
      source_provider: "remoteok",
      source_id: "2",
      title: "Designer",
      company_name: "KREVUNO",
      city: "Berlin",
      dedupe_hash: "same",
      description: "Detailed role",
      amount: 120,
      latitude: 52.52,
    },
  ];
  const result = dedupeOpportunities(input);
  assert.equal(result.opportunities.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.opportunities[0].source_provider, "remoteok");
});

test("match scoring favors nearby skill-aligned opportunities", () => {
  const close = scoreOpportunityMatch(
    {
      title: "Warehouse shift",
      skills: ["warehouse"],
      tags: ["inventory"],
      amount: 120,
      remote: false,
      latitude: 40.71,
      longitude: -74.0,
      created_at: new Date().toISOString(),
    },
    {
      availabilitySkills: ["warehouse"],
      profileSkills: ["operations"],
      minimumAmounts: [80],
      lat: 40.73,
      lng: -73.98,
      radiusMiles: 25,
    }
  );
  const far = scoreOpportunityMatch(
    {
      title: "Warehouse shift",
      skills: ["warehouse"],
      tags: ["inventory"],
      amount: 120,
      remote: false,
      latitude: 34.05,
      longitude: -118.25,
      created_at: new Date().toISOString(),
    },
    {
      availabilitySkills: ["warehouse"],
      profileSkills: ["operations"],
      minimumAmounts: [80],
      lat: 40.73,
      lng: -73.98,
      radiusMiles: 25,
    }
  );
  assert.ok(close.score > far.score);
  assert.ok(close.reasons.includes("WITHIN_RADIUS"));
  assert.ok(far.reasons.includes("OUTSIDE_RADIUS"));
});

test("syncExternalOpportunities normalizes feeds and writes sync state", async () => {
  const calls = [];
  setMockFetch(async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    const value = String(url);
    const parsed = requestUrl(url);
    if (parsed.hostname === "remotive.com" && parsed.pathname === "/api/remote-jobs") {
      return jsonResponse({
        jobs: [
          {
            id: 1,
            title: "Remote React developer contract",
            company_name: "Acme",
            candidate_required_location: "Remote",
            salary: "$120",
            url: "https://jobs.example/remotive-1",
            publication_date: "2026-08-19T10:00:00Z",
          },
        ],
      });
    }
    if (parsed.hostname === "www.arbeitnow.com" && parsed.pathname === "/api/job-board-api") {
      return jsonResponse({
        data: [
          {
            slug: "berlin-ops",
            title: "Operations coordinator",
            company_name: "Globex",
            location: "Berlin, Germany",
            remote: false,
            description: "Dispatch and logistics support",
            created_at: "2026-08-19T10:00:00Z",
          },
        ],
      });
    }
    if (parsed.hostname === "jobicy.com" && parsed.pathname === "/api/v2/remote-jobs") {
      return jsonResponse({ jobs: [] });
    }
    if (parsed.hostname === "remoteok.com" && parsed.pathname === "/api") {
      return jsonResponse([
        { legal: "meta" },
        {
          id: 3,
          position: "Remote React developer contract",
          company: "Acme",
          location: "Remote",
          description: "Duplicate of remotive role",
          url: "https://jobs.example/remoteok-3",
          epoch: 1_755_597_600,
        },
      ]);
    }
    if (parsed.hostname === "nominatim.openstreetmap.org") {
      return jsonResponse([
        {
          lat: "52.5200",
          lon: "13.4050",
          address: { city: "Berlin", country: "Germany" },
        },
      ]);
    }
    if (value.includes("/rest/v1/vovyyvov_opportunity_sync_runs") && (init.method || "GET") === "POST") {
      return jsonResponse([{ id: "run-1" }]);
    }
    if (value.includes("/rest/v1/vovyyvov_opportunity_geo_cache")) {
      if ((init.method || "GET") === "GET") return jsonResponse([]);
      return jsonResponse([], 201);
    }
    if (value.includes("/rest/v1/vovyyvov_opportunities?on_conflict=source_provider,source_id")) {
      const body = JSON.parse(init.body);
      return jsonResponse(body, 201);
    }
    if (value.includes("/rest/v1/vovyyvov_opportunities?source_provider=eq.")) {
      return jsonResponse([]);
    }
    if (value.includes("/rest/v1/vovyyvov_opportunities?external=eq.true&status=eq.OPEN&expires_at=lt.")) {
      return jsonResponse([]);
    }
    if (value.includes("/rest/v1/vovyyvov_opportunity_sync_runs?id=eq.run-1")) {
      return jsonResponse([], 200);
    }
    throw new Error(`Unexpected fetch ${value}`);
  });

  const result = await syncExternalOpportunities(
    {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    },
    { trigger: "test" }
  );

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.upserted_count, 2);
  assert.equal(result.duplicate_count, 1);
  assert.ok(calls.some((call) => requestUrl(call.url).hostname === "nominatim.openstreetmap.org"));
});

test("worker discovery endpoint returns public opportunities", async () => {
  setMockFetch(async (url) => {
    const value = String(url);
    const parsed = requestUrl(url);
    if (parsed.pathname === "/rest/v1/vovyyvov_opportunities" && parsed.search.includes("select=")) {
      return jsonResponse([
        {
          id: "opp-1",
          title: "Warehouse shift",
          description: "Today",
          amount: 95,
          city: "Newark",
          country: "United States",
          remote: false,
          status: "OPEN",
          kind: "SHIFT",
          company_name: "Acme",
          source_provider: "krevuno",
          source_id: null,
          source_url: null,
          location_text: "Newark, United States",
          latitude: 40.7357,
          longitude: -74.1724,
          employment_type: "temporary",
          salary_text: "$95",
          currency: "USD",
          skills: ["warehouse"],
          tags: ["inventory"],
          classification: {},
          external: false,
          public_visibility: true,
          map_visibility: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at: null,
          last_seen_at: new Date().toISOString(),
          search_radius_miles: 25,
        },
      ]);
    }
    throw new Error(`Unexpected fetch ${value}`);
  });

  const response = await worker.fetch(
    new Request("https://example.com/api/opportunities/discover?lat=40.73&lng=-74.0&radius_miles=20"),
    {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_ANON_KEY: "anon",
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.opportunities.length, 1);
  assert.equal(body.opportunities[0].title, "Warehouse shift");
});
