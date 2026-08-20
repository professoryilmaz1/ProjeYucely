const $ = (s) => document.querySelector(s);
const SUPABASE_URL = "https://hfqjiehsdqwqeivcqfzg.supabase.co";
const SUPABASE_KEY = "sb_publishable_GQLUsMvxJ4-TgdxtAD3WXw_aKpp5Qm2";
const storeKey = "vovyyvov_state_v2";
const sessionKey = "vovyyvov_supabase_session";
const pendingKey = "vovyyvov_pending_onboarding";
const defaultGeo = { lat: 20, lng: 0, radius: 25, located: false };
const state = JSON.parse(localStorage.getItem(storeKey) || '{"needs":[],"availability":[],"plans":0}');
let session = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey) || localStorage.getItem(sessionKey) || "null");
  } catch {
    return null;
  }
})();
let remoteReady = false;
let remoteOpportunities = [];
let matchedOpportunities = [];
let liveGeo = window.__KREVUNO_GEO_STATE__ ? { ...window.__KREVUNO_GEO_STATE__ } : { ...defaultGeo };

const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = String(value);
}

function setHtml(id, value) {
  const node = el(id);
  if (node) node.innerHTML = value;
}

function geo() {
  return window.__KREVUNO_GEO_STATE__ ? { ...window.__KREVUNO_GEO_STATE__ } : { ...liveGeo };
}

function persist() {
  localStorage.setItem(storeKey, JSON.stringify(state));
  render();
}

function authHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    "content-type": "application/json",
    ...(session?.access_token
      ? { authorization: ["Bearer", session.access_token].join(" ") }
      : {}),
    ...extra,
  };
}

