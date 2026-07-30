import { writeFile, readFile } from "node:fs/promises";

const FEED = "https://m.tuihaowu.com/cuxiao.aspx";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36";
const ALCOHOL_KIND = /白酒|啤酒|葡萄酒|红酒|黄酒|米酒|果酒|威士忌|白兰地|伏特加|朗姆酒|清酒|烧酒|鸡尾酒|酒精饮料/i;
const ALCOHOL_BRAND = /茅台|五粮液|汾酒|泸州老窖|郎酒|习酒|剑南春|洋河|青岛啤酒|雪花啤酒|百威|燕京啤酒|乌苏啤酒|西凤酒|水井坊|古井贡|今世缘|舍得|国台|酒鬼酒|珠江啤酒|哈尔滨啤酒/i;
const NOT_ALCOHOL = /牛肉面|方便面|泡面|洗发|沐浴|香皂|雪花酥|料酒|酒精湿巾|酒精棉/i;

function decode(value = "") {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isAlcohol(title) {
  return !NOT_ALCOHOL.test(title) && (ALCOHOL_KIND.test(title) || ALCOHOL_BRAND.test(title));
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
  return [
    [/88VIP/i, "需 88VIP"],
    [/淘金币/i, "需使用淘金币"],
    [/凑单/i, "需凑单"],
    [/首购/i, "限首购"],
    [/入会|会员/i, "需入会"],
    [/领券|需券|有券|有劵/i, "需领券"],
    [/限地区|地区需自测|无货/i, "地区库存不同"],
    [/返卡|返超市卡|E卡/i, "含返卡"],
    [/试用/i, "需进入试用入口"],
  ].filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function amount(text, pattern) {
  const match = text.replace(/,/g, "").match(pattern);
  return match ? Number(match[1]) : null;
}

function pricesOf(text) {
  const unitPrice = amount(text, /(\d+(?:\.\d+)?)\s*元\s*\/\s*(?:罐|瓶|听|件|支|箱)/);
  const payablePrice =
    amount(text, /(?:共|整箱(?:价)?|到手价|实付|现价|支付)\s*(\d+(?:\.\d+)?)\s*元/) ??
    amount(text, /(\d+(?:\.\d+)?)\s*元\s*(?:\/\s*(?:整箱|共)|包邮|到手)/) ??
    amount(text, /(\d+(?:\.\d+)?)\s*元/);
  return { price: payablePrice, payablePrice, unitPrice };
}

function zeroOf(text, payablePrice) {
  const rebate = /返卡|返超市卡|返.*E卡|返.*礼金|返.*余额/i.test(text);
  const explicitZero = /(?:^|\D)0(?:\.0+)?\s*元(?:购|到手|实付)?|免费领取|免费试用/i.test(text);
  const cashZero = (explicitZero || payablePrice === 0) && !rebate;
  return {
    isZero: cashZero,
    isRebateZero: rebate && /0元购|0元到手|返卡后0元/i.test(text),
    zeroType: cashZero ? "cash" : rebate && /0元购|0元到手|返卡后0元/i.test(text) ? "rebate_card" : null,
  };
}

function stockOf(text) {
  const match = text.match(/(?:仅剩|剩余|库存)\s*(\d+)\s*(?:件|份|瓶|箱)?/);
  if (/限地区|地区需自测|部分地区/.test(text)) {
    return { availability: "regional", availabilityLabel: "部分地区无货，需按收货地核验", stockCount: null };
  }
  if (/无货|售罄|已抢光|已结束|已下架/.test(text)) {
    return { availability: "out", availabilityLabel: "优惠来源报告无货/结束", stockCount: 0 };
  }
  if (match) {
    return {
      availability: Number(match[1]) > 0 ? "active" : "out",
      availabilityLabel: "优惠来源公开了剩余数量",
      stockCount: Number(match[1]),
    };
  }
  return { availability: "unknown", availabilityLabel: "优惠线报活跃；未公开精确库存", stockCount: null };
}

async function readPage(page) {
  const url = new URL(FEED);
  url.searchParams.set("method", "get_list");
  url.searchParams.set("page", String(page));
  url.searchParams.set("classid", "category_8139");
  const response = await fetch(url, {
    headers: { "user-agent": UA, "x-requested-with": "XMLHttpRequest", referer: FEED },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`page ${page}: ${response.status}`);
  const json = await response.json();
  return json.data?.html || "";
}

function parse(html) {
  const pattern = /<li\b[\s\S]*?<a href="([^"]*d\.aspx\?id=(\d+)[^"]*)"[\s\S]*?<img src="([^"]+)"[\s\S]*?<div class="title">([\s\S]*?)<br\s*\/?><span>([\s\S]*?)<\/span>[\s\S]*?<span class="mall">([\s\S]*?)<\/span>/g;
  const deals = [];
  for (const match of html.matchAll(pattern)) {
    const title = decode(match[4]);
    if (!isAlcohol(title)) continue;
    const priceText = decode(match[5]);
    const mallTime = decode(match[6]);
    const split = mallTime.lastIndexOf("|");
    const mall = (split >= 0 ? mallTime.slice(0, split) : mallTime).trim();
    const published = (split >= 0 ? mallTime.slice(split + 1) : "").trim();
    const combined = `${title} ${priceText}`;
    const priceFields = pricesOf(priceText);
    const zeroFields = zeroOf(combined, priceFields.payablePrice);
    deals.push({
      id: match[2],
      title,
      priceText,
      ...priceFields,
      platform: platformOf(mall),
      mall,
      published,
      image: match[3].replace(/^\/\//, "https://"),
      sourceUrl: new URL(match[1].replace(/&amp;/g, "&"), "https://m.tuihaowu.com/").toString(),
      ...zeroFields,
      isTrial: /试用|试饮|小样|尝鲜/.test(combined) ||
        (priceFields.payablePrice !== null && priceFields.payablePrice > 0 && priceFields.payablePrice <= 5),
      requirements: requirements(combined),
      ...stockOf(combined),
    });
  }
  return deals;
}

function expectedPlatformHost(platform, host) {
  if (platform === "天猫" || platform === "天猫超市" || platform === "淘宝") {
    return /(?:^|\.)taobao\.com$|(?:^|\.)tmall\.com$/.test(host);
  }
  if (platform === "京东") return /(?:^|\.)jd\.com$/.test(host);
  if (platform === "拼多多") return /(?:^|\.)pinduoduo\.com$|(?:^|\.)yangkeduo\.com$/.test(host);
  return false;
}

async function verifyDeal(deal) {
  const verifiedAt = new Date().toISOString();
  const redirectUrl = `https://m.tuihaowu.com/redirect.aspx?cxid=${encodeURIComponent(deal.id)}`;
  try {
    const response = await fetch(redirectUrl, {
      redirect: "follow",
      headers: { "user-agent": UA, referer: deal.sourceUrl },
      signal: AbortSignal.timeout(15_000),
    });
    const checkoutUrl = response.url;
    const host = new URL(checkoutUrl).hostname.toLowerCase();
    const reached = response.ok && expectedPlatformHost(deal.platform, host);
    if (!reached) {
      return {
        ...deal,
        checkoutUrl: deal.sourceUrl,
        verificationStatus: response.ok ? "source_only" : "blocked",
        verificationLabel: response.ok ? "未解析到平台直达链接" : `平台跳转返回 HTTP ${response.status}`,
        verifiedAt,
      };
    }
    return {
      ...deal,
      checkoutUrl,
      verificationStatus: "platform_reached",
      verificationLabel: `已核验可跳转至${deal.platform}；未公开精确库存`,
      verifiedAt,
      availabilityLabel: deal.stockCount !== null || deal.availability === "out" || deal.availability === "regional"
        ? deal.availabilityLabel
        : `已到达${deal.platform}落地页；未公开精确库存`,
    };
  } catch (error) {
    return {
      ...deal,
      checkoutUrl: deal.sourceUrl,
      verificationStatus: "blocked",
      verificationLabel: `平台核验受限：${error instanceof Error ? error.name : "请求失败"}`,
      verifiedAt,
    };
  }
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const settled = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => readPage(index + 1)));
const successfulPages = settled.filter((entry) => entry.status === "fulfilled").length;
if (successfulPages < 6) {
  throw new Error(`Only ${successfulPages}/12 source pages succeeded; refusing to replace the last good snapshot.`);
}

const unique = new Map();
for (const entry of settled) {
  if (entry.status === "fulfilled") {
    for (const deal of parse(entry.value)) unique.set(deal.id, deal);
  }
}
const discovered = [...unique.values()]
  .sort((a, b) => a.isZero !== b.isZero ? (a.isZero ? -1 : 1) :
    a.isRebateZero !== b.isRebateZero ? (a.isRebateZero ? -1 : 1) :
    a.isTrial !== b.isTrial ? (a.isTrial ? -1 : 1) : Number(b.id) - Number(a.id))
  .slice(0, 60);
if (!discovered.length) throw new Error("No real alcohol deals were returned; refusing to overwrite the last good snapshot.");

const deals = await mapConcurrent(discovered, 6, verifyDeal);
let old = { deals: [] };
try { old = JSON.parse(await readFile("data.json", "utf8")); } catch {}
const comparable = (snapshot) => JSON.stringify((snapshot.deals || []).map(({
  id, title, priceText, price, payablePrice, unitPrice, platform, mall, published, image, sourceUrl, checkoutUrl,
  isZero, isRebateZero, zeroType, isTrial, requirements, availability, availabilityLabel, stockCount,
  verificationStatus, verificationLabel,
}) => ({
  id, title, priceText, price, payablePrice, unitPrice, platform, mall, published, image, sourceUrl, checkoutUrl,
  isZero, isRebateZero, zeroType, isTrial, requirements, availability, availabilityLabel, stockCount,
  verificationStatus, verificationLabel,
})));
const changed = comparable(old) !== comparable({ deals });
const output = {
  deals,
  checkedAt: new Date().toISOString(),
  pagesRead: successfulPages,
  errors: settled.filter((entry) => entry.status === "rejected").length,
  platformVerified: deals.filter((deal) => deal.verificationStatus === "platform_reached").length,
  source: "公开优惠流发现 + 电商平台落地链接二次核验",
};
if (changed) await writeFile("data.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  deals: deals.length,
  changed,
  pagesRead: output.pagesRead,
  platformVerified: output.platformVerified,
  zero: deals.filter((deal) => deal.isZero).length,
  rebateZero: deals.filter((deal) => deal.isRebateZero).length,
  trial: deals.filter((deal) => deal.isTrial).length,
}));
