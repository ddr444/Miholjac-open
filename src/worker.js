import { CATEGORIES, START, END, validDay, zagrebNow, upcoming, scheduleDays, rankResults } from './domain.js';
import { googleMode, googleReady, googleSession, googleRoute, googleLogout, normalizeEmail } from './google-auth.js';
import { buildStatistics, completedOrdinals } from './statistics.js';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
const str = (v, max, required = true) => {
  if (typeof v !== 'string' || v.trim().length > max || (required && !v.trim())) fail(400, 'Provjerite obvezna polja i duljinu unosa.');
  return v.trim();
};
const num = (v, min, max) => { if (!Number.isInteger(v) || v < min || v > max) fail(400, 'Neispravan broj.'); return v; };
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');
const hash = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
async function sign(text, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
async function equal(a, b) {
  const [x,y] = await Promise.all([hash(a),hash(b)]);
  let difference = 0; for (let i=0;i<x.length;i++) difference |= x.charCodeAt(i)^y.charCodeAt(i);
  return difference === 0;
}
async function identity(request, env) {
  if (googleMode(env)) return googleSession(request,env);
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) return false;
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1] || '';
  const [expiry, nonce, signature] = cookie.split('.');
  if (!expiry || !nonce || !signature || !/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  return await equal(signature, await sign(`${expiry}.${nonce}`, env.ADMIN_PASSWORD)) ? {email:'shared-password',role:'owner'} : null;
}
function cookie(request, value, age) {
  return `admin_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415,'Očekuje se JSON.');
  const text = await request.text();
  if (text.length > 12000) fail(413,'Prevelik zahtjev.');
  try { return JSON.parse(text); } catch { fail(400,'Neispravan zahtjev.'); }
}
async function throttle(request, env, kind, maximum) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const key = await hash(`${kind}:${ip}`);
  const now = Date.now();
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,count,reset_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,
    reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END RETURNING count`).bind(key,now+15*60*1000,now,now).first();
  if (row.count > maximum) fail(429,'Previše pokušaja. Pokušajte ponovno za 15 minuta.');
  await env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now-86400000).run();
}
const audit = (env, action, id, detail) => env.DB.prepare('INSERT INTO audit(action,record_id,detail,actor) VALUES (?,?,?,?)').bind(action,String(id),JSON.stringify(detail),env.actor||'shared-password');
async function categoryChange(env,id,category) {
  if(!Object.hasOwn(CATEGORIES,category))fail(400,'Odaberite kategoriju.');
  const p=await env.DB.prepare('SELECT * FROM participants WHERE id=?').bind(id).first();
  if(!p)fail(404,'Natjecatelj nije pronađen.');
  const key=await hash([p.name.toLocaleLowerCase('hr').replace(/\s+/g,' '),p.contact.toLowerCase().replace(/\s+/g,''),category].join('|'));
  const duplicate=await env.DB.prepare('SELECT id FROM participants WHERE identity_key=? AND id<>?').bind(key,id).first();
  if(duplicate)fail(409,'Natjecatelj već postoji u toj kategoriji. Potrebno je objediniti njegove zapise prije promjene.');
  return [env.DB.prepare('UPDATE participants SET division=?,division_review=0,identity_key=? WHERE id=?').bind(category,key,id),audit(env,'category',id,{from:p.division,to:category})];
}
const allResults = async env => (await env.DB.prepare(`SELECT b.id AS booking_id, p.id AS participant_id, p.name,p.club,p.division AS category,s.day,s.hour,b.lane,
  r.total,r.cleaning,r.misses FROM results r JOIN bookings b ON b.id=r.booking_id JOIN participants p ON p.id=b.participant_id
  JOIN slots s ON s.id=b.slot_id WHERE b.cancelled=0 ORDER BY s.day DESC,s.hour DESC,b.lane`).all()).results;

