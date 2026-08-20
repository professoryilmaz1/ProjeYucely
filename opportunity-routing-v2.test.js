import test from "node:test";
import assert from "node:assert/strict";
import { scoreMatch } from "./cloudflare/worker/src/opportunity-routing-v2.js";

test("local job inside radius is rewarded", () => {
  const result = scoreMatch({
    skills:["software"], tags:["javascript"], remote:false,
    latitude:40.7128, longitude:-74.0060, country:"United States", city:"New York",
    amount:90000, created_at:new Date().toISOString()
  }, {
    profileSkills:["software","javascript"], lat:40.7306, lng:-73.9352,
    radiusMiles:25, country:"United States", city:"New York", minimumAmounts:[70000]
  });
  assert.ok(result.score >= 70);
  assert.ok(result.distance_miles < 25);
  assert.ok(result.reasons.includes("WITHIN_RADIUS"));
  assert.ok(result.reasons.includes("COUNTRY_MATCH"));
  assert.ok(result.reasons.includes("CITY_MATCH"));
});

test("local job outside radius receives zero location component", () => {
  const result = scoreMatch({
    skills:["driver"], tags:[], remote:false,
    latitude:34.0522, longitude:-118.2437, country:"United States", city:"Los Angeles",
    created_at:new Date().toISOString()
  }, {
    profileSkills:["driver"], lat:40.7128, lng:-74.0060,
    radiusMiles:50, country:"United States"
  });
  assert.ok(result.distance_miles > 50);
  assert.equal(result.components.location, 0.15);
});

test("remote job remains highly location compatible", () => {
  const result = scoreMatch({
    skills:["marketing"], tags:["remote"], remote:true,
    country:"Canada", city:null, created_at:new Date().toISOString()
  }, {
    profileSkills:["marketing"], radiusMiles:10, country:"Canada"
  });
  assert.equal(result.components.location, 1);
  assert.ok(result.reasons.includes("REMOTE_READY"));
});
