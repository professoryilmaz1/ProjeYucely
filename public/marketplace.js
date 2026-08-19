const SUPABASE_URL = "https://hfqjiehsdqwqeivcqfzg.supabase.co";
const SUPABASE_KEY = "sb_publishable_GQLUsMvxJ4-TgdxtAD3WXw_aKpp5Qm2";
const SESSION_KEY = "vovyyvov_supabase_session";
const $ = (s) => document.querySelector(s);

function session() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function headers(token, extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    "content-type": "application/json",
    ...(token ? { authorization: ["Bearer", token].join(" ") } : {}),
    ...extra,
  };
}

async function api(path, { method = "GET", body, token, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: headers(token, prefer ? { prefer } : {}),
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
    throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `HTTP_${response.status}`);
  }
  return data;
}

function is18Plus(dob) {
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) age--;
  return age >= 18;
}

function code() {
  return `KR-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function setup() {
  const type = $("#accountType");
  const business = $("#businessName");
  const signup = $("#signupForm");
  const need = $("#needForm");
  const referral = $("#referralBtn");

  if (type && business) {
    const sync = () => {
      const businessMode = type.value === "BUSINESS_REP";
      business.hidden = !businessMode;
      business.required = businessMode;
    };
    type.addEventListener("change", sync);
    sync();
  }

  if (signup) {
    signup.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const form = new FormData(signup);
        const dob = String(form.get("date_of_birth") || "");
        if (!is18Plus(dob)) {
          const message = $("#authMessage");
          if (message) message.textContent = "KREVUNO launch is 18+. This account cannot be created.";
          return;
        }
        const accountType = String(form.get("account_type") || "PERSONAL");
        const displayName = String(form.get("display_name") || "").trim();
        try {
          const out = await api("/auth/v1/signup", {
            method: "POST",
            body: {
              email: form.get("email"),
              password: form.get("password"),
              data: {
                display_name: displayName,
                account_type: accountType,
                date_of_birth: dob,
              },
            },
          });
          if (!out.access_token) {
            const message = $("#authMessage");
            if (message) message.textContent = "Account created. Confirm your email if requested, then sign in to finish onboarding.";
            return;
          }
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(out));
          localStorage.removeItem(SESSION_KEY);
          await api("/rest/v1/vovyyvov_profiles?on_conflict=user_id", {
            method: "POST",
            token: out.access_token,
            prefer: "resolution=merge-duplicates,return=representation",
            body: {
              user_id: out.user.id,
              display_name: displayName,
              date_of_birth: dob,
              account_type: accountType,
              recruiter_contact_opt_in: Boolean(form.get("recruiter_contact_opt_in")),
            },
          });
          if (accountType === "BUSINESS_REP") {
            const name = String(form.get("business_name") || "").trim();
            await api("/rest/v1/vovyyvov_organizations", {
              method: "POST",
              token: out.access_token,
              prefer: "return=representation",
              body: {
                owner_user_id: out.user.id,
                legal_name: name,
                display_name: name,
                plan: "FREE",
                plan_price_usd: 39,
                subscription_status: "NONE",
              },
            });
          }
          const message = $("#authMessage");
          if (message) {
            message.textContent =
              accountType === "BUSINESS_REP"
                ? "KREVUNO business account created. Free company profile is active; optional Starter tools are $39/month when billing is enabled."
                : "KREVUNO personal account created. Membership is free; the platform fee applies only to completed marketplace earnings.";
          }
          location.reload();
        } catch (error) {
          const message = $("#authMessage");
          if (message) message.textContent = `Sign-up failed: ${error.message}`;
        }
      },
      true
    );
  }

  if (need) {
    need.addEventListener(
      "submit",
      async (event) => {
        const current = session();
        if (!current?.access_token || !current?.user?.id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const form = new FormData(need);
        try {
          await api("/rest/v1/vovyyvov_needs", {
            method: "POST",
            token: current.access_token,
            prefer: "return=representation",
            body: {
              requester_id: current.user.id,
              kind: String(form.get("kind") || "HELP"),
              title: form.get("title"),
              budget: Number(form.get("budget") || 0) || null,
              status: "OPEN",
            },
          });
          need.reset();
          location.reload();
        } catch (error) {
          const message = $("#authMessage");
          if (message) message.textContent = `Could not save need: ${error.message}`;
        }
      },
      true
    );
  }

  if (referral) {
    referral.addEventListener("click", async () => {
      const current = session();
      const box = $("#referralResult");
      if (!box) return;
      if (!current?.access_token || !current?.user?.id) {
        box.textContent = "Sign in first to create your referral link.";
        return;
      }
      try {
        const referralCode = code();
        await api("/rest/v1/vovyyvov_referrals", {
          method: "POST",
          token: current.access_token,
          prefer: "return=representation",
          body: {
            referrer_user_id: current.user.id,
            referral_code: referralCode,
            status: "INVITED",
            reward_type: "CREDIT",
            reward_amount: 0,
          },
        });
        const link = `${location.origin}${location.pathname}?ref=${encodeURIComponent(referralCode)}`;
        box.innerHTML = `<strong>Your KREVUNO invite link</strong><br><input id="refLink" value="${link}" readonly style="width:100%;margin-top:8px;padding:10px"><button id="copyRef" type="button" style="margin-top:8px">Copy link</button><br><small>Reward unlocks only after verified economic activity.</small>`;
        const copy = $("#copyRef");
        if (copy) {
          copy.onclick = async () => {
            await navigator.clipboard.writeText(link);
            copy.textContent = "Copied";
          };
        }
      } catch (error) {
        box.textContent = `Referral link error: ${error.message}`;
      }
    });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
else setup();
