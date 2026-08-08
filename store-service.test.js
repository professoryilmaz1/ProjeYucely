import { calculateBudget } from './life-finance.js';

const n=(v)=>{const x=Number(v);return Number.isFinite(x)?x:0;};

export function buildSavePlan({target_amount=0,budget={}}={}){
  const target=Math.max(0,n(target_amount));
  const b=budget.balance===undefined?calculateBudget(budget):budget;
  const ranked=[...(b.expenses??[])].sort((a,b)=>n(b.amount)-n(a.amount));
  let remaining=target;
  const actions=[];
  for(const exp of ranked){
    if(remaining<=0) break;
    const cap=Math.max(0,n(exp.amount)*0.25);
    if(cap<=0) continue;
    const save=Math.min(cap,remaining);
    actions.push({expense:exp.name,category:exp.category??'other',current_amount:n(exp.amount),suggested_reduction:Number(save.toFixed(2)),new_target_amount:Number((n(exp.amount)-save).toFixed(2))});
    remaining-=save;
  }
  const projected=Math.max(0,target-remaining);
  return {target_amount:target,projected_savings:Number(projected.toFixed(2)),target_met:remaining<=0,remaining_gap:Number(Math.max(0,remaining).toFixed(2)),actions};
}

export function simulateWhatIf({budget={},scenario={}}={}){
  const base=budget.balance===undefined?calculateBudget(budget):budget;
  const incomeDelta=n(scenario.monthly_income_delta);
  const expenseDelta=n(scenario.monthly_expense_delta);
  const oneTimeCost=n(scenario.one_time_cost);
  const oneTimeIncome=n(scenario.one_time_income);
  const newMonthlyIncome=n(base.monthly_income)+incomeDelta;
  const newMonthlyExpenses=n(base.total_expenses)+expenseDelta;
  const monthlyBalance=newMonthlyIncome-newMonthlyExpenses;
  const firstMonthBalance=monthlyBalance+oneTimeIncome-oneTimeCost;
  return {
    base:{monthly_income:n(base.monthly_income),total_expenses:n(base.total_expenses),balance:n(base.balance)},
    scenario:{monthly_income_delta:incomeDelta,monthly_expense_delta:expenseDelta,one_time_cost:oneTimeCost,one_time_income:oneTimeIncome,label:scenario.label??null},
    result:{monthly_income:newMonthlyIncome,total_expenses:newMonthlyExpenses,monthly_balance:monthlyBalance,first_month_balance:firstMonthBalance,monthly_change:monthlyBalance-n(base.balance),status:monthlyBalance<0?'DEFICIT':monthlyBalance<Math.max(100,newMonthlyIncome*0.1)?'TIGHT':'POSITIVE'}
  };
}

export function fixMyDay({dashboard={},budget={},opportunities=[]}={}){
  const b=budget.balance===undefined?calculateBudget(budget):budget;
  const actions=[];
  if(n(b.balance)<0){
    actions.push({priority:100,type:'EARN',title:'Close today\'s money gap',action:'FIND_EARNING_OPPORTUNITIES',reason:`Monthly projected gap is $${Math.abs(n(b.balance)).toFixed(2)}.`});
  }
  const best=[...(opportunities??[])].sort((a,b)=>n(b.net_amount)-n(a.net_amount))[0];
  if(best) actions.push({priority:90,type:'EARN',title:`Earn $${n(best.net_amount).toFixed(0)}`,action:'OPEN_OPPORTUNITY',opportunity_id:best.id??null,reason:'Best currently available earning option.'});
  const openNeeds=n(dashboard.metrics?.open_needs);
  if(openNeeds>0) actions.push({priority:80,type:'NEED',title:'Resolve an open need',action:'REVIEW_NEEDS',reason:`${openNeeds} open need(s) are waiting.`});
  const slots=n(dashboard.metrics?.availability_slots);
  if(slots===0) actions.push({priority:70,type:'TIME',title:'Add your free time',action:'ADD_AVAILABILITY',reason:'No availability is recorded, so the system cannot optimize earning time.'});
  if(actions.length<3) actions.push({priority:50,type:'LIFE',title:'Protect the day',action:'PLAN_TOP_TASK',reason:'Choose one important task and reserve a focused block for it.'});
  if(actions.length<3) actions.push({priority:40,type:'MONEY',title:'Protect cash flow',action:'REVIEW_SPENDING',reason:`Projected monthly balance is $${n(b.balance).toFixed(2)}.`});
  return {status:'DAY_PLAN_READY',actions:actions.sort((a,b)=>b.priority-a.priority).slice(0,3)};
}
