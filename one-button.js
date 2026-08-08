import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
const hashToken=t=>createHash('sha256').update(t).digest('hex');
export function hashPassword(password){if(typeof password!=='string'||password.length<10)throw new Error('WEAK_PASSWORD');const salt=randomBytes(16).toString('hex');const hash=scryptSync(password,salt,64).toString('hex');return `scrypt$${salt}$${hash}`;}
export function verifyPassword(password,stored){try{const [,salt,hex]=stored.split('$');const got=scryptSync(password,salt,64);return timingSafeEqual(got,Buffer.from(hex,'hex'));}catch{return false;}}
export class AuthService{
 constructor(store){this.store=store;}
 register(input){if(!input.email)throw new Error('EMAIL_REQUIRED');if(this.store.findUserByEmail(input.email))throw new Error('EMAIL_EXISTS');const user=this.store.createUser(input);this.store.saveCredential(user.id,hashPassword(input.password));return {user,...this.issue(user.id)};}
 login(email,password){const user=this.store.findUserByEmail(email);if(!user||!verifyPassword(password,this.store.getCredential(user.id)))throw new Error('INVALID_CREDENTIALS');return {user,...this.issue(user.id)};}
 issue(userId){const token=randomBytes(32).toString('base64url');const expires_at=new Date(Date.now()+7*864e5).toISOString();this.store.saveSession(hashToken(token),userId,expires_at);return {token,expires_at};}
 authenticate(token){if(!token)return null;const s=this.store.getSession(hashToken(token));if(!s||Date.parse(s.expires_at)<=Date.now())return null;return this.store.getUser(s.user_id);}
}
