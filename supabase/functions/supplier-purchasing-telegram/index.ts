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
// Language models sometimes output literal "unknown" in optional fields.
// That word is a missing value, not a product feature to match against invoices.
const cleanField=(value:unknown)=> {
 const t=String(value??"").trim();
 return /^(?:unknown|null|undefined|none|n\/a|not specified|לא ידוע|לא צוין|לא צויין|אין)$/i.test(t)?"":t;
};
const cleanWanted=(p:Wanted):Wanted=>({
 name:cleanField(p.name),qty:Math.min(1000,Math.max(1,Number(p.qty)||1)),
 unit:["unit","pack","carton"].includes(p.unit)?p.unit:"unknown",
 size:cleanField(p.size),kind:cleanField(p.kind),
 color:cleanField(p.color),notes:cleanField(p.notes)
});

function match(item:Wanted,rows:Product[]) {
 item=cleanWanted(item);
 const phrase=[item.name,item.size,item.kind,item.color,item.notes].filter(Boolean).join(" ");
 const requiredDimensions=dimensions(phrase),requiredCapacities=capacities(phrase);
 // Lid-to-cup compatibility needs a verified rim diameter or manufacturer's
 // compatible model. Cup volume alone does not establish lid fit.
 if(/מכס/.test(phrase) && /כוס/.test(phrase) && /ברד/.test(phrase)
   && !requiredDimensions.length && !/\\b\\d{2,3}\\s*(?:ממ|mm)\\b/i.test(phrase))
   return {status:"clarify",question:"מצאתי מחירים למכסי כיפה לכוסות ברד, אבל אין בחשבוניות מידה שמאשרת שהמכסה מתאים לכוס שבחרת. מה קוטר פתח הכוס במ״מ, או מה דגם הכוס והמכסה שמתאימים זה לזה? לא אמליץ על מכסה בלי לוודא התאמה."};
 // A general cup request needs a capacity before any supplier offer.
 // The actual saved invoices contain both 330ml and 500ml "כוס ברד".
 if(/כוס/.test(phrase)&&/ברד/.test(phrase)&&!/מכס/.test(phrase)
   &&requiredCapacities.length===0 && requiredDimensions.length===0)
  return {status:"clarify",question:"איזה נפח כוסות ברד אתה צריך — 330 מ״ל או 500 מ״ל? אני לא בוחר גודל עבורך."};
 if(/מכס/.test(phrase)&&(/כוס/.test(phrase)||/ברד/.test(phrase))&&!requiredDimensions.length&&!requiredCapacities.length&&!/\b\d{2,3}\s*(?:ממ|mm)\b/i.test(phrase))
  return {status:"clarify",question:"איזה גודל או קוטר מכסה צריך? כדי למנוע הזמנת מכסה שלא מתאים לכוס."};
 const wanted=terms(phrase).filter(t=>!ignore.has(t)&&!/^\d+$/.test(t)&&!t.includes("/"));
 if(!wanted.length) return {status:"clarify",question:"איזה מוצר בדיוק אתה צריך?"};
 const matches=rows.map(p=>{
  const title=p.product_name+" "+p.supplier_name_raw;
  const source=p.supplier_name_raw || "";
  // When the user supplies an exact dimension/capacity, insist on explicit
  // source-document evidence; a canonical catalog link is not sufficient.
  if(requiredDimensions.length && requiredDimensions.some(d=>!dimensions(source).includes(d)))return null;
  if(requiredCapacities.length && requiredCapacities.some(v=>!capacities(source).includes(v)))return null;
  const availableDims=dimensions(title),availableCap=capacities(title);
  if(requiredDimensions.some(d=>!availableDims.includes(d)) || (requiredDimensions.length>0 && availableDims.some(d=>!requiredDimensions.includes(d))))return null;
  if(requiredCapacities.some(v=>!availableCap.includes(v)) || (requiredCapacities.length>0 && availableCap.some(v=>!requiredCapacities.includes(v))))return null;
  const found=new Set(terms(title).map(t=>t==="כוסות"?"כוס":t==="מכסים"?"מכסה":t));
  const overlap=wanted.map(t=>t==="כוסות"?"כוס":t==="מכסים"?"מכסה":t).filter(w=>found.has(w)).length;
  const score=overlap/wanted.length;
  return overlap>0?{p,score}:null;
 }).filter(Boolean) as {p:Product;score:number}[];
 matches.sort((a,b)=>b.score-a.score);
 if(!matches.length||matches[0].score<0.8)return {status:"clarify",question:"לא מצאתי התאמה מדויקת ל־"+phrase+". אפשר להבהיר סוג, צבע או מידה?"};
 const best=matches[0].score;
 const keys=new Set(matches.filter(x=>x.score===best).map(x=>x.p.product_key));
 if(keys.size!==1)return {status:"clarify",question:"יש כמה מוצרים דומים. לאיזה מהם התכוונת?",options:[...new Set(matches.filter(x=>x.score===best).map(x=>x.p.product_name))].slice(0,6)};
 const selected=[...keys][0];
 const prices=rows.filter(p=>{
  if(p.product_key!==selected||p.comparison_status!=="ready"||Number(p.price_per_pack)<0||Number(p.units_per_pack)<=0)return false;
  const source=p.supplier_name_raw||"";
  // Re-verify each offer independently, even for the same canonical product.
  const dims=dimensions(source),vols=capacities(source);
  if(requiredDimensions.length && (requiredDimensions.some(d=>!dims.includes(d))||dims.some(d=>!requiredDimensions.includes(d))))return false;
  if(requiredCapacities.length && (requiredCapacities.some(v=>!vols.includes(v))||vols.some(v=>!requiredCapacities.includes(v))))return false;
  return true;
 });
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


type ConversationResult={mode:"update"|"question"|"chat";items:Wanted[];reply:string};
async function understandConversation(history:string[],key:string,cart:Wanted[]):Promise<ConversationResult>{
 const instructions=[
  "אתה עוזר רכש אישי מקצועי שמנהל שיחה טבעית בעברית, לא מסמך ולא טופס.",
  "קלט: תמליל הודעות משתמש ועוזר בסדר כרונולוגי. הודעות העוזר הן הקשר בלבד, לא דרישות להוסיף מוצר. הפק רשימת מוצרים עדכנית רק מהבקשות של המשתמש.",
  "הודעה מאוחרת שמתקנת כמות, סוג או מידה מחליפה רק את הפרט המתוקן. תשובות קצרות כמו 330 מ״ל, כן, לא או אפשרות 1 מתייחסות לשאלת העוזר הקודמת, ולא יוצרות מוצר חדש.",
  "אם המשתמש אומר שהוא לא בטוח, אל תקבע את הפרט. אם הוא מבקש לראות אפשרויות, השאר את המוצר ללא מידה ומצב השיחה question. אם מבקשים להציג אפשרויות למכסים, mode question ו-items יכלול פריט מכסים לכוס ברד כדי שאוכל לשלוף אפשרויות אמיתיות מתוך החשבוניות.",
  "הבדל בין 'מה המחיר של X' — שאלה, לבין 'תוסיף X' — הזמנה.",
  "אל תמציא מחירים, ספקים, זמינות, כמויות, מידות, מותגים, או התאמה בין מכסה לכוס.",
  "הפק items המשקפים את ההזמנה בלבד. לשאלה על מחיר של מוצר שאינו בהזמנה, במצב question מותר להחזיר אותו כפריט חיפוש בלבד ורק אם ברור שהוא לא נוסף להזמנה.",
  "reply הוא תשובה קצרה אנושית בעברית: בלי אימוג׳י, בלי סימני קריאה או אזהרות קבועות, בלי מחירים מומצאים ובלי חזרה על כל ההזמנה.",
  "אם הבקשה לא מובנת שאל רק שאלה אחת ממוקדת. קח בחשבון את ההקשר. מצב chat לשיחות חולין, question לבירור או שאלה, update לתוספת או תיקון הזמנה.",
  "שמור כל מידה בדיוק כפי שנכתבה (75/90 לעולם אינו 75/85, 330 מ״ל אינו 350).",
  "השתמש ב-unit carton עבור קרטון, pack עבור חבילה, unit עבור יחידה, unknown אם לא צוין. מספר יחידות qty ללא ניחוש.",
  "כל המוצרים ב-items כרשימה אחת עדכנית, ללא כפילות אחרי תיקונים. לכל היותר 12 מוצרים."
 ].join("\n");
 const schema={type:"OBJECT",properties:{
   mode:{type:"STRING",enum:["update","question","chat"]},
   reply:{type:"STRING"},
   items:{type:"ARRAY",items:{type:"OBJECT",properties:{
     name:{type:"STRING"},qty:{type:"INTEGER"},unit:{type:"STRING",enum:["unit","pack","carton","unknown"]},
     size:{type:"STRING"},kind:{type:"STRING"},color:{type:"STRING"},notes:{type:"STRING"}
   },required:["name","qty","unit","size","kind","color","notes"]}}
 },required:["mode","reply","items"]};
 const url="https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key="+encodeURIComponent(key);
 const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({contents:[{parts:[{text:instructions+"\nטיוטת הזמנה קיימת (שמור את כל הפריטים האלה אלא אם המשתמש שינה או מחק במפורש): "+JSON.stringify(cart)+"\nהודעות אחרונות:\n"+history.map((x,i)=>String(i+1)+". "+x).join("\n")}]}],
   generationConfig:{responseMimeType:"application/json",responseSchema:schema,temperature:0.15,maxOutputTokens:2500}})});
 if(!res.ok){console.error("conversation_model_http",res.status);throw new Error("conversation_model_unavailable");}
 const raw=await res.json();
 const txt=(raw.candidates?.[0]?.content?.parts||[]).map((p:{text?:string})=>p.text||"").join("");
 const parsed=JSON.parse(txt);
 if(!["update","question","chat"].includes(parsed.mode)||!Array.isArray(parsed.items)||parsed.items.length>12)
   throw new Error("conversation_invalid_output");
 const items:Wanted[]=parsed.items.map((p:any)=>({
  name:String(p.name||"").slice(0,150),qty:Math.min(1000,Math.max(1,Number(p.qty)||1)),
  unit:["unit","pack","carton"].includes(p.unit)?p.unit:"unknown",
  size:String(p.size||"").slice(0,80),kind:String(p.kind||"").slice(0,80),
  color:String(p.color||"").slice(0,80),notes:String(p.notes||"").slice(0,100)
 })).map(cleanWanted).filter(p=>p.name);
 return {mode:parsed.mode,items,reply:String(parsed.reply||"").slice(0,300)};
}

