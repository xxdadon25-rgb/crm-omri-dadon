/**
 * STAGED ONLY. Public credit-note PDF compatibility for existing
 * /credit-note-pdf/:creditNoteId links. Mirror the deployed public-order-pdf
 * one-document UUID-link pattern; never expose database tables or secrets.
 * Deploy only with the corresponding frontend and settings RLS hardening.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://adstock.co.il", "https://www.adstock.co.il",
]);
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDIT_COLUMNS=[
  "user_id","credit_note_number","items","total","reason","created_at",
].join(",");
const BUSINESS_COLUMNS=[
  "business_name","email","address","phone","tax_id","logo_url",
].join(",");
function corsHeaders(origin:string|null):Record<string,string>{
 const h:Record<string,string>={
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Cache-Control":"no-store",
  "Vary":"Origin",
 };
 if(origin&&ALLOWED_ORIGINS.has(origin))h["Access-Control-Allow-Origin"]=origin;
 return h;
}
function json(body:unknown,status:number,origin:string|null){
 return new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders(origin),"Content-Type":"application/json; charset=utf-8"},
 });
}
function publicItems(raw:unknown):Array<Record<string,unknown>>{
 if(!Array.isArray(raw))return [];
 return raw.map(entry=>{
  const x=entry&&typeof entry==="object"&&!Array.isArray(entry)
   ?entry as Record<string,unknown>:{};
  return {
   name:x.name??null,quantity:x.quantity??null,
   unit_price:x.unit_price??null,total:x.total??null,
  };
 });
}
serve(async(req:Request)=>{
 const origin=req.headers.get("origin");
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders(origin)});
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);
 if(origin&&!ALLOWED_ORIGINS.has(origin)){
  return json({ok:false,error:"forbidden_origin"},403,origin);
 }
 let body:{credit_note_id?:unknown};
 try{body=await req.json();}
 catch{return json({ok:false,error:"invalid_credit_note_id"},400,origin);}
 const id=typeof body?.credit_note_id==="string"?body.credit_note_id.trim():"";
 if(!UUID_RE.test(id))return json({ok:false,error:"invalid_credit_note_id"},400,origin);
 const url=Deno.env.get("SUPABASE_URL");
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({ok:false,error:"internal_error"},500,origin);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.from("credit_notes")
  .select(CREDIT_COLUMNS).eq("id",id).maybeSingle();
 if(error)return json({ok:false,error:"internal_error"},500,origin);
 if(!data)return json({ok:false,error:"credit_note_not_found"},404,origin);
 const row=data as Record<string,unknown>;
 if(typeof row.user_id!=="string"||!UUID_RE.test(row.user_id)){
  return json({ok:false,error:"internal_error"},500,origin);
 }
 const {data:business,error:businessError}=await db.from("business_settings")
  .select(BUSINESS_COLUMNS).eq("user_id",row.user_id)
  .order("created_date",{ascending:true}).limit(1).maybeSingle();
 if(businessError)return json({ok:false,error:"internal_error"},500,origin);
 const info=(business??{}) as Record<string,unknown>;
 return json({
  ok:true,
  credit_note:{
   credit_note_number:row.credit_note_number??null,
   items:publicItems(row.items),total:row.total??null,
   reason:row.reason??null,created_at:row.created_at??null,
  },
  business:{
   business_name:info.business_name??null,
   email:info.email??null,address:info.address??null,
   phone:info.phone??null,tax_id:info.tax_id??null,
   logo_url:info.logo_url??null,
  },
 },200,origin);
});
