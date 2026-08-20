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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function scrollToAccount(selector) {
  const card = $("#accountCard");
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => $(selector)?.focus(), 350);
}

async function ensureOnboarding(authResult, payload) {
  if (!authResult?.access_token || !authResult?.user?.id) return;
  const token = authResult.access_token;
  const userId = authResult.user.id;

  await api("/rest/v1/vovyyvov_profiles?on_conflict=user_id", {
    method: "POST",
    token,
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: userId,
      display_name: payload.displayName,
      date_of_birth: payload.dob,
      account_type: payload.accountType,
      recruiter_contact_opt_in: payload.recruiterOptIn,
    },
  });

  if (payload.accountType === "BUSINESS_REP" && payload.businessName) {
    const existing = await api(
      `/rest/v1/vovyyvov_organizations?owner_user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
      { token }
    );
    if (!Array.isArray(existing) || existing.length === 0) {
      await api("/rest/v1/vovyyvov_organizations", {
        method: "POST",
        token,
        prefer: "return=minimal",
        body: {
          owner_user_id: userId,
          legal_name: payload.businessName,
          display_name: payload.businessName,
          plan: "FREE",
          plan_price_usd: 39,
          subscription_status: "NONE",
        },
      });
    }
  }
}

async function renderAccountNavigation() {
  const current = session();
  const loggedIn = Boolean(current?.access_token && current?.user?.id);
  const signIn = $("#navSignIn");
  const signUp = $("#navSignUp");
  const profileButton = $("#navProfile");
  const logout = $("#logoutBtn");
  const panel = $("#profilePanel");

  if (signIn) signIn.hidden = loggedIn;
  if (signUp) signUp.hidden = loggedIn;
  if (profileButton) profileButton.hidden = !loggedIn;
  if (logout) logout.hidden = !loggedIn;
  if (!panel) return;

  if (!loggedIn) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  panel.hidden = false;
  panel.innerHTML = '<div class="empty small">Loading your KREVUNO profile…</div>';

  try {
    const userId = current.user.id;
    const [profiles, organizations] = await Promise.all([
      api(
        `/rest/v1/vovyyvov_profiles?user_id=eq.${encodeURIComponent(userId)}&select=display_name,account_type,city,country,skills,recruiter_contact_opt_in,date_of_birth&limit=1`,
        { token: current.access_token }
      ),
      api(
        `/rest/v1/vovyyvov_organizations?owner_user_id=eq.${encodeURIComponent(userId)}&select=display_name,verification_status,plan,subscription_status&limit=1`,
        { token: current.access_token }
      ).catch(() => []),
    ]);

    const profile = Array.isArray(profiles) ? profiles[0] : null;
    const organization = Array.isArray(organizations) ? organizations[0] : null;
    const displayName = profile?.display_name || current.user.email || "KREVUNO Member";
    const accountLabel = profile?.account_type === "BUSINESS_REP" ? "Business / Organization" : "Personal";
    const location = [profile?.city, profile?.country].filter(Boolean).join(", ") || "Location not added";
    const skills = Array.isArray(profile?.skills) && profile.skills.length ? profile.skills.join(", ") : "Skills not added";

    panel.innerHTML = `
      <div class="profile-summary">
        <div><span>Name</span><strong>${esc(displayName)}</strong></div>
        <div><span>Account</span><strong>${esc(accountLabel)}</strong></div>
        <div><span>Email</span><strong>${esc(current.user.email || "")}</strong></div>
        <div><span>Location</span><strong>${esc(location)}</strong></div>
        <div><span>Skills</span><strong>${esc(skills)}</strong></div>
        <div><span>Recruiter contact</span><strong>${profile?.recruiter_contact_opt_in ? "Enabled" : "Off"}</strong></div>
        ${organization ? `<div><span>Organization</span><strong>${esc(organization.display_name || "")}</strong></div><div><span>Verification</span><strong>${esc(organization.verification_status || "UNVERIFIED")}</strong></div>` : ""}
      </div>`;
  } catch (error) {
    panel.innerHTML = `<div class="empty small">Profile is signed in, but profile details could not be loaded right now: ${esc(error.message)}</div>`;
  }
}

function setup() {
  const type = $("#accountType");
  const business = $("#businessName");
  const signup = $("#signupForm");
  const need = $("#needForm");
  const referral = $("#referralBtn");

  $("#navSignIn")?.addEventListener("click", () => scrollToAccount("#loginForm input[name=email]"));
  $("#navSignUp")?.addEventListener("click", () => scrollToAccount("#signupForm input[name=display_name]"));
  $("#navProfile")?.addEventListener("click", () => {
    $("#accountCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
    renderAccountNavigation().catch(() => {});
  });
  $("#logoutBtn")?.addEventListener("click", () => setTimeout(() => renderAccountNavigation().catch(() => {}), 0));
  window.addEventListener("krevuno:session-ready", () => renderAccountNavigation().catch(() => {}));

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
        const businessName = String(form.get("business_name") || "").trim();
        const recruiterOptIn = Boolean(form.get("recruiter_contact_opt_in"));
        const payload = { accountType, displayName, businessName, recruiterOptIn, dob };

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
                recruiter_contact_opt_in: recruiterOptIn,
                business_name: businessName || null,
              },
            },
          });

          if (!out.access_token) {
            const message = $("#authMessage");
            if (message) {
              message.textContent = "Account created. Confirm your email if requested, then sign in. Your KREVUNO profile is created automatically.";
            }
            return;
          }

          sessionStorage.setItem(SESSION_KEY, JSON.stringify(out));
          localStorage.removeItem(SESSION_KEY);
          await ensureOnboarding(out, payload);

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
        box.innerHTML = `<strong>Your KREVUNO invite link</strong><br><input id="refLink" value="${esc(link)}" readonly style="width:100%;margin-top:8px;padding:10px"><button id="copyRef" type="button" style="margin-top:8px">Copy link</button><br><small>Reward unlocks only after verified economic activity.</small>`;
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

  renderAccountNavigation().catch(() => {});
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
else setup();
