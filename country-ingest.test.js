import test from "node:test";
import assert from "node:assert/strict";
import {
  TOP_PRIORITY_COUNTRIES,
  buildHimalayasCountryUrl,
  normalizeHimalayasJob,
} from "./cloudflare/worker/src/country-ingest.js";

test("top priority country list contains ten China-excluded markets", () => {
  assert.equal(TOP_PRIORITY_COUNTRIES.length, 10);
  assert.deepEqual(
    TOP_PRIORITY_COUNTRIES.map((item) => item.code),
    ["US", "DE", "GB", "IN", "NL", "FR", "BR", "CA", "PL", "CH"]
  );
  assert.equal(TOP_PRIORITY_COUNTRIES.some((item) => item.code === "CN"), false);
});

test("Himalayas URL uses no-auth country search with worldwide exclusions", () => {
  const url = new URL(buildHimalayasCountryUrl("DE"));
  assert.equal(url.origin, "https://himalayas.app");
  assert.equal(url.pathname, "/jobs/api/search");
  assert.equal(url.searchParams.get("country"), "DE");
  assert.equal(url.searchParams.get("exclude_worldwide"), "true");
  assert.equal(url.searchParams.get("sort"), "recent");
  assert.equal(url.searchParams.get("page"), "1");
});

test("normalizer preserves attribution, original link and country", () => {
  const now = "2026-08-20T12:00:00.000Z";
  const row = normalizeHimalayasJob(
    {
      guid: "job-123",
      title: "Senior Engineer",
      companyName: "Example Co",
      companySlug: "example-co",
      applicationLink: "https://himalayas.app/jobs/example-co/senior-engineer",
      locationRestrictions: [{ alpha2: "US", name: "United States" }],
      categories: ["Engineering", "JavaScript"],
      parentCategories: ["Software"],
      seniority: ["Senior"],
      employmentType: "Full Time",
      minSalary: 120000,
      maxSalary: 160000,
      salaryPeriod: "annual",
      currency: "USD",
      description: "<p>Build safe systems.</p>",
      pubDate: Date.parse("2026-08-19T10:00:00Z"),
      expiryDate: Date.parse("2026-09-19T10:00:00Z"),
    },
    { code: "US", name: "United States" },
    now
  );

  assert.equal(row.source_provider, "himalayas");
  assert.equal(row.source_id, "US:job-123");
  assert.equal(row.country, "United States");
  assert.equal(row.remote, true);
  assert.equal(row.public_visibility, true);
  assert.equal(row.metadata.attribution.includes("Himalayas"), true);
  assert.equal(row.source_url.includes("himalayas.app"), true);
  assert.equal(row.description, "Build safe systems.");
  assert.equal(row.salary_text, "USD 120,000–160,000 / annual");
});
