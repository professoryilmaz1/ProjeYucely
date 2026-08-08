const moneyMissionPatterns = [/\b(laz[iı]m|need)\b.*\$?\d+/i, /\$?\d+.*\b(laz[iı]m|need)\b/i, /find me.*\$?\d+/i, /bana.*\$?\d+.*bul/i];
const earnPatterns = [/para kazan/i, /iş ar[ıi]yorum/i, /work.*earn/i, /available.*work/i, /boşum/i, /bosum/i];
const relationshipPatterns = [/evlenmek/i, /eş ar/i, /es ar/i, /marry/i, /marriage/i, /partner ar/i];
const whatIfPatterns = [/what if/i, /olursa ne olur/i, /alsam ne olur/i, /taşınsam/i, /tasinsam/i];
const savePatterns = [/tasarruf/i, /save money/i, /save me/i, /harcama.*azalt/i, /gider.*azalt/i, /ayda.*\$?\d+.*azalt/i];
const planPatterns = [/planla/i, /program[ıi]m/i, /takvim/i, /schedule/i, /günümü/i, /gunumu/i, /fix my day/i, /bugünümü düzelt/i, /bugunumu duzelt/i];
const supportPatterns = [/şikayet/i, /sikayet/i, /support/i, /problem.*uygulama/i, /yardım merkezi/i];

const any = (text, patterns) => patterns.some((p) => p.test(text));

function extractAmount(text) {
  const usd = text.match(/\$\s?(\d+(?:[.,]\d{1,2})?)/);
  if (usd) return { amount: Number(usd[1].replace(',', '.')), currency: 'USD' };
  const plain = text.match(/\b(\d+(?:[.,]\d{1,2})?)\s?(dolar|usd|euro|eur|tl|try)\b/i);
  if (!plain) return { amount: null, currency: null };
  const unit = plain[2].toLowerCase();
  const currency = unit === 'euro' || unit === 'eur' ? 'EUR' : unit === 'tl' || unit === 'try' ? 'TRY' : 'USD';
  return { amount: Number(plain[1].replace(',', '.')), currency };
}

function normalizeHour(hour, meridiem) {
  let h = Number(hour);
  if (meridiem?.toLowerCase() === 'pm' && h < 12) h += 12;
  if (meridiem?.toLowerCase() === 'am' && h === 12) h = 0;
  return String(h).padStart(2, '0');
}

function extractHours(text) {
  const range = text.match(/\b(?:saat\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:-|–|ile|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (range) {
    const meridiem = range[5] ?? null;
    return {
      start_time: `${normalizeHour(range[1], meridiem)}:${range[2] ?? '00'}`,
      end_time: `${normalizeHour(range[3], meridiem)}:${range[4] ?? '00'}`,
      duration_hours: null,
    };
  }
  const duration = text.match(/\b(\d+(?:[.,]\d+)?)\s*saat\b/i);
  return { start_time: null, end_time: null, duration_hours: duration ? Number(duration[1].replace(',', '.')) : null };
}

function routeFor(intent) {
  switch (intent) {
    case 'NEED_HELP': return 'need_agent';
    case 'EARN': return 'earn_agent';
    case 'MONEY_MISSION':
    case 'SAVE_MONEY': return 'money_agent';
    case 'PLAN_LIFE':
    case 'WHAT_IF': return 'planner_agent';
    case 'RELATIONSHIP_MATCH': return 'match_agent';
    case 'OPPORTUNITY': return 'opportunity_agent';
    case 'SUPPORT': return 'support_agent';
    default: return 'human_review';
  }
}

export function routeIntent(rawText) {
  const text = String(rawText ?? '').trim();
  const lower = text.toLocaleLowerCase('tr-TR');
  const money = extractAmount(text);
  const hours = extractHours(text);

  let primary_intent = 'NEED_HELP';
  let confidence = 0.72;

  if (!text) {
    primary_intent = 'UNKNOWN'; confidence = 0.2;
  } else if (any(lower, relationshipPatterns)) {
    primary_intent = 'RELATIONSHIP_MATCH'; confidence = 0.94;
  } else if (any(lower, whatIfPatterns)) {
    primary_intent = 'WHAT_IF'; confidence = 0.92;
  } else if (any(lower, savePatterns)) {
    primary_intent = 'SAVE_MONEY'; confidence = 0.91;
  } else if (any(lower, supportPatterns)) {
    primary_intent = 'SUPPORT'; confidence = 0.90;
  } else if (any(lower, earnPatterns)) {
    primary_intent = 'EARN'; confidence = 0.91;
  } else if (money.amount !== null && any(lower, moneyMissionPatterns) && (/cuma|hafta|kadar|by\b/i.test(lower) || /find me|bana.*bul/i.test(lower)) && !/yard[ıi]m|bak[ıi]c[ıi]|taş[ıi]|tasi|temiz|tamir|market|köpek|kopek/i.test(lower)) {
    primary_intent = 'MONEY_MISSION'; confidence = 0.90;
  } else if (any(lower, planPatterns)) {
    primary_intent = 'PLAN_LIFE'; confidence = 0.86;
  }

  const risk_flags = [];
  if (/silah|weapon|uyuşturucu|uyusturucu|illegal/i.test(lower)) risk_flags.push('HIGH_RISK_REQUEST');
  if (/kad[ıi]n laz[ıi]m|erkek laz[ıi]m/i.test(lower)) risk_flags.push('POTENTIAL_EMPLOYMENT_DISCRIMINATION');
  if (primary_intent === 'RELATIONSHIP_MATCH') risk_flags.push('SENSITIVE_MATCHING_DATA');

  return {
    primary_intent,
    confidence,
    entities: {
      amount: money.amount,
      currency: money.currency,
      start_time: hours.start_time,
      end_time: hours.end_time,
      location_text: null,
      task: primary_intent === 'UNKNOWN' ? null : text,
      duration_hours: hours.duration_hours,
    },
    risk_flags,
    route: routeFor(primary_intent),
  };
}