async function api(request, env, url) {
  const path = url.pathname, method = request.method;
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) fail(403,'Zahtjev s druge stranice nije dopušten.');
  }
  if (!env.DB) fail(503,'Baza nije povezana. Slijedite upute za objavu.');
  if (path === '/api/config' && method === 'GET') return json({ title:'3. MIHOLJAC OPEN 2026.', start:START, end:END, categories:CATEGORIES, now:zagrebNow(), demo: env.APP_MODE === 'demo' });
  if (path.startsWith('/api/auth/google/') && method === 'GET') {
    await throttle(request,env,'google-login',30);
    return googleRoute(request,env,url);
  }
  if (path === '/api/session' && method === 'GET') {
    const user=await identity(request,env);
    return json({ authenticated:!!user,email:user?.email,role:user?.role,authMode:googleMode(env)?'google':'password',googleReady:googleReady(env) });
  }
  if (path === '/api/login' && method === 'POST') {
    if (googleMode(env)) fail(403,'Koristite prijavu Google računom.');
    await throttle(request,env,'login',8);
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) fail(503,'Administrator još nije postavio lozinku od najmanje 16 znakova.');
    const b = await body(request);
    if (typeof b.password !== 'string' || b.password.length > 256 || !await equal(b.password,env.ADMIN_PASSWORD)) fail(401,'Pogrešna lozinka.');
    const payload = `${Date.now()+8*3600000}.${crypto.randomUUID()}`;
    return json({ ok:true },200, { 'Set-Cookie':cookie(request,`${payload}.${await sign(payload,env.ADMIN_PASSWORD)}`,8*3600) });
  }
  if (path === '/api/logout' && method === 'POST') {
    const response=json({ok:true},200,{'Set-Cookie':cookie(request,'',0)});
    response.headers.append('Set-Cookie',await googleLogout(request,env));
    return response;
  }
  if (path === '/api/slots' && method === 'GET') {
    const day = url.searchParams.get('date');
    if (!validDay(day)) fail(400,'Datum je izvan kvalifikacijskog razdoblja.');
    const rows = (await env.DB.prepare(`SELECT s.id,s.day,s.hour,s.closed,b.lane,p.name,p.club FROM slots s LEFT JOIN bookings b ON b.slot_id=s.id AND b.cancelled=0 LEFT JOIN participants p ON p.id=b.participant_id WHERE s.day=? ORDER BY s.hour,b.lane`).bind(day).all()).results;
    const slots = new Map();
    for (const row of rows) {
      if (!slots.has(row.id)) slots.set(row.id,{ id:row.id, day:row.day, hour:row.hour, closed:!!row.closed, past:!upcoming(row.day,row.hour), taken:[], reservations:[] });
      if (row.lane) {
        slots.get(row.id).taken.push(row.lane);
        slots.get(row.id).reservations.push({lane:row.lane,name:row.name,club:row.club});
      }
    }
    return json([...slots.values()]);
  }
  if (path === '/api/standings' && method === 'GET') return json(rankResults(await allResults(env)));
  if (path === '/api/results' && method === 'GET') return json(await allResults(env));
  if (path === '/api/book' && method === 'POST') {
    await throttle(request,env,'booking',12);
    const b = await body(request);
    if (b.website) fail(400,'Prijava nije prihvaćena.');
    const name = str(b.name,100), club = str(b.club,100,false), contact = str(b.contact,40), category = str(b.category,30);
    const phoneDigits=contact.replace(/\D/g,'');
    if(!/^\+?[0-9][0-9 ()/.\-]*$/.test(contact) || phoneDigits.length<7 || phoneDigits.length>15) fail(400,'Unesite valjan broj telefona (7–15 znamenki), primjerice 091 123 4567 ili +385 91 123 4567.');
    if (!Object.hasOwn(CATEGORIES,category)) fail(400,'Odaberite kategoriju.');
    const slotId = num(b.slotId,1,2147483647), lane = num(b.lane,1,4);
    const slot = await env.DB.prepare('SELECT * FROM slots WHERE id=?').bind(slotId).first();
    if (!slot || slot.closed || !upcoming(slot.day,slot.hour)) fail(409,'Termin više nije dostupan.');
    const identityFor=categoryKey=>hash([name.toLocaleLowerCase('hr').replace(/\s+/g,' '),contact.toLowerCase().replace(/\s+/g,''),categoryKey].join('|'));
    let identity=await identityFor(category);
    const legacyCategories=category==='women'?['registered_f','recreation_f']:category==='recreation_m'?['recreation_m']:['registered_m'];
    const keys=[identity,...await Promise.all(legacyCategories.map(identityFor))];
    const existing=await env.DB.prepare(`SELECT identity_key FROM participants WHERE division=? AND identity_key IN (${keys.map(()=>'?').join(',')}) ORDER BY id LIMIT 1`).bind(category,...keys).first();
    if(existing)identity=existing.identity_key;
    const token = crypto.randomUUID()+crypto.randomUUID();
    const tokenHash = await hash(token);
    try {
      const batch = await env.DB.batch([
        env.DB.prepare('INSERT INTO participants(identity_key,name,club,category,contact,division) VALUES (?,?,?,?,?,?) ON CONFLICT(identity_key) DO NOTHING').bind(identity,name,club,category==='women'?'registered_f':category==='recreation_m'?'recreation_m':'registered_m',contact,category),
        env.DB.prepare(`INSERT INTO bookings(slot_id,lane,participant_id,token_hash)
          SELECT s.id,?,p.id,? FROM slots s,participants p WHERE s.id=? AND s.closed=0 AND p.identity_key=?
          AND s.day || 'T' || printf('%02d',s.hour) || ':00' > ?`).bind(lane,tokenHash,slotId,identity,zagrebNow())
      ]);
      if (!batch[1].meta.changes) fail(409,'Termin je zatvoren. Odaberite drugi.');
    } catch(e) {
      if (/UNIQUE|constraint/i.test(e.message)) fail(409,'Staza je već rezervirana ili već imate nastup u tom terminu. Osvježite prikaz.');
      throw e;
    }
    return json({ ok:true, token, day:slot.day, hour:slot.hour, lane },201);
  }
  if (path === '/api/cancel' && method === 'POST') {
    await throttle(request,env,'cancel',20);
    const b = await body(request), tokenHash = await hash(str(b.token,100));
    const result = await env.DB.prepare(`UPDATE bookings SET cancelled=1 WHERE token_hash=? AND cancelled=0
      AND NOT EXISTS(SELECT 1 FROM results WHERE booking_id=bookings.id)
      AND slot_id IN (SELECT id FROM slots WHERE day || 'T' || printf('%02d',hour) || ':00' > ?)`)
      .bind(tokenHash,zagrebNow()).run();
    if (!result.meta.changes) fail(409,'Rezervacija nije pronađena, već je otkazana ili je nastup počeo. Obratite se organizatoru.');
    return json({ ok:true });
  }
  if (!path.startsWith('/api/admin/')) fail(404,'Nepoznata adresa.');
  const user=await identity(request,env);
  if (!user) fail(401,'Prijavite se kao administrator.');
  env={...env,actor:user.email};
  if (path === '/api/admin/users' && method === 'GET') {
    if(user.role!=='owner')fail(403,'Samo vlasnik može upravljati administratorima.');
    if(!googleReady(env))return json({owner:null,admins:[],configured:false});
    return json({owner:normalizeEmail(env.OWNER_EMAIL),admins:(await env.DB.prepare('SELECT email,added_at FROM admins ORDER BY email').all()).results,configured:true});
  }
  if (path === '/api/admin/users' && method === 'POST') {
    if(user.role!=='owner')fail(403,'Samo vlasnik može upravljati administratorima.');
    if(!googleReady(env))fail(409,'Najprije postavite Google prijavu.');
    const b=await body(request),email=normalizeEmail(str(b.email,254));
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Upišite valjanu e-mail adresu Google računa.');
    if(email===normalizeEmail(env.OWNER_EMAIL))fail(400,'Vlasnik se postavlja u konfiguraciji i ne može se ukloniti ovdje.');
    if(!['add','remove'].includes(b.action))fail(400,'Nepoznata radnja.');
    const statements=b.action==='add'?[env.DB.prepare('INSERT INTO admins(email) VALUES (?) ON CONFLICT(email) DO NOTHING').bind(email)]
      :[env.DB.prepare('DELETE FROM admins WHERE email=?').bind(email),env.DB.prepare('DELETE FROM sessions WHERE email=?').bind(email)];
    await env.DB.batch([...statements,audit(env,`admin-${b.action}`,email,{})]);
    return json({ok:true});
  }
  if (path === '/api/admin/bookings' && method === 'GET') {
    const day = url.searchParams.get('date');
    if (!validDay(day)) fail(400,'Provjerite datum.');
    const rows = (await env.DB.prepare(`SELECT b.id,b.slot_id,b.lane,b.paid,p.id AS participant_id,p.name,p.club,p.division AS category,p.division_review,p.contact,s.day,s.hour,
      r.total,r.cleaning,r.misses FROM bookings b JOIN participants p ON p.id=b.participant_id JOIN slots s ON s.id=b.slot_id
      LEFT JOIN results r ON r.booking_id=b.id WHERE s.day=? AND b.cancelled=0 ORDER BY s.hour,b.lane`).bind(day).all()).results;
    const completed = await allResults(env);
    const ordinals = completedOrdinals(completed);
    return json(rows.map(r=>({...r,ordinal:ordinals.get(r.id)||null,free:!!ordinals.get(r.id)&&ordinals.get(r.id)%5===0})));
  }
  if (path === '/api/admin/statistics' && method === 'GET') {
    const rows=(await env.DB.prepare(`SELECT s.id AS slot_id,s.day,s.hour,s.closed,b.id AS booking_id,b.participant_id,b.lane,p.name,p.club,r.total
      FROM slots s LEFT JOIN bookings b ON b.slot_id=s.id AND b.cancelled=0
      LEFT JOIN participants p ON p.id=b.participant_id LEFT JOIN results r ON r.booking_id=b.id
      ORDER BY s.day,s.hour,b.id`).all()).results;
    return json(buildStatistics(rows));
  }
  if (path === '/api/admin/schedule' && method === 'POST') {
    const b = await body(request);
    const first = num(b.firstHour,0,23), last = num(b.lastHour,first,23);
    let days; try { days = scheduleDays(b.from,b.to,b.weekdays); } catch(e) { fail(400,e.message); }
    if (!days.length) fail(400,'Nijedan odabrani dan nije dostupan (24. i 25. prosinca su isključeni).');
    const statements = [];
    for (const day of days) for (let hour=first;hour<=last;hour++) statements.push(env.DB.prepare('INSERT INTO slots(day,hour) VALUES (?,?) ON CONFLICT(day,hour) DO NOTHING').bind(day,hour));
    let changes=0;
    for (let i=0;i<statements.length;i+=50) for(const r of await env.DB.batch(statements.slice(i,i+50))) changes+=r.meta.changes;
    await audit(env,'schedule','range',{...b,added:changes}).run();
    return json({ok:true,added:changes});
  }
  if (path === '/api/admin/booking' && method === 'POST') {
    const b=await body(request),id=num(b.id,1,2147483647),slotId=num(b.slotId,1,2147483647),lane=num(b.lane,1,4);
    const name=str(b.name,100),club=str(b.club,100,false),contact=str(b.contact,40),category=str(b.category,30);
    const digits=contact.replace(/\D/g,'');
    if(!/^\+?[0-9][0-9 ()/.\-]*$/.test(contact)||digits.length<7||digits.length>15)fail(400,'Unesite valjan broj telefona (7–15 znamenki).');
    if(!Object.hasOwn(CATEGORIES,category)||typeof b.paid!=='boolean')fail(400,'Provjerite kategoriju i uplatu.');
    const original=await env.DB.prepare('SELECT b.*,p.name,p.club,p.contact,p.division FROM bookings b JOIN participants p ON p.id=b.participant_id WHERE b.id=? AND b.cancelled=0').bind(id).first();
    if(!original)fail(404,'Aktivna prijava nije pronađena.');
    const slot=await env.DB.prepare('SELECT * FROM slots WHERE id=?').bind(slotId).first();
    if(!slot||(slot.closed&&slotId!==original.slot_id))fail(409,'Odabrani termin je zatvoren ili ne postoji.');
    const key=await hash([name.toLocaleLowerCase('hr').replace(/\s+/g,' '),contact.toLowerCase().replace(/\s+/g,''),category].join('|'));
    if(await env.DB.prepare('SELECT id FROM participants WHERE identity_key=? AND id<>?').bind(key,original.participant_id).first())fail(409,'Drugi zapis natjecatelja već ima te podatke. Promjena nije spremljena; zapise treba objediniti.');
    try {
      const saved=await env.DB.batch([
        env.DB.prepare(`UPDATE bookings SET slot_id=COALESCE((SELECT id FROM slots WHERE id=? AND (closed=0 OR id=?)),-1),lane=?,paid=? WHERE id=? AND cancelled=0`).bind(slotId,original.slot_id,lane,Number(b.paid),id),
        env.DB.prepare(`UPDATE participants SET name=?,club=?,contact=?,division=?,division_review=0,identity_key=? WHERE id=? AND EXISTS(SELECT 1 FROM bookings WHERE id=? AND cancelled=0)`).bind(name,club,contact,category,key,original.participant_id,id),
        audit(env,'booking-edit',id,{before:{name:original.name,club:original.club,contact:original.contact,category:original.division,slotId:original.slot_id,lane:original.lane,paid:!!original.paid},after:{name,club,contact,category,slotId,lane,paid:b.paid}})
      ]);
      if(!saved[0].meta.changes)fail(409,'Prijava je u međuvremenu otkazana. Osvježite pregled.');
    }catch(e){
      if(/UNIQUE|constraint/i.test(e.message))fail(409,'Staza je zauzeta, natjecatelj već ima prijavu u tom terminu ili je termin zatvoren. Ništa nije promijenjeno.');
      throw e;
    }
    return json({ok:true,day:slot.day});
  }
  if (path === '/api/admin/slot' && method === 'POST') {
    const b = await body(request), id = num(b.id,1,2147483647);
    if (typeof b.closed !== 'boolean') fail(400,'Neispravan status.');
    const slot = await env.DB.prepare('SELECT * FROM slots WHERE id=?').bind(id).first();
    if (!slot) fail(404,'Termin nije pronađen.');
    if (!b.closed && ['2026-12-24','2026-12-25'].includes(slot.day)) fail(400,'Taj dan nema kvalifikacija.');
    await env.DB.batch([env.DB.prepare('UPDATE slots SET closed=? WHERE id=?').bind(Number(b.closed),id),audit(env,'slot',id,{closed:b.closed})]);
    return json({ok:true});
  }
  if (path === '/api/admin/category' && method === 'POST') {
    const b=await body(request),id=num(b.id,1,2147483647),category=str(b.category,30);
    await env.DB.batch(await categoryChange(env,id,category));
    return json({ok:true});
  }
  if (path === '/api/admin/result' && method === 'POST') {
    const b = await body(request), id = num(b.id,1,2147483647);
    const total=num(b.total,0,1080),cleaning=num(b.cleaning,0,total),misses=num(b.misses,0,120);
    const booking = await env.DB.prepare('SELECT b.id,b.participant_id,s.day,s.hour FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.id=? AND b.cancelled=0').bind(id).first();
    if (!booking) fail(404,'Aktivna rezervacija nije pronađena.');
    const categoryStatements=b.category===undefined?[]:await categoryChange(env,booking.participant_id,str(b.category,30));
    const saved = await env.DB.batch([env.DB.prepare(`INSERT INTO results(booking_id,total,cleaning,misses)
      SELECT id,?,?,? FROM bookings WHERE id=? AND cancelled=0
      ON CONFLICT(booking_id) DO UPDATE SET total=excluded.total,cleaning=excluded.cleaning,misses=excluded.misses,
      updated_at=CURRENT_TIMESTAMP`).bind(total,cleaning,misses,id),audit(env,'result',id,{total,cleaning,misses}),...categoryStatements]);
    if (!saved[0].meta.changes) fail(409,'Rezervacija je u međuvremenu otkazana.');
    return json({ok:true});
  }
  if (path === '/api/admin/payment' && method === 'POST') {
    const b = await body(request), id = num(b.id,1,2147483647);
    if (typeof b.paid !== 'boolean') fail(400,'Neispravan status uplate.');
    await env.DB.batch([env.DB.prepare('UPDATE bookings SET paid=? WHERE id=? AND cancelled=0').bind(Number(b.paid),id),audit(env,'payment',id,{paid:b.paid})]);
    return json({ok:true});
  }
  if (path === '/api/admin/cancel' && method === 'POST') {
    const b = await body(request), id = num(b.id,1,2147483647);
    const r = await env.DB.prepare('UPDATE bookings SET cancelled=1 WHERE id=? AND cancelled=0 AND NOT EXISTS(SELECT 1 FROM results WHERE booking_id=bookings.id)').bind(id).run();
    if (!r.meta.changes) fail(409,'Nastup s rezultatom ne može se otkazati.');
    await audit(env,'cancel',id,{}).run();
    return json({ok:true});
  }
  if (path === '/api/admin/export' && method === 'GET') {
    const tables = {};
    for (const name of ['slots','participants','bookings','results','audit']) tables[name]=(await env.DB.prepare(`SELECT * FROM ${name}`).all()).results;
    if(user.role==='owner')tables.admins=(await env.DB.prepare('SELECT email,added_at FROM admins').all()).results;
    return json({version:1,exported_at:new Date().toISOString(),tables},200,{'Content-Disposition':'attachment; filename="backup-miholjac.json"'});
  }
  fail(404,'Nepoznata adresa.');
}

export default {
  async fetch(request,env) {
    let response;
    try {
      const url = new URL(request.url);
      response = url.pathname.startsWith('/api/') ? await api(request,env,url) : await env.ASSETS.fetch(request);
    } catch(e) {
      if (!e.status) console.error('Application error:',e.message);
      response = json({ error:e.status ? e.message : 'Dogodila se pogreška na poslužitelju. Pokušajte ponovno ili obavijestite organizatora.' },e.status||500);
    }
    response = new Response(response.body,response);
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Frame-Options','DENY');
    response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return response;
  }
};
