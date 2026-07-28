import { writeFile, readFile } from "node:fs/promises";

const FEED = "https://m.tuihaowu.com/cuxiao.aspx";
const ALCOHOL = /白酒|啤酒|葡萄酒|红酒|黄酒|威士忌|茅台|五粮液|汾酒|泸州老窖|郎酒|习酒|剑南春|洋河|青岛|雪花|百威|燕京|乌苏|西凤|金沙|水井坊|古井贡|今世缘|舍得|国台|酒鬼酒/i;

function decode(value) {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function platformOf(mall) {
  if (mall.includes("天猫超市")) return "天猫超市";
  if (mall.includes("天猫")) return "天猫";
  if (mall.includes("淘宝")) return "淘宝";
  if (mall.includes("拼多多")) return "拼多多";
  if (mall.includes("京东")) return "京东";
  return "其他";
}
function requirements(text) {
  return [[/88VIP/i,"需 88VIP"],[/淘金币/i,"需使用淘金币"],[/凑单/i,"需凑单"],[/首购/i,"限首购"],[/入会|会员/i,"需入会"],[/领券|需券|有券|有劵/i,"需领券"],[/限地区|地区需自测|无货/i,"地区库存不同"],[/返卡|返超市卡|E卡/i,"含返卡"],[/试用/i,"需进入试用入口"]].filter(([r])=>r.test(text)).map(([,v])=>v);
}
function priceOf(text) {
  const m=text.replace(/,/g,"").match(/(?:实付|到手|现价|合)?\s*(\d+(?:\.\d+)?)\s*元/);return m?Number(m[1]):null;
}
function stockOf(text) {
  const m=text.match(/(?:仅剩|剩余|库存)\s*(\d+)\s*(?:件|份|瓶|箱)?/);
  if (/无货|售罄|已抢光|已结束|已下架/.test(text)) return {availability:"out",availabilityLabel:"来源报告无货/结束",stockCount:0};
  if (m) return {availability:Number(m[1])>0?"active":"out",availabilityLabel:"来源公开了剩余数量",stockCount:Number(m[1])};
  if (/限地区|地区需自测|部分地区/.test(text)) return {availability:"regional",availabilityLabel:"地区库存不同，需打开核验",stockCount:null};
  return {availability:"active",availabilityLabel:"线报仍活跃；平台未公开精确数量",stockCount:null};
}
async function readPage(page) {
  const u=new URL(FEED);u.searchParams.set("method","get_list");u.searchParams.set("page",String(page));u.searchParams.set("classid","category_8139");
  const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36","x-requested-with":"XMLHttpRequest",referer:"https://m.tuihaowu.com/cuxiao.aspx"},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(`page ${page}: ${r.status}`);const j=await r.json();return j.data?.html||"";
}
function parse(html) {
  const re=/<li\b[\s\S]*?<a href="([^"]*d\.aspx\?id=(\d+)[^"]*)"[\s\S]*?<img src="([^"]+)"[\s\S]*?<div class="title">([\s\S]*?)<br\s*\/?><span>([\s\S]*?)<\/span>[\s\S]*?<span class="mall">([\s\S]*?)<\/span>/g;
  const out=[];for(const m of html.matchAll(re)){const title=decode(m[4]);if(!ALCOHOL.test(title))continue;const priceText=decode(m[5]);const mt=decode(m[6]);const i=mt.lastIndexOf("|");const mall=(i>=0?mt.slice(0,i):mt).trim();const published=(i>=0?mt.slice(i+1):"").trim();const text=`${title} ${priceText}`;const price=priceOf(priceText);out.push({id:m[2],title,priceText,price,platform:platformOf(mall),mall,published,image:m[3].replace(/^\/\//,"https://"),sourceUrl:new URL(m[1].replace(/&amp;/g,"&"),"https://m.tuihaowu.com/").toString(),isZero:/(?:^|\D)0(?:\.0+)?\s*元|0元购|免费领取|免费试用/.test(text),isTrial:/试用|试饮|小样/.test(text)||(price!==null&&price>0&&price<=5),requirements:requirements(text),...stockOf(text)})}return out;
}

const settled=await Promise.allSettled(Array.from({length:12},(_,i)=>readPage(i+1)));
const unique=new Map();
for(const entry of settled)if(entry.status==="fulfilled")for(const deal of parse(entry.value))unique.set(deal.id,deal);
const deals=[...unique.values()].sort((a,b)=>(a.isZero!==b.isZero?(a.isZero?-1:1):a.isTrial!==b.isTrial?(a.isTrial?-1:1):Number(b.id)-Number(a.id))).slice(0,60);
if(!deals.length)throw new Error("No real alcohol deals were returned; refusing to overwrite the last good snapshot.");

let old={deals:[]};
try{old=JSON.parse(await readFile("data.json","utf8"))}catch{}
const comparable=x=>JSON.stringify((x.deals||[]).map(({id,title,priceText,platform,mall,published,image,sourceUrl,isZero,isTrial,requirements,availability,availabilityLabel,stockCount})=>({id,title,priceText,platform,mall,published,image,sourceUrl,isZero,isTrial,requirements,availability,availabilityLabel,stockCount})));
const changed=comparable(old)!==comparable({deals});
const output={deals,checkedAt:new Date().toISOString(),pagesRead:settled.filter(x=>x.status==="fulfilled").length,errors:settled.filter(x=>x.status==="rejected").length,source:"公开实时优惠流与平台落地页"};
if (changed) await writeFile("data.json",JSON.stringify(output,null,2)+"\n","utf8");
console.log(JSON.stringify({deals:deals.length,changed,pagesRead:output.pagesRead,errors:output.errors}));
