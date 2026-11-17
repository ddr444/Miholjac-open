export function completedOrdinals(rows) {
  const counts=new Map(),ordinals=new Map();
  for(const row of [...rows].sort((a,b)=>a.day.localeCompare(b.day)||a.hour-b.hour||a.booking_id-b.booking_id)){
    const n=(counts.get(row.participant_id)||0)+1;
    counts.set(row.participant_id,n);ordinals.set(row.booking_id,n);
  }
  return ordinals;
}
export function buildStatistics(rows) {
  const days=new Map(),seenSlots=new Set();
  const completed=rows.filter(r=>r.booking_id!==null&&r.total!==null);
  const ordinals=completedOrdinals(completed),freePerformances=[];
  for(const row of rows){
    if(!days.has(row.day))days.set(row.day,{day:row.day,openSlots:0,closedSlots:0,capacity:0,bookedOpen:0,booked:0,completed:0,freeCompleted:0});
    const day=days.get(row.day);
    if(!seenSlots.has(row.slot_id)){
      seenSlots.add(row.slot_id);
      if(row.closed)day.closedSlots++;else{day.openSlots++;day.capacity+=4;}
    }
    if(row.booking_id===null)continue;
    day.booked++;
    if(!row.closed)day.bookedOpen++;
    if(row.total!==null){
      day.completed++;
      const ordinal=ordinals.get(row.booking_id);
      if(ordinal%5===0){
        day.freeCompleted++;
        freePerformances.push({booking_id:row.booking_id,name:row.name,club:row.club,day:row.day,hour:row.hour,lane:row.lane,ordinal,total:row.total});
      }
    }
  }
  const finish=d=>({...d,occupancy:d.capacity?Math.round(d.bookedOpen/d.capacity*1000)/10:0,awaitingResults:d.booked-d.completed,chargeableCompleted:d.completed-d.freeCompleted,bookedClosed:d.booked-d.bookedOpen});
  const daily=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(finish);
  const totals={openSlots:0,closedSlots:0,capacity:0,bookedOpen:0,booked:0,completed:0,freeCompleted:0};
  for(const day of daily)for(const key of Object.keys(totals))totals[key]+=day[key];
  freePerformances.sort((a,b)=>a.day.localeCompare(b.day)||a.hour-b.hour||a.booking_id-b.booking_id);
  return {totals:finish(totals),daily,freePerformances};
}
