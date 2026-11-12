const encoder = new TextEncoder();
export const normalizeEmail = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
export const googleMode = env => !!(env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET || env.OWNER_EMAIL);
export const googleReady = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.OWNER_EMAIL);
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const digest = async text => base64url(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
function readCookie(request,name) { return (request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)||''; }
function setCookie(request,name,value,seconds,sameSite='Lax') {
  return `${name}=${value}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
export async function googleSession(request,env) {
  if(!googleReady(env))return null;
  const token=readCookie(request,'google_session');
  if(!token || token.length>100)return null;
  const row=await env.DB.prepare('SELECT email FROM sessions WHERE token_hash=? AND expires_at>?').bind(await digest(token),Date.now()).first();
  if(!row)return null;
  if(row.email===normalizeEmail(env.OWNER_EMAIL))return {email:row.email,role:'owner'};
  if(await env.DB.prepare('SELECT email FROM admins WHERE email=?').bind(row.email).first())return {email:row.email,role:'admin'};
  return null;
}
export async function googleLogout(request,env) {
  const token=readCookie(request,'google_session');
  if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  return setCookie(request,'google_session','',0,'Strict');
}
function redirect(location,cookies=[]) {
  const headers=new Headers({'Location':location,'Cache-Control':'no-store'});
  for(const c of cookies)headers.append('Set-Cookie',c);
  return new Response(null,{status:302,headers});
}
// Authorization code flow + PKCE + a short-lived HttpOnly state cookie.
// Google userinfo is fetched server-side over HTTPS; no Google tokens are sent to browser JS or stored.
export async function googleRoute(request,env,url,fetchGoogle=fetch) {
  if(!googleReady(env))return new Response(JSON.stringify({error:'Google prijava još nije postavljena. Slijedite upute za Google prijavu.'}),{status:503,headers:{'Content-Type':'application/json'}});
  const callback=`${url.origin}/api/auth/google/callback`;
  if(url.pathname==='/api/auth/google/start') {
    const state=random(),verifier=random();
    const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:'openid email',state,
      code_challenge:await digest(verifier),code_challenge_method:'S256',prompt:'select_account'}).toString();
    return redirect(auth.toString(),[setCookie(request,'google_oauth',`${state}.${verifier}.${Date.now()+600000}`,600)]);
  }
  if(url.pathname!=='/api/auth/google/callback')return new Response(null,{status:404});
  const clear=setCookie(request,'google_oauth','',0);
  const error=message=>redirect(`/#administracija?greska=${encodeURIComponent(message)}`,[clear]);
  const [expected,verifier,expires]=readCookie(request,'google_oauth').split('.');
  if(!expected || !verifier || !expires || !/^\d+$/.test(expires) || Number(expires)<Date.now() || url.searchParams.get('state')!==expected)return error('Prijava je istekla ili nije valjana. Pokušajte ponovno.');
  if(url.searchParams.has('error'))return error('Google prijava je prekinuta.');
  const code=url.searchParams.get('code');
  if(!code || code.length>4096)return error('Google nije vratio valjanu potvrdu prijave.');
  try {
    const tokenResponse=await fetchGoogle('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:callback,grant_type:'authorization_code',code,code_verifier:verifier}),signal:AbortSignal.timeout(15000)});
    if(!tokenResponse.ok)return error('Google prijava nije uspjela. Provjerite OAuth postavke.');
    const tokens=await tokenResponse.json();
    if(typeof tokens.access_token!=='string')return error('Google nije vratio potvrdu identiteta.');
    const profileResponse=await fetchGoogle('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!profileResponse.ok)return error('Nije moguće provjeriti Google račun.');
    const profile=await profileResponse.json(),email=normalizeEmail(profile.email);
    if(profile.email_verified!==true || !email || typeof profile.sub!=='string' || !profile.sub)return error('Potreban je Google račun s potvrđenom e-mail adresom.');
    const owner=email===normalizeEmail(env.OWNER_EMAIL);
    if(!owner) {
      // Bind the permitted address to a stable Google subject at first successful login.
      const admin=await env.DB.prepare('SELECT * FROM admins WHERE email=?').bind(email).first();
      if(!admin || (admin.google_sub && admin.google_sub!==profile.sub))return error('Ovaj račun nema administratorski pristup. Obratite se vlasniku.');
      await env.DB.prepare('UPDATE admins SET google_sub=? WHERE email=? AND (google_sub IS NULL OR google_sub=?)').bind(profile.sub,email,profile.sub).run();
    }
    const token=random();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),
      env.DB.prepare('INSERT INTO sessions(token_hash,email,expires_at) VALUES (?,?,?)').bind(await digest(token),email,Date.now()+8*3600000),
      env.DB.prepare('INSERT INTO audit(action,record_id,detail,actor) VALUES (?,?,?,?)').bind('login',email,'{}',email)
    ]);
    return redirect('/#administracija',[clear,setCookie(request,'google_session',token,8*3600,'Strict')]);
  } catch { return error('Prijava trenutačno nije dostupna. Pokušajte ponovno.'); }
}
