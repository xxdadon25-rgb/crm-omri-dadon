import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const output=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...cors}});
const norm=(s:unknown)=>String(s??"").normalize("NFKC").toLowerCase().replace(/[״"'׳]/g,"");
const terms=(s:unknown)=>norm(s).replace(/[^\p{L}\p{N}/]+/gu," ").split(/\s+/).filter(Boolean);
const dimensions=(s:unknown)=>Array.from(norm(s).matchAll(/(\d{2,4})\s*[\/x×*]\s*(\d{2,4})/g),m=>Number(m[1])+"/"+Number(m[2]));
const capacities=(s:unknown)=>Array.from(norm(s).matchAll(/(\d{2,4})\s*(?:מל|מ"ל|ml|cc|סמק)/gi),m=>Number(m[1]));
const ignore=new Set(["אני","צריך","צריכה","להזמין","לקנות","קרטון","קרטונים","חבילה","חבילות","יחידות","יחידה","של","עם","עוד","וגם","בבקשה","זה","את","כמה","מאיפה","מוצר","מוצרים","יח","בקרטון"]);
type Product={product_name:string;supplier_name_raw:string;product_key:string;quote_item_id:string;quote_id:string;supplier_id:string;document_number:string;quote_date:string;price_per_pack:number;units_per_pack:number;packs_per_carton:number;comparison_status:string};
type Wanted={name:string;qty:number;unit:string;size:string;kind:string;color:string;notes:string};
function match(item:Wanted,rows:Product[]) {
 const phrase=[item.name,item.size,item.kind,item.color,item.notes].filter(Boolean).join(" ");
 const requiredDimensions=dimensions(phrase),requiredCapacities=capacities(phrase);
 if(/מכס/.test(phrase)&&(/כוס/.test(phrase)||/ברד/.test(phrase))&&!requiredDimensions.length&&!requiredCapacities.length&&!/\b\d{2,3}\s*(?:ממ|mm)\b/i.test(phrase))
  return {status:"clarify",question:"איזה גודל או קוטר מכסה צריך? כדי למנוע הזמנת מכסה שלא מתאים לכוס."};
 const wanted=terms(phrase).filter(t=>!ignore.has(t)&&!/^\d+$/.test(t)&&!t.includes("/"));
 if(!wanted.length) return {status:"clarify",question:"איזה מוצר בדיוק אתה צריך?"};
 const matches=rows.map(p=>{
  const title=p.product_name+" "+p.supplier_name_raw;
  const availableDims=dimensions(title),availableCap=capacities(title);
  if(requiredDimensions.some(d=>!availableDims.includes(d)))return null;
  if(requiredCapacities.some(v=>!availableCap.includes(v)))return null;
  const found=new Set(terms(title));
  const overlap=wanted.filter(w=>found.has(w)).length;
  const score=overlap/wanted.length;
  return overlap>0?{p,score}:null;
 }).filter(Boolean) as {p:Product;score:number}[];
 matches.sort((a,b)=>b.score-a.score);
 if(!matches.length||matches[0].score<0.8)return {status:"clarify",question:"לא מצאתי התאמה מדויקת ל־"+phrase+". אפשר להבהיר סוג, צבע או מידה?"};
 const best=matches[0].score;
 const keys=new Set(matches.filter(x=>x.score===best).map(x=>x.p.product_key));
 if(keys.size!==1)return {status:"clarify",question:"יש כמה מוצרים דומים. לאיזה מהם התכוונת?",options:[...new Set(matches.filter(x=>x.score===best).map(x=>x.p.product_name))].slice(0,6)};
 const selected=[...keys][0];
 const prices=rows.filter(p=>p.product_key===selected&&p.comparison_status==="ready"&&Number(p.price_per_pack)>=0&&Number(p.units_per_pack)>0);
 if(!prices.length)return {status:"clarify",question:"זיהיתי את המוצר, אבל אין מחיר מאומת או נתוני אריזה תקינים."};
 const packSizes=new Set(prices.map(p=>Number(p.units_per_pack)));
 if(packSizes.size>1)return {status:"clarify",question:"קיימות חבילות בגדלים שונים. איזו חבילה אתה צריך?",sizes:[...packSizes]};
 if(!["unit","pack","carton"].includes(item.unit))return {status:"clarify",question:"האם אתה צריך יחידה, חבילה או קרטון?"};
 const latest=new Map<string,Product>();
 for(const p of prices){const prev=latest.get(p.supplier_id);if(!prev||Number(p.price_per_pack)<Number(prev.price_per_pack))latest.set(p.supplier_id,p)}
 const offers=[...latest.values()].filter(p=>item.unit!=="carton"||Number(p.packs_per_carton)>0).map(p=>{
 const qty=Number(item.qty)||1;
 const pack=Number(p.price_per_pack);
 const sum=(item.unit==="carton"?pack*Number(p.packs_per_carton):item.unit==="unit"?pack/Number(p.units_per_pack):pack)*qty;
 return {supplier_id:p.supplier_id,quote_id:p.quote_id,quote_item_id:p.quote_item_id,document_number:p.document_number,quote_date:p.quote_date,units_per_pack:p.units_per_pack,packs_per_carton:p.packs_per_carton,quantity:qty,unit:item.unit,total_before_vat:Math.round(sum*10000)/10000};
 }).sort((a,b)=>a.total_before_vat-b.total_before_vat);
 if(!offers.length)return {status:"clarify",question:"חסר מספר חבילות מאומת בקרטון, ולכן לא אוכל לחשב מחיר."};
 return {status:"matched",product:prices[0].product_name,offers,notice:"המחירים היסטוריים, לפני מע״מ, לא כולל הובלה או מינימום הזמנה."};
}
async function parse(message:string,key:string):Promise<Wanted[]>{
 const prompt='חלץ בקשת רכש בעברית ל-JSON בפורמט {"items":[{"name":"","qty":1,"unit":"unit|pack|carton|unknown","size":"","kind":"","color":"","notes":""}]}. שמור מידות ונפחים בדיוק, כולל 75/90. אל תמציא פרטים. כל מוצר בנפרד. תקן שגיאות כתיב רק כשברור, אך לא מידות. אם לא נאמר נפח השאר ריק. בקשה: '+JSON.stringify(message);
 const url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key="+encodeURIComponent(key);
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0,maxOutputTokens:1200}})});
 if(!response.ok)throw new Error("AI request failed");
 const data=await response.json();
 const raw=(data.candidates?.[0]?.content?.parts||[]).map((p:{text?:string})=>p.text||"").join("");
 const v=JSON.parse(raw);
 if(!Array.isArray(v.items)||v.items.length<1||v.items.length>12)throw new Error("Cannot parse order");
 return v.items.map((p:Wanted)=>({name:String(p.name||""),qty:Math.min(1000,Math.max(1,Number(p.qty)||1)),unit:["unit","pack","carton"].includes(p.unit)?p.unit:"unknown",size:String(p.size||""),kind:String(p.kind||""),color:String(p.color||""),notes:String(p.notes||"")}));
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return output({error:"method_not_allowed"},405);
 try{
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return output({error:"unauthorized"},401);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:"Bearer "+jwt}},auth:{persistSession:false}});
  const {data:{user}}=await db.auth.getUser(jwt);
  if(!user)return output({error:"unauthorized"},401);
  const {data:staff}=await db.from("staff_members").select("id").eq("auth_user_id",user.id).maybeSingle();
  if(!staff)return output({error:"forbidden"},403);
  const payload=await req.json(),message=String(payload.message||"").trim();
  if(!message||message.length>1200)return output({error:"invalid_message"},400);
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key)return output({error:"gemini_not_configured"},503);
  const items=await parse(message,key);
  // The model must never silently rewrite a numeric dimension or capacity.
  // A mismatch becomes a clarification instead of an unsafe recommendation.
  const originalDimensions=dimensions(message);
  const parsedDimensions=dimensions(items.map(x=>[x.name,x.size,x.kind,x.color,x.notes].join(" ")).join(" "));
  const originalCapacities=capacities(message);
  const parsedCapacities=capacities(items.map(x=>[x.name,x.size,x.kind,x.color,x.notes].join(" ")).join(" "));
  if(originalDimensions.some(x=>!parsedDimensions.includes(x))||originalCapacities.some(x=>!parsedCapacities.includes(x)))
    return output({ok:true,items:[{name:message,qty:1,unit:"unknown",
      result:{status:"clarify",question:"לא הצלחתי לוודא שהמידות או הנפחים בבקשה הובנו בדיוק. כתוב שוב את המידה והדגם כדי שלא אבחר מוצר אחר."}}],read_only:true});
  const {data:prices,error}=await db.from("supplier_quote_normalized_prices_v")
   .select("product_name,supplier_name_raw,product_key,quote_item_id,quote_id,supplier_id,document_number,quote_date,price_per_pack,units_per_pack,packs_per_carton,comparison_status").limit(2000);
  if(error)throw error;
  return output({ok:true,items:items.map(p=>({...p,result:match(p,prices as Product[])})),read_only:true});
 }catch(error){return output({error:"processing_failed",message:String(error instanceof Error?error.message:error)},500)}
});
