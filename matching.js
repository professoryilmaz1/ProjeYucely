function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }
export function calculateBudget(input={}){
 const monthlyIncome=n(input.monthly_income); const expenses=(input.expenses??[]).map(x=>({name:String(x.name??'Expense'),amount:n(x.amount),category:x.category??'other'}));
 const totalExpenses=expenses.reduce((s,x)=>s+x.amount,0); const balance=monthlyIncome-totalExpenses; const savingsRate=monthlyIncome>0?balance/monthlyIncome:0;
 return {monthly_income:monthlyIncome,total_expenses:totalExpenses,balance,savings_rate:Number(savingsRate.toFixed(4)),status:balance<0?'DEFICIT':savingsRate<0.1?'TIGHT':'POSITIVE',expenses};
}
export function buildDaily3({budget={},dashboard={}}={}){
 const out=[]; const deficit=n(budget.balance)<0; const openNeeds=n(dashboard.metrics?.open_needs); const slots=n(dashboard.metrics?.availability_slots);
 if(deficit) out.push({type:'EARN',priority:100,title:'Close the monthly gap',reason:`Budget gap is $${Math.abs(n(budget.balance)).toFixed(2)}.`,action:'BUILD_MONEY_MISSION'});
 else out.push({type:'MONEY',priority:80,title:'Protect positive cash flow',reason:`Current projected balance is $${n(budget.balance).toFixed(2)}.`,action:'KEEP_RESERVE'});
 if(slots===0) out.push({type:'TIME',priority:70,title:'Add availability',reason:'No earning availability is recorded.',action:'ADD_AVAILABILITY'});
 else out.push({type:'EARN',priority:65,title:'Use open time',reason:`${slots} availability slot(s) can be matched to opportunities.`,action:'FIND_MATCHES'});
 if(openNeeds>0) out.push({type:'LIFE',priority:60,title:'Resolve an open need',reason:`You have ${openNeeds} open need(s).`,action:'REVIEW_NEEDS'});
 else out.push({type:'LIFE',priority:50,title:'Plan one important task',reason:'No open need is blocking the day.',action:'PLAN_DAY'});
 return out.sort((a,b)=>b.priority-a.priority).slice(0,3);
}
export function calculateCfo(input={}){
 const revenue=n(input.revenue); const operating=n(input.operating_costs); const payouts=n(input.payouts); const refunds=n(input.refunds); const fraud=n(input.fraud_losses); const taxRate=Math.min(1,Math.max(0,n(input.tax_rate??0.25))); const activeUsers=Math.max(0,n(input.active_users));
 const preTax=Math.max(0,revenue-operating-payouts-refunds-fraud); const taxReserve=preTax*taxRate; const afterTax=preTax-taxReserve; const reserveTarget=afterTax*0.30; const distributable=Math.max(0,afterTax-reserveTarget); const netPerUser=activeUsers?afterTax/activeUsers:0; const netMargin=revenue?afterTax/revenue:0; const costBase=operating+payouts+refunds+fraud+taxReserve; const profitPerDollarSpent=costBase?afterTax/costBase:0;
 const alerts=[]; if(activeUsers&&netPerUser<0.75)alerts.push({code:'LOW_NET_PER_USER',severity:'HIGH',message:'After-tax net profit per active user is below $0.75.'}); if(revenue>0&&afterTax<=0)alerts.push({code:'NO_POSITIVE_PROFIT',severity:'CRITICAL',message:'Positive after-tax profit is not being maintained.'});
 return {revenue,operating_costs:operating,payouts,refunds,fraud_losses:fraud,pre_tax_profit:preTax,tax_reserve:taxReserve,after_tax_net_profit:afterTax,safety_reserve_target:reserveTarget,distributable_profit:distributable,net_margin:Number(netMargin.toFixed(4)),net_profit_per_active_user:Number(netPerUser.toFixed(4)),profit_per_dollar_spent:Number(profitPerDollarSpent.toFixed(4)),growth_gate:alerts.length?'SLOW_OR_REVIEW':'ALLOW',alerts};
}
