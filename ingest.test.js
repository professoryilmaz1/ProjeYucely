/**
 * KREVUNO Global Opportunity Engine — Ingestion Module Tests
 * Run with: node --test cloudflare/worker/ingest.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  blankOpportunity,
  classifyKind,
  deriveLabels,
  scoreOpportunity,
  rankOpportunities,
  fetchRemotive,
  fetchArbeitnow,
  fetchJobicy,
  fetchRemoteOK,
  upsertOpportunities,
  expireOldOpportunities,
  runIngestion,
} from "./cloudflare/worker/src/ingest.js";

// ---------------------------------------------------------------------------
// Unit: blankOpportunity
// ---------------------------------------------------------------------------
test("blankOpportunity returns expected defaults", () => {
  const opp = blankOpportunity();
  assert.equal(opp.source, "local");
  assert.equal(opp.status, "OPEN");
  assert.equal(opp.remote, false);
  assert.deepEqual(opp.tags, []);
  assert.deepEqual(opp.ai_labels, []);
  assert.ok(opp.ingested_at);
});

// ---------------------------------------------------------------------------
// Unit: classifyKind
// ---------------------------------------------------------------------------
test("classifyKind detects GIG for part-time/hourly/shift postings", () => {
  assert.equal(classifyKind("Part-time barista needed", []), "GIG");
  assert.equal(classifyKind("Hourly delivery driver", []), "GIG");
  assert.equal(classifyKind("Evening shift worker", []), "GIG");
  assert.equal(classifyKind("Freelance designer", []), "GIG");
});

test("classifyKind defaults to JOB for full-time roles", () => {
  assert.equal(classifyKind("Senior Software Engineer", ["javascript"]), "JOB");
  assert.equal(classifyKind("Full-time marketing manager", []), "JOB");
});

// ---------------------------------------------------------------------------
// Unit: deriveLabels
// ---------------------------------------------------------------------------
test("deriveLabels extracts tech label from engineering title", () => {
  const labels = deriveLabels("Senior Backend Engineer", ["nodejs", "python"]);
  assert.ok(labels.includes("tech"), `expected tech in ${labels}`);
});

test("deriveLabels marks remote when tags include remote", () => {
  const labels = deriveLabels("Product Manager", ["remote"]);
  assert.ok(labels.includes("remote"), `expected remote in ${labels}`);
});

test("deriveLabels returns at most 8 labels", () => {
  const labels = deriveLabels(
    "engineer developer designer marketer sales finance hr legal",
    ["data", "product", "remote", "part-time"]
  );
  assert.ok(labels.length <= 8, `too many labels: ${labels.length}`);
});

// ---------------------------------------------------------------------------
// Unit: parseSalary (internal helper via classifyKind passthrough)
// ---------------------------------------------------------------------------
// parseSalary is not exported directly; test via integration in scoreOpportunity
// We test the salary fields end-to-end through adapter mocks below.

// ---------------------------------------------------------------------------
// Unit: scoreOpportunity
// ---------------------------------------------------------------------------
test("scoreOpportunity gives skill bonus when skills match ai_labels", () => {
  const opp = {
    ...blankOpportunity(),
    remote: true,
    ai_labels: ["tech", "design"],
    tags: ["javascript"],
    title: "Frontend Developer",
    latitude: null,
    longitude: null,
  };
  const profile = { skills: ["javascript", "react"], lat: NaN, lng: NaN, radiusMiles: 25 };
  const result = scoreOpportunity(opp, profile);
  assert.equal(result.blocked, false);
  assert.ok(result.score > 0, `score should be positive, got ${result.score}`);
});

test("scoreOpportunity blocks opportunity outside radius when not remote", () => {
  const opp = {
    ...blankOpportunity(),
    remote: false,
    latitude: 51.5074,
    longitude: -0.1278,
    ai_labels: ["tech"],
    tags: [],
    title: "Office job London",
  };
  // User is in New York — far outside any reasonable radius
  const profile = { skills: [], lat: 40.7128, lng: -74.006, radiusMiles: 25 };
  const result = scoreOpportunity(opp, profile);
  assert.equal(result.blocked, true);
});

test("scoreOpportunity does not block remote opportunity outside radius", () => {
  const opp = {
    ...blankOpportunity(),
    remote: true,
    latitude: 51.5074,
    longitude: -0.1278,
    ai_labels: [],
    tags: [],
    title: "Remote job",
  };
  const profile = { skills: [], lat: 40.7128, lng: -74.006, radiusMiles: 25 };
  const result = scoreOpportunity(opp, profile);
  assert.equal(result.blocked, false);
  assert.ok(result.score >= 10, "remote bonus should apply");
});

test("scoreOpportunity neutral score when no skills provided", () => {
  const opp = {
    ...blankOpportunity(),
    remote: false,
    ai_labels: ["tech"],
    tags: [],
    title: "Developer",
    latitude: null,
    longitude: null,
  };
  const profile = { skills: [], lat: NaN, lng: NaN, radiusMiles: 25 };
  const result = scoreOpportunity(opp, profile);
  assert.equal(result.blocked, false);
  assert.ok(result.score >= 30, "neutral score should be at least 30");
});

// ---------------------------------------------------------------------------
// Unit: rankOpportunities
// ---------------------------------------------------------------------------
test("rankOpportunities sorts by descending match score", () => {
  const opps = [
    { ...blankOpportunity(), id: "low", remote: false, ai_labels: [], tags: [], title: "Office job", latitude: 51.5, longitude: 0 },
    { ...blankOpportunity(), id: "high", remote: true, ai_labels: ["tech"], tags: ["javascript"], title: "Remote JS dev" },
  ];
  const profile = { skills: ["javascript"], lat: NaN, lng: NaN, radiusMiles: 25 };
  const ranked = rankOpportunities(opps, profile);
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].id, "high");
});

test("rankOpportunities filters out blocked opportunities", () => {
  const opps = [
    { ...blankOpportunity(), id: "blocked", remote: false, ai_labels: [], tags: [], title: "London office", latitude: 51.5, longitude: -0.1 },
  ];
  const profile = { skills: [], lat: 40.71, lng: -74.0, radiusMiles: 10 };
  const ranked = rankOpportunities(opps, profile);
  assert.equal(ranked.length, 0);
});

// ---------------------------------------------------------------------------
// Integration: adapter response parsing (mock fetch)
// ---------------------------------------------------------------------------

function mockFetch(responseBody, status = 200) {
  return async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
}

test("fetchRemotive normalises job list correctly", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch({
    jobs: [
      {
        id: 1001,
        title: "Senior React Developer",
        company_name: "Acme Corp",
        job_type: "full_time",
        salary: "$80,000 - $120,000",
        description: "<p>Build amazing products</p>",
        url: "https://remotive.com/jobs/1001",
        tags: ["react", "javascript"],
        publication_date: new Date().toISOString(),
      },
    ],
  });

  t.after(() => {
    globalThis.fetch = original;
  });

  const rows = await fetchRemotive({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "remotive");
  assert.equal(rows[0].external_id, "1001");
  assert.equal(rows[0].remote, true);
  assert.ok(rows[0].tags.includes("react"));
  assert.ok(rows[0].salary_min > 0, "salary_min should be parsed");
  assert.ok(rows[0].expires_at, "expires_at should be set");
});

test("fetchArbeitnow normalises job list correctly", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch({
    data: [
      {
        slug: "frontend-dev-acme",
        title: "Frontend Developer",
        company_name: "Acme",
        location: "Berlin, Germany",
        remote: false,
        tags: ["vue", "css"],
        description: "Work with us",
        url: "https://arbeitnow.com/jobs/frontend-dev-acme",
      },
    ],
  });

  t.after(() => {
    globalThis.fetch = original;
  });

  const rows = await fetchArbeitnow({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "arbeitnow");
  assert.equal(rows[0].external_id, "frontend-dev-acme");
  assert.equal(rows[0].city, "Berlin, Germany");
  assert.equal(rows[0].remote, false);
});

test("fetchJobicy normalises job list correctly", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch({
    jobs: [
      {
        id: 5050,
        jobTitle: "Data Analyst",
        companyName: "DataCo",
        jobGeo: "Worldwide",
        jobCategories: ["Data & Analytics"],
        jobType: "full-time",
        jobDescription: "Analyze data",
        url: "https://jobicy.com/jobs/5050",
      },
    ],
  });

  t.after(() => {
    globalThis.fetch = original;
  });

  const rows = await fetchJobicy({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "jobicy");
  assert.equal(rows[0].external_id, "5050");
  assert.equal(rows[0].remote, true);
  assert.ok(rows[0].ai_labels.includes("data"));
});

test("fetchRemoteOK normalises job list correctly", async (t) => {
  const original = globalThis.fetch;
  // RemoteOK prepends a legal notice object before the jobs
  globalThis.fetch = mockFetch([
    { legal: "Do not use in scrapers" },
    {
      id: "9999",
      position: "DevOps Engineer",
      company: "CloudCo",
      description: "Manage infra",
      url: "https://remoteok.com/jobs/9999",
      tags: ["devops", "aws"],
      location: "Remote",
      salary_min: 90000,
      salary_max: 130000,
      date: new Date().toISOString(),
    },
  ]);

  t.after(() => {
    globalThis.fetch = original;
  });

  const rows = await fetchRemoteOK({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "remoteok");
  assert.equal(rows[0].external_id, "9999");
  assert.equal(rows[0].remote, true);
  assert.ok(rows[0].salary_min > 0);
});

// ---------------------------------------------------------------------------
// Integration: upsertOpportunities
// ---------------------------------------------------------------------------
test("upsertOpportunities throws when env is missing", async () => {
  await assert.rejects(
    () => upsertOpportunities([blankOpportunity()], {}),
    /SUPABASE_URL and SUPABASE_SERVICE_KEY/
  );
});

test("upsertOpportunities returns inserted count on success", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 201 });

  t.after(() => {
    globalThis.fetch = original;
  });

  const row = { ...blankOpportunity(), source: "remotive", external_id: "x1", title: "Test Job" };
  const result = await upsertOpportunities([row], {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
  });
  assert.equal(result.inserted, 1);
  assert.equal(result.errors, 0);
});

test("upsertOpportunities counts error when Supabase returns non-2xx", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "bad request" }), { status: 400 });

  t.after(() => {
    globalThis.fetch = original;
  });

  const row = { ...blankOpportunity(), source: "remotive", external_id: "x2", title: "Bad Job" };
  const result = await upsertOpportunities([row], {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
  });
  assert.equal(result.errors, 1);
});

// ---------------------------------------------------------------------------
// Integration: runIngestion end-to-end (mocked adapters)
// ---------------------------------------------------------------------------
test("runIngestion aggregates results from all adapters", async (t) => {
  const original = globalThis.fetch;
  let callCount = 0;

  // Helper: extract hostname for safe URL routing
  function host(url) {
    try { return new URL(String(url)).hostname; } catch { return ""; }
  }

  // Mock all external calls
  globalThis.fetch = async (url) => {
    callCount++;
    const h = host(url);

    // Adapter calls
    if (h === "remotive.com") {
      return new Response(JSON.stringify({ jobs: [{ id: 1, title: "Remote Dev", tags: [], url: "https://r.com" }] }), { status: 200 });
    }
    if (h === "www.arbeitnow.com") {
      return new Response(JSON.stringify({ data: [{ slug: "s1", title: "Dev Job", url: "https://a.com", tags: [] }] }), { status: 200 });
    }
    if (h === "jobicy.com") {
      return new Response(JSON.stringify({ jobs: [{ id: 2, jobTitle: "Analyst", url: "https://j.com" }] }), { status: 200 });
    }
    if (h === "remoteok.com") {
      return new Response(JSON.stringify([{ id: "3", position: "Ops", tags: [], url: "https://ro.com" }]), { status: 200 });
    }
    // Upsert and expire calls go to Supabase
    return new Response("", { status: 201 });
  };

  t.after(() => {
    globalThis.fetch = original;
  });

  const result = await runIngestion({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
  });

  assert.equal(result.ok, true);
  assert.ok(result.total_fetched >= 4, `expected >=4 fetched, got ${result.total_fetched}`);
  assert.ok(result.elapsed_ms >= 0);
  assert.ok(result.sources.remotive);
  assert.ok(result.sources.arbeitnow);
  assert.ok(result.sources.jobicy);
  assert.ok(result.sources.remoteok);
});

test("runIngestion handles adapter error gracefully and continues", async (t) => {
  const original = globalThis.fetch;

  globalThis.fetch = async (url) => {
    function host(u) { try { return new URL(String(u)).hostname; } catch { return ""; } }
    const h = host(url);
    if (h === "remotive.com") {
      return new Response("Internal Server Error", { status: 500 });
    }
    if (h === "www.arbeitnow.com") {
      return new Response(JSON.stringify({ data: [{ slug: "s2", title: "Dev", url: "https://a.com", tags: [] }] }), { status: 200 });
    }
    if (h === "jobicy.com") {
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    }
    if (h === "remoteok.com") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response("", { status: 201 });
  };

  t.after(() => {
    globalThis.fetch = original;
  });

  const result = await runIngestion({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_KEY: "test-key",
  });

  // Remotive failed → error counted
  assert.ok(result.sources.remotive?.error, "remotive should have an error");
  // Arbeitnow succeeded
  assert.ok(result.sources.arbeitnow?.fetched >= 0);
  // Overall not fully ok (remotive failed)
  assert.equal(result.ok, false);
});
