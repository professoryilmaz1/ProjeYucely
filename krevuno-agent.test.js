import test from 'node:test';
import assert from 'node:assert/strict';

function detectIntent(text=''){
  const t=String(text).toLowerCase();
  if(/\b(need|help|hire|worker|someone|lazım|yardım|eleman|ihtiyacım)\b/.test(t))return 'NEED_HELP';
  if(/\b(earn|job|work|income|money|para|kazan|iş|çalış|shift|gig|remote)\b/.test(t)||/\$\s*\d/.test(t))return 'EARN';
  if(/\b(save|budget|expense|spend|tasarruf|bütçe|harcama)\b/.test(t))return 'MONEY';
  if(/\b(match|partner|mentor|friend|eş|arkadaş|ortak)\b/.test(t))return 'MATCH';
  return 'PLAN';
}
function extractAmount(text=''){
  const m=String(text).replace(/,/g,'').match(/(?:\$|usd\s*)?(\d+(?:\.\d{1,2})?)/i);
  return m?Number(m[1]):null;
}

test('agent routes earning requests',()=>assert.equal(detectIntent('I want to earn $500 this week'),'EARN'));
test('agent routes help requests',()=>assert.equal(detectIntent('I need someone to help me tomorrow'),'NEED_HELP'));
test('agent routes money planning',()=>assert.equal(detectIntent('help me reduce my budget'),'MONEY'));
test('agent routes mutual matching',()=>assert.equal(detectIntent('find a business partner'),'MATCH'));
test('agent defaults to planning',()=>assert.equal(detectIntent('organize my day'),'PLAN'));
test('agent extracts dollar amounts',()=>assert.equal(extractAmount('I need $1,250 by Friday'),1250));
test('agent extracts decimal amounts',()=>assert.equal(extractAmount('earn 75.50'),75.5));
