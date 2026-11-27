export const CATEGORIES = {
  upper_m: 'Muškarci · Superliga, 1. B i prve inozemne lige',
  women: 'Žene',
  league_m: 'Muškarci · 2.–4. HKS te 2. i 3. inozemna liga',
  recreation_m: 'Muškarci · neregistrirani (rekreativci)'
};
export const START = '2026-11-25';
export const END = '2026-12-29';
export const participantKey = (name,category) => `${String(name).normalize('NFKC').trim().toLocaleLowerCase('hr').replace(/\s+/g,' ')}|${category}`;
export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day && day >= START && day <= END;
}
export function zagrebNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function upcoming(day, hour, now = zagrebNow()) {
  return `${day}T${String(hour).padStart(2,'0')}:00` > now;
}
export function scheduleDays(from, to, weekdays) {
  if (!validDay(from) || !validDay(to) || from > to || !Array.isArray(weekdays) || !weekdays.length || weekdays.some(n => !Number.isInteger(n) || n < 0 || n > 6)) throw new Error('Provjerite datume i dane u tjednu.');
  const out = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0,10) <= to; d.setUTCDate(d.getUTCDate()+1)) {
    const key = d.toISOString().slice(0,10);
    if (weekdays.includes(d.getUTCDay()) && !['2026-12-24','2026-12-25'].includes(key)) out.push(key);
  }
  return out;
}
export const compareResults = (a,b) => (b.total??-1)-(a.total??-1) || (b.cleaning??-1)-(a.cleaning??-1) || (a.misses??Infinity)-(b.misses??Infinity) || 0;
const rankingScore = p => p.total===null ? [...p.performances].sort(compareResults)[0] : {total:p.total,cleaning:p.bestCleaning,misses:p.bestMisses};
const compareRankings = (a,b) => Number(b.total!==null)-Number(a.total!==null) || compareResults(rankingScore(a),rankingScore(b));
export function rankResults(rows) {
  const people = new Map();
  for (const row of rows) {
    const key=participantKey(row.name,row.category);
    if (!people.has(key)) people.set(key, { id: row.participant_id, name: row.name, club: row.club, category: row.category, scores: [], performances: [] });
    const total=row.total ?? (row.s1 + row.s2 + row.s3 + row.s4);
    people.get(key).scores.push(total);
    people.get(key).performances.push({booking_id:row.booking_id,day:row.day,hour:row.hour,lane:row.lane,total,cleaning:row.cleaning??null,misses:row.misses??null});
  }
  const result = [];
  for (const category of Object.keys(CATEGORIES)) {
    const group = [...people.values()].filter(p => p.category === category).map(p => {
      p.scores.sort((a,b) => b-a);
      p.performances.sort((a,b)=>String(a.day||'').localeCompare(String(b.day||'')) || (a.hour??0)-(b.hour??0) || (a.booking_id??0)-(b.booking_id??0));
      const selected=new Set(p.performances.map((performance,index)=>({performance,index})).sort((a,b)=>compareResults(a.performance,b.performance) || a.index-b.index).slice(0,2).map(item=>item.index));
      const performances=p.performances.map((performance,index)=>({...performance,number:index+1,counted:p.scores.length>=2&&selected.has(index)}));
      const bestPerformances=performances.filter(performance=>performance.counted);
      const sum=field=>bestPerformances.length===2&&bestPerformances.every(performance=>performance[field]!==null)?bestPerformances.reduce((total,performance)=>total+performance[field],0):null;
      return { ...p, performances, count: p.scores.length, best: p.scores.slice(0,2), total: p.scores.length >= 2 ? p.scores[0]+p.scores[1] : null, bestCleaning:sum('cleaning'), bestMisses:sum('misses') };
    }).sort((a,b) => compareRankings(a,b) || a.name.localeCompare(b.name, 'hr'));
    let previous, position;
    group.forEach((p, i) => {
      if (!previous || compareRankings(p,previous)!==0) position = i+1;
      previous = p;
      result.push({ ...p, position: p.total === null ? null : position });
    });
  }
  const overall=[...result].sort((a,b)=>compareRankings(a,b)||a.name.localeCompare(b.name,'hr'));
  let previousTotal,overallPosition;
  const positions=new Map();
  overall.forEach((p,index)=>{
    if(!previousTotal || compareRankings(p,previousTotal)!==0)overallPosition=index+1;
    previousTotal=p;
    positions.set(p.id,p.total===null?null:overallPosition);
  });
  return result.map(p=>({...p,overallPosition:positions.get(p.id)}));
}