async function resolveApprovedLids(evaluated:any[],rawRows:Product[],admin:any,telegramUser:number){
 const lidItems=evaluated.filter(x=>/מכס/.test(x.name+" "+x.size+" "+x.kind+" "+x.notes));
 if(!lidItems.length)return;
 const {data:approvals,error}=await admin.from("supplier_purchasing_lid_confirmations")
  .select("cup_quote_item_id,lid_product_key").eq("telegram_user_id",telegramUser);
 if(error)throw error;
 for(const item of lidItems){
   if(!/ברד/.test(item.name+" "+item.size+" "+item.kind+" "+item.notes))continue;
   const explicit=capacities(item.name+" "+item.size+" "+item.notes);
   const cupItem=evaluated.find(x=>/כוס/.test(x.name)&&/ברד/.test(x.name)&&!/מכס/.test(x.name));
   const cupCap=cupItem?capacities(cupItem.name+" "+cupItem.size+" "+cupItem.notes):[];
   const sizes=[...new Set([...explicit,...cupCap])];
   if(sizes.length!==1)continue;
   const cups=rawRows.filter(p=>!/מכס/.test(p.product_name+" "+p.supplier_name_raw)
    && /כוס/.test(p.product_name+" "+p.supplier_name_raw)
    && /ברד/.test(p.product_name+" "+p.supplier_name_raw)
    && capacities(p.supplier_name_raw).includes(sizes[0]));
   const eligibleIds=new Set(cups.map(p=>p.quote_item_id));
   const compatible=(approvals||[]).filter((x:any)=>eligibleIds.has(x.cup_quote_item_id));
   const compatibleKeys=[...new Set(compatible.map((x:any)=>x.lid_product_key))];
   if(compatibleKeys.length!==1)continue;
   const productKey=compatibleKeys[0];
   const selected=rawRows.filter(p=>p.product_key===productKey && p.comparison_status==="ready" &&
    Number(p.price_per_pack)>=0 && Number(p.units_per_pack)>0 && Number(p.packs_per_carton)>0);
   const skipped:string[]=[];
   const verified=selected.filter(p=>{
     const m=p.supplier_name_raw.match(/(\d+)\s*יח[^\n]{0,22}בקרטון/);
     if(m&&Number(m[1])!==Number(p.units_per_pack)*Number(p.packs_per_carton)){
       skipped.push(p.supplier_name_raw);
       return false;
     }
     return true;
   });
   if(!verified.length){
     item.result={status:"clarify",question:"אישרת בעבר את התאמת המכסה, אבל כמות היחידות בקרטון אינה עקבית עם החשבונית. צריך לאמת את האריזה מול הספק."};
     continue;
   }
   const unit=["unit","pack","carton"].includes(item.unit)?item.unit:"unknown";
   if(unit==="unknown"){
     item.result={status:"clarify",question:"כמה מכסים תרצה להזמין — קרטון או חבילות?"};
     continue;
   }
   const offers=verified.map(p=>{
     const quantity=Number(item.qty)||1;
     const each=Number(p.price_per_pack);
     const total=(unit==="carton"?each*Number(p.packs_per_carton):unit==="pack"?each:each/Number(p.units_per_pack))*quantity;
     return {supplier_id:p.supplier_id,quote_item_id:p.quote_item_id,
       document_number:p.document_number,total_before_vat:Math.round(total*100)/100,
       quantity,unit};
   }).sort((a,b)=>a.total_before_vat-b.total_before_vat);
   item.result={status:"matched",product:verified[0].product_name,offers};
 }
}

