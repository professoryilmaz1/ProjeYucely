export class RateLimiter{
 constructor({windowMs=60000,max=120}={}){this.windowMs=windowMs;this.max=max;this.buckets=new Map();}
 check(key){const now=Date.now();let b=this.buckets.get(key);if(!b||now-b.start>=this.windowMs)b={start:now,count:0};b.count++;this.buckets.set(key,b);return {allowed:b.count<=this.max,remaining:Math.max(0,this.max-b.count),reset_ms:Math.max(0,this.windowMs-(now-b.start))};}
}
export function bearer(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):null;}
export function sameUserOrThrow(actor,userId){if(!actor||actor.id!==userId)throw new Error('FORBIDDEN');}
