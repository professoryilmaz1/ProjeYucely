import test from 'node:test'; import assert from 'node:assert/strict';
import { calculateBudget, buildDaily3, calculateCfo } from '../src/index.js';
test('budget detects deficit',()=>{const b=calculateBudget({monthly_income:3000,expenses:[{name:'rent',amount:2000},{name:'other',amount:1500}]});assert.equal(b.balance,-500);assert.equal(b.status,'DEFICIT');});
test('daily3 prioritizes earning when deficit',()=>{const b=calculateBudget({monthly_income:1000,expenses:[{amount:1300}]});const d=buildDaily3({budget:b,dashboard:{metrics:{availability_slots:1,open_needs:1}}});assert.equal(d.length,3);assert.equal(d[0].action,'BUILD_MONEY_MISSION');});
test('cfo protects 30 percent reserve',()=>{const c=calculateCfo({revenue:100000,operating_costs:30000,payouts:20000,tax_rate:.25,active_users:10000});assert.equal(c.after_tax_net_profit,37500);assert.equal(c.safety_reserve_target,11250);assert.equal(c.distributable_profit,26250);assert.equal(c.growth_gate,'ALLOW');});
test('cfo slows growth below net/user threshold',()=>{const c=calculateCfo({revenue:1000,operating_costs:900,tax_rate:.25,active_users:1000});assert.equal(c.growth_gate,'SLOW_OR_REVIEW');});