async function offerLidChoices(
 evaluated:any[],rows:Product[],supplierNames:Record<string,string>,admin:any,telegramUser:number
):Promise<string|null>{
 const lid=evaluated.find(x=>/מכס/.test(x.name+" "+x.kind)&&/ברד/.test(x.name+" "+x.size+" "+x.kind));
 if(!lid || lid.result?.status==="matched")return null;
 const volume=capacities(lid.name+" "+lid.size+" "+lid.notes);
 const cup=evaluated.find(x=>/כוס/.test(x.name)&&/ברד/.test(x.name)&&!/מכס/.test(x.name));
 const cupVolume=cup?capacities(cup.name+" "+cup.size+" "+cup.notes):[];
 const cap=[...new Set([...volume,...cupVolume])];
 if(cap.length!==1)return null;
 const cupRows=rows.filter(p=>!/מכס/.test(p.product_name+" "+p.supplier_name_raw)&&
  /כוס/.test(p.product_name+" "+p.supplier_name_raw)&&/ברד/.test(p.product_name+" "+p.supplier_name_raw)&&
  capacities(p.supplier_name_raw).includes(cap[0]));
 const keys=[...new Set(cupRows.map(p=>p.product_key))];
 if(keys.length!==1 || !cupRows.length)return null;
 const {data:pending}=await admin.from("supplier_purchasing_pending_lids")
   .select("created_at").eq("telegram_user_id",telegramUser).maybeSingle();
 if(pending&&Date.now()-new Date(pending.created_at).getTime()<30*60*1000)
   return "כבר הצגתי לך אפשרויות למכסים. אפשר לבחור במספר של האפשרות המתאימה, או להמשיך להוסיף מוצרים ולחזור לזה אחר כך.";
 const lidRows=rows.filter(p=>/מכס/.test(p.product_name+" "+p.supplier_name_raw) &&
  (/כוס/.test(p.product_name+" "+p.supplier_name_raw)||/כיפה/.test(p.product_name+" "+p.supplier_name_raw)) &&
  p.comparison_status==="ready");
 const grouped=new Map<string,Product[]>();
 for(const p of lidRows){
  if(!grouped.has(p.product_key))grouped.set(p.product_key,[]);
  grouped.get(p.product_key)!.push(p);
 }
 if(!grouped.size)return null;
 const choices=[...grouped.entries()].slice(0,7).map(([key,offers])=>({product_key:key,name:offers[0].product_name,offers}));
 const text=choices.map((choice,i)=>{
  const details=choice.offers.map(p=>{
   const carton=Number(p.units_per_pack)*Number(p.packs_per_carton);
   const m=p.supplier_name_raw.match(/(\d+)\s*יח[^\n]{0,22}בקרטון/);
   const discrepancy=m&&Number(m[1])!==carton;
   return (supplierNames[p.supplier_id]||"ספק")+" — "+
    (discrepancy?"מחיר הקרטון דורש בדיקת כמויות":currency(Number(p.price_per_pack)*Number(p.packs_per_carton))+" ₪ לקרטון לפני מע״מ")+
    "\nתיאור בחשבונית: "+p.supplier_name_raw;
  }).join("\n");
  return String(i+1)+". "+choice.name+"\n"+details;
 }).join("\n\n");
 const {error}=await admin.from("supplier_purchasing_pending_lids").upsert({
  telegram_user_id:telegramUser,cup_quote_item_id:cupRows[0].quote_item_id,
  candidates:choices.map(c=>({product_key:c.product_key,name:c.name})),
  created_at:new Date().toISOString()
 });
 if(error)throw error;
 return "אלה המכסים שמצאתי בחשבוניות:\n\n"+text+
  "\n\nאני עדיין לא יודע מה מתאים לכוס "+cap[0]+" מ״ל שלך. אם אתה מזהה מכסה שמתאים, תענה במספר שלו ואשמור את ההתאמה. אם אינך בטוח, נברר לפני שמזמינים.";
}
const finishedOrder=(input:string)=>/^(?:סיימתי|סיימנו|סכם(?:\s+(?:לי\s+)?(?:את\s+)?(?:ה)?הזמנה)?|סיכום(?:\s+הזמנה)?|זהו(?:\s+תודה)?|זה\s+הכל|תן\s+לי\s+סיכום|תכין\s+(?:לי\s+)?(?:סיכום|רשימת\s+הזמנה))[\s.!]*$/i.test(input);
function orderSummary(evaluated:any[],supplierNames:Record<string,string>){
 const bySupplier=new Map<string,{name:string;lines:string[];total:number}>();
 const unresolved:string[]=[];
 for(const item of evaluated){
  const matchResult=item.result;
  const label=[item.name,item.size,item.color].filter(Boolean).join(" ");
  if(matchResult?.status!=="matched"||!matchResult.offers?.length){
   unresolved.push(label+": "+(matchResult?.question||"לא נמצאה התאמה מאומתת"));
   continue;
  }
  const best=matchResult.offers[0];
  const key=best.supplier_id;
  if(!bySupplier.has(key))bySupplier.set(key,{name:supplierNames[key]||"ספק",lines:[],total:0});
  const group=bySupplier.get(key)!;
  const unit=best.unit==="carton"?"קרטון":best.unit==="pack"?"חבילה":"יחידה";
  group.lines.push(matchResult.product+" — "+best.quantity+" "+unit+
    ", "+currency(Number(best.total_before_vat))+" ₪"+
    (best.document_number?" (חשבונית "+best.document_number+")":""));
  group.total+=Number(best.total_before_vat);
 }
 const groups=[...bySupplier.values()];
 let result="סיכום הזמנה — מחירי חשבוניות שמורות, לפני מע״מ\n";
 for(const g of groups)result+="\nלהזמין מ"+g.name+":\n"+g.lines.join("\n")+"\nסה״כ אצל הספק: "+currency(g.total)+" ₪\n";
 if(groups.length)result+="\nסה״כ כל הפריטים המאומתים: "+currency(groups.reduce((sum,g)=>sum+g.total,0))+" ₪";
 if(unresolved.length)result+="\n\nפריטים שעדיין דורשים בירור:\n"+unresolved.map(x=>"- "+x).join("\n")+
   "\n\nאפשר להשלים את הפרטים בשיחה, ואעדכן את הסיכום.";
 if(!groups.length&&!unresolved.length)result="אין כרגע פריטים להזמנה. מה תרצה להזמין?";
 return result.slice(0,3800);
}
const telegramApi=async(token:string,method:string,body:Record<string,unknown>)=>{
 const res=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await res.json();
 if(!res.ok||!data.ok)throw new Error("Telegram "+method+" failed: "+String(data.description||res.status));
 return data.result;
};
async function webhookSecret(token:string){
 const bytes=new TextEncoder().encode(token);
 const hash=await crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function respondTelegram(token:string,chat_id:number,message:string){
 return telegramApi(token,"sendMessage",{chat_id,text:message.slice(0,3900)});
}
const currency=(value:number)=>new Intl.NumberFormat("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
function buildReply(items:any[],supplierNames:Record<string,string>){
 const parts:string[]=[];
 for(const item of items){
  const x=item.result;
  if(x?.status==="matched"){
   parts.push("✅ "+x.product+"\n"+x.offers.slice(0,4).map((o:any,i:number)=> (i===0?"המחיר הנמוך: ":"")+"🏪 "+(supplierNames[o.supplier_id]||"ספק")+" — "+currency(Number(o.total_before_vat))+" ₪ לפני מע״מ\n"+o.quantity+" "+(o.unit==="carton"?"קרטון":o.unit==="pack"?"חבילות":"יחידות")+" · מסמך "+(o.document_number||"ללא מספר")).join("\n"));
  }else if(x?.status==="clarify"){
   parts.push("❓ "+item.name+"\n"+x.question+(x.options?.length?"\nאפשרויות: "+x.options.join(" / "):""));
  }else parts.push("❓ "+item.name+" — לא נמצאה התאמה בטוחה");
 }

 return parts.join("\n\n").slice(0,3800);
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return output({error:"method_not_allowed"},405);
 const token=Deno.env.get("TELEGRAM_PURCHASING_BOT_TOKEN");
 if(!token)return output({error:"telegram_token_not_configured"},503);
 const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
 const adminKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
 const admin=createClient(supabaseUrl,adminKey,{auth:{persistSession:false}});
 try {
  const webhookSig=req.headers.get("x-telegram-bot-api-secret-token")||"";
  if(webhookSig && webhookSig===await webhookSecret(token)){
   const data=await req.json();
   const updateId=Number(data.update_id);
   if(!Number.isSafeInteger(updateId)||updateId<0) return output({ok:true});
   const {error:dedupeError}=await admin.from("supplier_purchasing_telegram_updates").insert({update_id:updateId});
   if(dedupeError?.code==="23505")return output({ok:true});
   if(dedupeError)throw dedupeError;
   EdgeRuntime.waitUntil((async()=>{
   const msg=data.message;
   if(!msg||msg.chat?.type!=="private"||!msg.from?.id)return output({ok:true});
   const telegramUser=Number(msg.from.id),chat=Number(msg.chat.id);
   if(!Number.isSafeInteger(telegramUser)||!Number.isSafeInteger(chat))return output({ok:true});
   const input=String(msg.text||"").trim();
   if(!input)return output({ok:true});
   const {data:authorized,error:authError}=await admin.from("supplier_purchasing_bot_auth").select("telegram_user_id").eq("telegram_user_id",telegramUser).maybeSingle();
   if(authError)throw authError;
   if(!authorized){
    await respondTelegram(token,chat,"שלום! זה בוט הרכש של QuickStock.\nכדי להפעיל גישה מאובטחת למחירי הספקים, אשר את החשבון הזה בהגדרות החיבור ל־Telegram ב־CRM.\nמזהה הטלגרם שלך: "+telegramUser+"\n\nעד לאישור לא ניתן לראות מחירים או לבצע חיפושים.");
    return output({ok:true});
   }
   if(input==="/start"||input==="/help"){
    await respondTelegram(token,chat,"שלום! 👋\nשלח לי בעברית מה אתה רוצה להזמין, לדוגמה:\nקרטון שקיות אשפה 75/90 וקרטון כוסות ברד.\n\nאם חסר פרט או שיש כמה גדלים, אשאל לפני המלצה. אני לא מוציא הזמנות לספקים.");
    return output({ok:true});
   }
   if(input==="/reset"){
    await admin.from("supplier_purchasing_order_drafts").delete().eq("telegram_user_id",telegramUser);
    await admin.from("supplier_purchasing_pending_lids").delete().eq("telegram_user_id",telegramUser);
    await admin.from("supplier_purchasing_bot_chat_state").delete().eq("telegram_user_id",telegramUser);
    await respondTelegram(token,chat,"ניקיתי את בקשת הרכש הקודמת. כתוב מה תרצה להזמין.");
    return output({ok:true});
   }

   const {error:inErr}=await admin.rpc("append_supplier_purchasing_draft",{p_telegram_user_id:telegramUser,p_message:"משתמש: "+input.slice(0,900)});
   if(inErr)throw inErr;
   const reply=async(message:string)=>{
      await respondTelegram(token,chat,message);
      const {error:e}=await admin.rpc("append_supplier_purchasing_draft",{p_telegram_user_id:telegramUser,p_message:"עוזר: "+message.slice(0,850)});
      if(e)console.error("chat_history_save_failed",e.code);
   };
   const {data:pending}=await admin.from("supplier_purchasing_pending_lids")
     .select("cup_quote_item_id,candidates,created_at").eq("telegram_user_id",telegramUser).maybeSingle();
   const chosen=/^(?:אפשרות\s*)?([1-9])$/.exec(input);
   if(pending && chosen){
     if(Date.now()-new Date(pending.created_at).getTime()>30*60*1000){
       await admin.from("supplier_purchasing_pending_lids").delete().eq("telegram_user_id",telegramUser);
       await reply("האפשרויות הקודמות פגו. בקש שוב מכסים לכוס כדי לראות מחירים מעודכנים.");
       return output({ok:true});
     }
     const opt=Array.isArray(pending.candidates)?pending.candidates[Number(chosen[1])-1]:null;
     if(!opt){
       await reply("אין אפשרות במספר הזה. שלח את מספר האפשרות שהצגתי.");
       return output({ok:true});
     }
     const {error:confirmErr}=await admin.from("supplier_purchasing_lid_confirmations").upsert({
       telegram_user_id:telegramUser,cup_quote_item_id:pending.cup_quote_item_id,
       lid_product_key:opt.product_key,confirmed_at:new Date().toISOString()
     },{onConflict:"telegram_user_id,cup_quote_item_id"});
     if(confirmErr)throw confirmErr;
     await admin.from("supplier_purchasing_pending_lids").delete().eq("telegram_user_id",telegramUser);
     await reply("✅ שמרתי את האישור שלך: "+opt.name+
       "\nההתאמה נשמרה לכוס שבחרת בלבד, ולא לכוסות דומות במידות אחרות."+
       "\nמעכשיו אפשר לבקש ממני להשוות את מחירי המכסה הזה אצל הספקים.");
     return output({ok:true});
   }

   const {data:stored,error:loadError}=await admin.from("supplier_purchasing_order_drafts")
     .select("messages,items").eq("telegram_user_id",telegramUser).maybeSingle();
   if(loadError)throw loadError;
   const savedMessages=Array.isArray(stored?.messages)?stored.messages.filter((v:unknown)=>typeof v==="string").slice(-20):[];
   const {data:afterAppend,error:readError}=await admin.from("supplier_purchasing_order_drafts")
     .select("messages,items").eq("telegram_user_id",telegramUser).maybeSingle();
   if(readError)throw readError;
   const history=Array.isArray(afterAppend?.messages)?afterAppend.messages.filter((v:unknown)=>typeof v==="string").slice(-20):savedMessages;
   const cart:Wanted[]=Array.isArray(afterAppend?.items)?afterAppend.items.map((p:Wanted)=>cleanWanted(p)).filter((p:Wanted)=>p.name):[];
   if(!history.length){
     await reply("מה תרצה להזמין?");
     return output({ok:true});
   }
   const geminiKey=Deno.env.get("GEMINI_API_KEY");
   if(!geminiKey){
     await reply("אני לא מצליח כרגע לקרוא את בקשת הרכש. שמרתי את ההודעה שלך.");
     return output({ok:true});
   }
   let conversation:ConversationResult;
   try{
     conversation=finishedOrder(input)
       ? {mode:"update",items:cart,reply:""}
       : await understandConversation(history,geminiKey,cart);
   }
   catch(error){
     console.error("conversation_parse_failed",error instanceof Error?error.message:String(error));
     await reply("לא הצלחתי להבין בדיוק את הבקשה. תוכל לכתוב לי מה רצית להוסיף או לשנות? שמרתי את מה ששלחת.");
     return output({ok:true});
   }
   // The model sometimes labels an instruction to continue shopping as a price
   // question. Treat explicit shopping/continuation intent as a cart update.
   const explicitContinue=/(?:תמשיך|תמשיכי|נמשיך|תמשיכו|המשך|להמשיך|תתקדם|תתקדמי)/.test(input);
   const explicitlyOrdering=/(?:אני צריך|אני צריכה|צריך להזמין|רוצה להזמין|תוסיף|להוסיף|תכניס|תזמין)/.test(input)
     && !/(?:כמה עולה|מה המחיר|תראה מחיר|המחיר של)/.test(input);
   if(!finishedOrder(input) && (explicitContinue||explicitlyOrdering)
      && conversation.mode!=="update"){
     conversation.mode="update";
   }
   // Recover an old shopping request if a previous question-mode response left
   // the cart empty. Never infer products from the bot's own replies.
   if(!finishedOrder(input) && conversation.mode==="update" && cart.length===0){
     const firstOrder=history.find((m:string)=>m.startsWith("משתמש: ") &&
       /(?:אני צריך|אני צריכה|צריך להזמין|רוצה להזמין|לעשות הזמנה)/.test(m));
     if(firstOrder){
       try{
         const recovered=await parse(firstOrder.replace(/^משתמש:\\s*/,""),geminiKey);
         const verified=recovered.map(cleanWanted).filter(p=>p.name);
         if(verified.length && dimensions(firstOrder).every(d=>
            dimensions(verified.map(x=>[x.name,x.size,x.notes].join(" ")).join(" ")).includes(d))){
           const recoveredNames=new Set(verified.map(x=>norm(x.name)));
           for(const product of conversation.items)
             if(!recoveredNames.has(norm(product.name))) verified.push(product);
           conversation.items=verified;
         }
       }catch(error){console.error("cart_recovery_failed",error instanceof Error?error.message:String(error))}
     }
   }
   const lastDimensions=dimensions(input);
   const lastVolumes=capacities(input);
   const allDetails=conversation.items.map(x=>[x.name,x.size,x.kind,x.color,x.notes].join(" ")).join(" ");
   if(conversation.mode!=="chat" && lastDimensions.some(x=>!dimensions(allDetails).includes(x))
      && !/^(?:לא|אל|במקום|תמחק|תוריד)/.test(input)){
     await reply("רק מוודא: התכוונת למידה "+lastDimensions.join(", ")+"? לא אשנה את המידה בלי אישור.");
     return output({ok:true});
   }
   if(conversation.mode!=="chat" && lastVolumes.some(x=>!capacities(allDetails).includes(x))
      && !/^(?:לא|אל|במקום|תמחק|תוריד)/.test(input)){
     await reply("רק מוודא: התכוונת לנפח "+lastVolumes.join(", ")+" מ״ל?");
     return output({ok:true});
   }
   if(conversation.mode==="chat" && !finishedOrder(input)){
     await reply(conversation.reply||"ברור. מה תרצה לעשות עם ההזמנה?");
     return output({ok:true});
   }
   if(conversation.mode==="update" && cart.length>conversation.items.length
       && !/(?:תמחק|תמחקי|תוריד|תסיר|בטל|ביטול|בלי|לא צריך|מחק|להסיר|תוציא)/.test(input)){
     await reply("אני רוצה לוודא שלא אאבד פריטים שכבר רשמתי. התכוונת להסיר מוצר מההזמנה, או רק לתקן פרט שלו?");
     return output({ok:true});
   }
   if(conversation.mode==="update" && !finishedOrder(input)){
     const {error:cartSaveErr}=await admin.from("supplier_purchasing_order_drafts")
       .update({items:conversation.items,updated_at:new Date().toISOString()})
       .eq("telegram_user_id",telegramUser);
     if(cartSaveErr)throw cartSaveErr;
   }
   const {data:priceRows,error:pricesErr}=await admin.from("supplier_quote_normalized_prices_v")
     .select("product_name,supplier_name_raw,product_key,quote_item_id,quote_id,supplier_id,document_number,quote_date,price_per_pack,units_per_pack,packs_per_carton,comparison_status").limit(2000);
   if(pricesErr)throw pricesErr;
   const {data:supplierRows,error:supplierErr}=await admin.from("suppliers").select("id,name").limit(2000);
   if(supplierErr)throw supplierErr;
   const names=Object.fromEntries((supplierRows||[]).map((x:any)=>[x.id,x.name]));
   const evaluated=conversation.items.map(p=>({...p,result:match(p,(priceRows||[]) as Product[])}));
   await resolveApprovedLids(evaluated,(priceRows||[]) as Product[],admin,telegramUser);
   if(finishedOrder(input)){
     const summary=orderSummary(evaluated,names);
     await reply(summary);
     if(evaluated.length && evaluated.every(x=>x.result?.status==="matched")){
       await admin.from("supplier_purchasing_order_drafts").delete().eq("telegram_user_id",telegramUser);
       await admin.from("supplier_purchasing_bot_chat_state").delete().eq("telegram_user_id",telegramUser);
     }
     return output({ok:true});
   }
   const lidToClarify=evaluated.find((x:any)=>/מכס/.test(x.name)&&/ברד/.test(x.name+" "+x.size)&&x.result?.status==="clarify");
   if(lidToClarify && !finishedOrder(input)){
     const options=await offerLidChoices(evaluated,(priceRows||[]) as Product[],names,admin,telegramUser);
     if(options){
       await reply(options);
       return output({ok:true});
     }
   }
   if(conversation.mode==="question"){
     const target=evaluated.filter(x=>x.result?.status==="matched");
     if(target.length===1){
       const r=target[0].result;
       await reply(r.product+":\n"+r.offers.slice(0,4).map((o:any)=>
         (names[o.supplier_id]||"ספק")+" — "+currency(Number(o.total_before_vat))+" ₪ "+
         (o.unit==="carton"?"לקרטון":o.unit==="pack"?"לחבילה":"ליחידה")+" לפני מע״מ").join("\n"));
     }else{
       const unresolved=evaluated.filter(x=>x.result?.status==="clarify");
       await reply(unresolved[0]?.result?.question||conversation.reply||"איזה מוצר או מידה תרצה לבדוק?");
     }
     return output({ok:true});
   }
   const firstMissing=evaluated.find(x=>x.result?.status==="clarify");
   if(firstMissing){
     const currentQuestion=firstMissing.result.question;
     const {data:previousQuestion}=await admin.from("supplier_purchasing_bot_chat_state")
       .select("last_question").eq("telegram_user_id",telegramUser).maybeSingle();
     await admin.from("supplier_purchasing_bot_chat_state").upsert({
       telegram_user_id:telegramUser,initial_request:history[0],
       last_question:currentQuestion,updated_at:new Date().toISOString()
     });
     if(previousQuestion?.last_question===currentQuestion){
       await reply("רשמתי. עדיין חסר לנו פרט אחד לגבי "+firstMissing.name+
         ". אפשר להמשיך להוסיף מוצרים ולחזור אליו בסוף.");
     }else{
       await reply(currentQuestion);
     }
   }else{
     await admin.from("supplier_purchasing_bot_chat_state").delete().eq("telegram_user_id",telegramUser);
     await reply(conversation.reply||"רשמתי. יש עוד משהו שתרצה להוסיף או לשנות?");
   }
   return output({ok:true});
   })().catch(async err=>{
     console.error("purchasing_bot_async",String(err instanceof Error?err.message:err));
     const chatId=Number(data?.message?.chat?.id);
     if(Number.isSafeInteger(chatId)){
       try{await respondTelegram(token,chatId,"נתקלתי בתקלה זמנית בעיבוד הבקשה. נסה לשלוח אותה שוב.");}
       catch(e){console.error("telegram_reply_failed",String(e))}
     }
   }));
   return output({ok:true});
  }
  // Only a signed-in staff user can register the webhook or grant Telegram access.
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return output({error:"unauthorized"},401);
  const client=createClient(supabaseUrl,anonKey,{auth:{persistSession:false},global:{headers:{Authorization:"Bearer "+jwt}}});
  const {data:{user},error:userError}=await client.auth.getUser(jwt);
  if(userError||!user)return output({error:"unauthorized"},401);
  const {data:staff,error:staffError}=await client.from("staff_members").select("id").eq("auth_user_id",user.id).maybeSingle();
  if(staffError||!staff)return output({error:"forbidden"},403);
  const body=await req.json();
  if(body.action==="setup"){
   const secret=await webhookSecret(token);
   const url=supabaseUrl+"/functions/v1/supplier-purchasing-telegram";
   await telegramApi(token,"setWebhook",{url,secret_token:secret,allowed_updates:["message"],max_connections:5,drop_pending_updates:false});
   const info=await telegramApi(token,"getWebhookInfo",{});
   return output({ok:true,connected:info.url===url,pending_update_count:info.pending_update_count,last_error_message:info.last_error_message||null});
  }
  if(body.action==="approve"){
   const id=Number(body.telegram_user_id);
   if(!Number.isSafeInteger(id)||id<=0)return output({error:"invalid_telegram_user_id"},400);
   const {error}=await admin.from("supplier_purchasing_bot_auth").upsert({telegram_user_id:id,approved_by:user.id,approved_at:new Date().toISOString()});
   if(error)throw error;
   return output({ok:true,authorized:true});
  }
  return output({error:"invalid_action"},400);
 } catch(err){
  console.error("supplier-purchasing-telegram",String(err instanceof Error?err.message:err));
  return output({error:"server_error"},500);
 }
});