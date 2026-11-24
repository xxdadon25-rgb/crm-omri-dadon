/**
 * Client-side presentation only. Server RLS has already restricted both
 * customer and order lists to the signed-in agent's assignment scope.
 * No payment or order status is changed by these reminders.
 */
export function dormantAssignedCustomers(customers, orders, inactivityDays = 60, now = new Date()) {
  if(!Number.isInteger(inactivityDays) || inactivityDays <= 0 || !Number.isFinite(now.getTime())){
    return [];
  }
  const lastByCustomer = new Map();
  for (const order of orders ?? []) {
    const id=order?.customer_id;
    const date=order?.date || (typeof order?.created_date === "string" ? order.created_date.slice(0,10) : null);
    if(!id || typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const parsed=Date.parse(date+"T00:00:00Z");
    if(!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10)!==date)continue;
    if(parsed>now.getTime())continue;
    if(!lastByCustomer.has(id) || parsed>lastByCustomer.get(id))lastByCustomer.set(id,parsed);
  }
  const cutoff=now.getTime()-inactivityDays*86400000;
  return (customers ?? []).map(c=>{
    const last=lastByCustomer.get(c.id);
    return {...c,lastOrderDate:last===undefined?null:new Date(last).toISOString().slice(0,10)};
  }).filter(c=>c.lastOrderDate===null ||
    lastByCustomer.get(c.id)<cutoff
  ).sort((a,b)=>{
    if(a.lastOrderDate===null)return b.lastOrderDate===null?
      a.name.localeCompare(b.name,"he"):-1;
    if(b.lastOrderDate===null)return 1;
    return a.lastOrderDate.localeCompare(b.lastOrderDate);
  });
}