async function supa(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: authHeaders(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const error = new Error(
      data?.msg || data?.message || data?.error_description || data?.error || `HTTP_${response.status}`
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

async function rest(table, { method = "GET", query = "", body, prefer } = {}) {
  return supa(`/rest/v1/${table}${query}`, {
    method,
    body,
    headers: { prefer: prefer || (method === "POST" ? "return=representation" : "") },
  });
}

async function worker(path, { headers = {} } = {}) {
  const response = await fetch(path, { headers });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP_${response.status}`);
  }
  return data;
}

function setSession(next) {
  session = next;
  if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
  else sessionStorage.removeItem(sessionKey);
  localStorage.removeItem(sessionKey);
  renderAuth();
}

function renderAuth() {
  const logged = Boolean(session?.access_token);
  const logout = el("logoutBtn");
  const forms = el("authForms");
  setText("authBadge", logged ? "SIGNED IN" : "GUEST");
  if (logout) logout.hidden = !logged;
  if (forms) forms.hidden = logged;
  setText("identityStatus", logged ? `Supabase Auth • ${session.user?.email || "authenticated"}` : "Guest / Supabase Auth ready");
  if (logged) {
    setText(
      "authMessage",
      "Signed in. KREVUNO cloud marketplace persistence is active when your authenticated session can reach the marketplace tables."
    );
  }
}

function setBackend(ok, message) {
  remoteReady = ok;
  const backend = el("backendState");
  if (backend) backend.innerHTML = `<i></i> ${esc(message)}`;
  setText("dataStatus", ok ? "Supabase cloud persistence active" : "Local fallback active");
  setText("marketBadge", ok ? "CLOUD LIVE" : "SAFE PREVIEW");
}

function haversineMi(a, b, c, d) {
  const R = 3958.7613;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(c - a);
  const dLon = toRad(d - b);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

function rankedOps(list = remoteOpportunities) {
  const g = geo();
  return list
    .map((opportunity) => {
      const lat = Number(opportunity.latitude);
      const lng = Number(opportunity.longitude);
      const distance =
        opportunity.distance_miles ??
        (g?.located && Number.isFinite(lat) && Number.isFinite(lng)
          ? haversineMi(Number(g.lat), Number(g.lng), lat, lng)
          : null);
      return { ...opportunity, distance };
    })
    .sort((a, b) => {
      const aScore = Number(a.match?.score ?? -1);
      const bScore = Number(b.match?.score ?? -1);
      if (aScore !== bScore) return bScore - aScore;
      if (a.remote && !b.remote) return 1;
      if (!a.remote && b.remote) return -1;
      if (a.distance == null && b.distance != null) return 1;
      if (a.distance != null && b.distance == null) return -1;
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
}

function renderEarn() {
  const real = rankedOps(matchedOpportunities.length ? matchedOpportunities : remoteOpportunities);
  setText("mEarn", real.length);
  if (!real.length) {
    setHtml(
      "earnList",
      '<div class="empty small">No live opportunities match the current filters yet. KREVUNO keeps local opportunities working and refreshes public external feeds every hour.</div>'
    );
    return;
  }
  setHtml(
    "earnList",
    real
      .map((opportunity) => {
        const place = opportunity.remote
          ? "Remote"
          : opportunity.distance != null
            ? `${opportunity.distance.toFixed(opportunity.distance < 10 ? 1 : 0)} mi away${opportunity.city ? ` • ${opportunity.city}` : ""}`
            : [opportunity.city, opportunity.country].filter(Boolean).join(", ") || opportunity.kind || "Marketplace";
        const provider = [opportunity.company_name, opportunity.source_provider].filter(Boolean).join(" • ");
        const match = opportunity.match?.score != null ? ` • match ${Number(opportunity.match.score).toFixed(0)}%` : "";
        return `<div class="item"><strong>${esc(opportunity.title)}</strong><span>${money(opportunity.amount)} • ${esc(place)}${esc(match)}${provider ? ` • ${esc(provider)}` : ""}</span></div>`;
      })
      .join("")
  );
}

function render() {
  setText("mNeeds", state.needs.length);
  setText("mPlans", state.plans || 0);
  setHtml(
    "needList",
    state.needs.length
      ? state.needs
          .slice()
          .reverse()
          .map((need) => `<div class="item"><strong>${esc(need.title)}</strong><span>${need.budget ? money(need.budget) : "Open budget"}</span></div>`)
          .join("")
      : '<div class="empty small">No needs yet.</div>'
  );
  setHtml(
    "availList",
    state.availability.length
      ? state.availability
          .slice()
          .reverse()
          .map((availability) => `<div class="item"><strong>${esc(availability.skill)}</strong><span>${esc(availability.hours || availability.hours_text || "Flexible")} ${(availability.minimum || availability.minimum_amount) ? `• min ${money(availability.minimum || availability.minimum_amount)}` : ""}</span></div>`)
          .join("")
      : '<div class="empty small">No availability saved.</div>'
  );
  renderEarn();
  renderAuth();
}

function classify(text) {
  const t = text.toLowerCase();
  if (/save|budget|reduce|cut/.test(t)) return "SAVE_MONEY";
  if (/earn|make|income|money|\$|para|kazan|hourly|daily|part.?time|shift/.test(t)) return "MONEY_MISSION";
  if (/need|help|hire|worker|yardım|lazım|eleman/.test(t)) return "NEED_HELP";
  if (/day|today|plan|gün/.test(t)) return "PLAN_LIFE";
  if (/match|partner|friend|mentor|eş|arkadaş/.test(t)) return "MATCH";
  return "OPPORTUNITY";
}

function amountFrom(text) {
  const match = text.replace(/,/g, "").match(/\$?\s*(\d{2,7})/);
  return match ? Number(match[1]) : null;
}

function actionPlan(text) {
  const intent = classify(text);
  const amount = amountFrom(text);
  let actions = [];
  if (intent === "MONEY_MISSION") {
    const target = amount || 200;
    actions = [
      `Set a realistic target: ${money(target)}.`,
      "Check real nearby or remote KREVUNO opportunities that match your skills, time and travel radius.",
      "Combine only work you can actually accept and complete; availability and earnings are never guaranteed.",
    ];
  } else if (intent === "NEED_HELP") {
    actions = [
      "Define the task or shift clearly: what, where, when and how long.",
      "Set a fair budget/pay and any qualification or safety requirements.",
      "Compare suitable responses and confirm scope before work starts.",
    ];
  } else if (intent === "SAVE_MONEY") {
    actions = [
      "List fixed and flexible monthly costs.",
      "Cut or renegotiate the three lowest-value flexible expenses first.",
      "For short staffing needs, compare scoped temporary options before committing to unnecessary long-term cost.",
    ];
  } else if (intent === "PLAN_LIFE") {
    actions = [
      "Choose one money/work action that can improve today.",
      "Choose one obligation that reduces future stress.",
      "Choose one health/home/personal action and finish it before adding more.",
    ];
  } else if (intent === "MATCH") {
    actions = [
      "Define the kind of connection you want and non-negotiable boundaries.",
      "Use mutual opt-in only; do not reveal contact details before both sides approve.",
      "Prioritize compatibility, safety and verification over match volume.",
    ];
  } else {
    actions = [
      "Clarify the outcome you want.",
      "Choose the smallest useful action you can take now.",
      "Review the result and adjust the next action based on evidence.",
    ];
  }
  return { intent, actions, amount };
}

function showPlan(text) {
  const plan = actionPlan(text);
  setText("intent", plan.intent);
  setHtml(
    "result",
    `<strong>${esc(text)}</strong><div class="result-actions">${plan.actions.map((action, index) => `<div><strong>${index + 1}.</strong> ${esc(action)}</div>`).join("")}</div>`
  );
  state.plans = (state.plans || 0) + 1;
  persist();
}

async function finishPendingOnboarding() {
  if (!session?.user?.id) return;
  let pending;
  try {
    pending = JSON.parse(localStorage.getItem(pendingKey) || "null");
  } catch {}
  if (!pending) return;
  try {
    await rest("vovyyvov_profiles", {
      method: "POST",
      query: "?on_conflict=user_id",
      prefer: "resolution=merge-duplicates,return=representation",
      body: {
        user_id: session.user.id,
        display_name: pending.displayName || session.user.email || "User",
        date_of_birth: pending.dob || null,
        account_type: pending.accountType || "PERSONAL",
        recruiter_contact_opt_in: false,
      },
    });
    if (pending.accountType === "BUSINESS_REP" && pending.businessName) {
      await rest("vovyyvov_organizations", {
        method: "POST",
        body: {
          owner_user_id: session.user.id,
          legal_name: pending.businessName,
          display_name: pending.businessName,
          plan: "FREE",
          plan_price_usd: 39,
          subscription_status: "NONE",
        },
      });
    }
    localStorage.removeItem(pendingKey);
  } catch (error) {
    console.warn("KREVUNO onboarding completion pending", error);
  }
}

async function loadRemote() {
  const g = geo();
  const query = new URLSearchParams({ limit: "100" });
  if (g?.located) {
    query.set("lat", String(g.lat));
    query.set("lng", String(g.lng));
    query.set("radius_miles", String(g.radius || 25));
  }
  try {
    const shared = worker(`/api/opportunities/discover?${query.toString()}`);
    const personalized = session?.access_token
      ? worker(`/api/opportunities/matches?${query.toString()}`, {
          headers: { authorization: ["Bearer", session.access_token].join(" ") },
        }).catch(() => null)
      : Promise.resolve(null);
    const ownData =
      remoteReady && session?.user?.id
        ? Promise.all([
            rest("vovyyvov_needs", {
              query: `?select=*&requester_id=eq.${encodeURIComponent(session.user.id)}&order=created_at.desc&limit=100`,
            }),
            rest("vovyyvov_availability", {
              query: `?select=*&user_id=eq.${encodeURIComponent(session.user.id)}&order=created_at.desc&limit=100`,
            }),
          ]).catch(() => null)
        : Promise.resolve(null);
    const [opportunitiesPayload, matchesPayload, ownPayload] = await Promise.all([
      shared,
      personalized,
      ownData,
    ]);
    remoteOpportunities = opportunitiesPayload?.opportunities || [];
    matchedOpportunities = matchesPayload?.opportunities || [];
    if (Array.isArray(ownPayload?.[0])) {
      state.needs = ownPayload[0];
      state.availability = ownPayload[1];
    }
    persist();
  } catch (error) {
    remoteOpportunities = [];
    matchedOpportunities = [];
    console.warn("KREVUNO opportunity discovery unavailable", error);
    persist();
  }
}

async function probeBackend() {
  if (!session?.access_token) {
    setBackend(false, "Supabase Auth ready • public opportunity discovery live");
    await loadRemote();
    return;
  }
  try {
    await rest("vovyyvov_needs", { query: "?select=id&limit=1" });
    setBackend(true, "KREVUNO marketplace cloud live");
  } catch (error) {
    setBackend(false, "Cloud access unavailable • public opportunity discovery still live");
    setText(
      "authMessage",
      `Signed in, but marketplace cloud access is temporarily unavailable (${error.message}). Local planning tools remain available.`
    );
  }
  await loadRemote();
}

const login = el("loginForm");
if (login) {
  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const out = await supa("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password") },
      });
      setSession(out);
      await finishPendingOnboarding();
      setText("authMessage", "Signed in successfully.");
      await probeBackend();
      window.dispatchEvent(new CustomEvent("krevuno:session-ready"));
    } catch (error) {
      setText("authMessage", `Sign-in failed: ${error.message}`);
    }
  });
}

const logout = el("logoutBtn");
if (logout) {
  logout.addEventListener("click", () => {
    setSession(null);
    remoteReady = false;
    remoteOpportunities = [];
    matchedOpportunities = [];
    setBackend(false, "Supabase Auth ready • public opportunity discovery live");
    loadRemote().catch(() => {});
    render();
  });
}

document.querySelectorAll("[data-p]").forEach((button) =>
  button.addEventListener("click", () => {
    const one = el("oneText");
    if (one) {
      one.value = button.dataset.p;
      one.focus();
    }
  })
);

const oneForm = el("oneForm");
if (oneForm) {
  oneForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = el("oneText")?.value.trim();
    if (text) showPlan(text);
  });
}

const needForm = el("needForm");
if (needForm) {
  needForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = {
      id: crypto.randomUUID(),
      kind: String(form.get("kind") || "HELP"),
      title: form.get("title"),
      budget: Number(form.get("budget") || 0),
      created_at: new Date().toISOString(),
    };
    if (remoteReady && session?.user?.id) {
      try {
        await rest("vovyyvov_needs", {
          method: "POST",
          body: {
            requester_id: session.user.id,
            kind: item.kind,
            title: item.title,
            budget: item.budget || null,
            status: "OPEN",
          },
        });
        event.currentTarget.reset();
        await loadRemote();
        return;
      } catch {
        setBackend(false, "Cloud write fallback");
      }
    }
    state.needs.push(item);
    event.currentTarget.reset();
    persist();
  });
}

const availForm = el("availForm");
if (availForm) {
  availForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = {
      id: crypto.randomUUID(),
      skill: form.get("skill"),
      hours: form.get("hours"),
      minimum: Number(form.get("minimum") || 0),
    };
    if (remoteReady && session?.user?.id) {
      try {
        await rest("vovyyvov_availability", {
          method: "POST",
          body: {
            user_id: session.user.id,
            skill: item.skill,
            hours_text: item.hours || null,
            minimum_amount: item.minimum || null,
            active: true,
          },
        });
        event.currentTarget.reset();
        await loadRemote();
        return;
      } catch {
        setBackend(false, "Cloud write fallback");
      }
    }
    state.availability.push(item);
    event.currentTarget.reset();
    persist();
  });
}

const moneyForm = el("moneyForm");
if (moneyForm) {
  moneyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = Number(form.get("target") || 0);
    const source = rankedOps(matchedOpportunities.length ? matchedOpportunities : remoteOpportunities)
      .map((opportunity) => ({
        id: opportunity.id,
        title: opportunity.title,
        amount: Number(opportunity.amount || 0),
      }))
      .filter((opportunity) => opportunity.amount > 0);

    if (!source.length) {
      setHtml(
        "moneyResult",
        "<strong>No live opportunity data is available yet.</strong><br>Check back after the next hourly sync or widen your search radius."
      );
      return;
    }

    let total = 0;
    const chosen = [];
    for (const opportunity of [...source].sort((a, b) => b.amount - a.amount)) {
      if (total >= target) break;
      chosen.push(opportunity);
      total += Number(opportunity.amount || 0);
    }

    setHtml(
      "moneyResult",
      `<strong>Target: ${money(target)}</strong><br>Selected live opportunity value: ${money(total)}<div class="list">${chosen.map((opportunity) => `<div class="item"><strong>${esc(opportunity.title)}</strong><span>${money(opportunity.amount)}</span></div>`).join("")}</div>`
    );

    state.plans = (state.plans || 0) + 1;
    persist();

    if (remoteReady && session?.user?.id) {
      try {
        await rest("vovyyvov_money_missions", {
          method: "POST",
          body: {
            user_id: session.user.id,
            target_amount: target,
            projected_amount: total,
            status: "PLANNING",
            selected_opportunity_ids: chosen.map((item) => item.id).filter(Boolean),
          },
        });
      } catch (error) {
        console.warn(error);
      }
    }
  });
}

const budgetForm = el("budgetForm");
if (budgetForm) {
  budgetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const income = Number(form.get("income") || 0);
    const expenses = ["housing", "food", "transport", "other"].reduce(
      (sum, key) => sum + Number(form.get(key) || 0),
      0
    );
    const balance = income - expenses;
    const rate = income ? Math.max(-1, balance / income) : 0;

    setHtml(
      "budgetResult",
      `Income <strong>${money(income)}</strong><br>Expenses <strong>${money(expenses)}</strong><br>Balance <strong>${money(balance)}</strong><br>Savings rate <strong>${(rate * 100).toFixed(1)}%</strong>`
    );

    const daily = balance < 0
      ? [
          `Close the deficit: identify ${money(Math.abs(balance))} in cuts or additional earned income.`,
          "Review housing/transport first because large categories move the result fastest.",
          "Check one realistic earning action you can complete today.",
        ]
      : [
          `Protect at least ${money(balance * 0.3)} of the surplus as reserve.`,
          "Review one recurring expense for a lower-cost alternative.",
          "Use part of the remaining surplus for the highest-priority goal.",
        ];

    setHtml(
      "daily3",
      daily.map((item, index) => `<div class="item"><strong>${index + 1}. ${esc(item)}</strong></div>`).join("")
    );
  });
}

let tr = false;
const langBtn = el("langBtn");
if (langBtn) {
  langBtn.addEventListener("click", () => {
    tr = !tr;
    setText(
      "heroTitle",
      tr
        ? "Yakınında kısa süreli iş bul. Hızlı eleman bul. KREVUNO ile harekete geç."
        : "Work nearby. Hire fast. Get help when you need it."
    );
    setText(
      "heroText",
      tr
        ? "KREVUNO; saatlik, günlük, kısa süreli ve part-time iş, hizmet ve eleman ihtiyaçlarını yakın çevrede buluşturmaya yardımcı olur. Üyelik ücretsizdir."
        : "KREVUNO connects people and businesses with nearby short-term, hourly, daily and part-time work and services. Personal and business signup is free."
    );
  });
}

window.addEventListener("krevuno:geo-change", () => {
  liveGeo = window.__KREVUNO_GEO_STATE__ ? { ...window.__KREVUNO_GEO_STATE__ } : liveGeo;
  renderEarn();
  loadRemote().catch(() => {});
});

render();
probeBackend();
loadRemote().catch(() => {});