import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const quotePage=file("src/pages/QuotePDFPreview.jsx");
const orderPage=file("src/pages/OrderPDFPreview.jsx");
const quoteFn=file("supabase/functions/public-quote-pdf/index.ts");
const orderFn=file("supabase/functions/public-order-pdf/index.ts");
const allowedBusiness=[
  "business_name","email","address","phone","tax_id","logo_url",
];
function fields(source,constantName) {
  const found=source.match(new RegExp(
    "const "+constantName+" = \\[([\\s\\S]*?)\\]\\.join\\("));
  assert.ok(found,"missing "+constantName);
  return [...found[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
}

test("public quote UUID link uses allowlisted endpoint rather than anonymous SELECT",()=>{
 assert.match(quotePage,/useParams\(\)/);
 assert.match(quotePage,/supabase\.functions\.invoke\(\s*"public-quote-pdf"/);
 assert.doesNotMatch(quotePage,/\.from\(\s*["']quotes["']\s*\)/);
 assert.doesNotMatch(quotePage,/\.from\(\s*["']business_settings["']\s*\)/);
 assert.match(quoteFn,/UUID_RE\.test\(quoteId\)/);
 assert.match(quoteFn,/\.eq\("id", quoteId\)\.maybeSingle\(\)/);
 assert.doesNotMatch(quoteFn,/\.select\(["']\*["']\)/);
});
test("public PDF responses contain only deliberately approved business identity columns",()=>{
 for(const code of [quoteFn,orderFn]){
  const actual=fields(code,"BUSINESS_COLUMNS");
  assert.deepEqual([...actual].sort(),[...allowedBusiness].sort());
  for(const secret of ["api_key","api_secret","api_url","api_company_id"]){
    assert.ok(!actual.includes(secret));
  }
  assert.match(code,/\.from\("business_settings"\)/);
 }
});
test("existing public order PDF keeps endpoint and no longer directly reads settings",()=>{
 assert.match(orderPage,/supabase\.functions\.invoke\(\s*"public-order-pdf"/);
 assert.match(orderPage,/orderResponse\.business/);
 assert.doesNotMatch(orderPage,/\.from\(\s*["']business_settings["']\s*\)/);
 assert.doesNotMatch(orderFn,/\.select\(["']\*["']\)/);
 assert.match(orderFn,/business: \{/);
});
test("public quote and order endpoints strip raw internal line costs and IDs",()=>{
 for(const code of [quoteFn,orderFn]){
   assert.match(code,/name:/);
   assert.match(code,/quantity:/);
   assert.match(code,/unit_price:/);
   const end=code.slice(code.lastIndexOf("return json("));
   assert.doesNotMatch(end,/api_secret|api_key|product_id|buy_price|user_id/);
 }
});
