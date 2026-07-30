const app = getApp();

function stepsFor(deal) {
  return [
    deal.verificationStatus === "platform_reached" ? `复制链接后在${deal.platform}打开并登录。` : `先打开${deal.discoverySource || deal.mall}来源页，再进入平台。`,
    `核对商品与规格：${deal.title}。`,
    deal.requirements && deal.requirements.length ? `完成活动条件：${deal.requirements.join("、")}。` : "领取商品页可见优惠券，确认所选规格。",
    `进入结算页，确认最终实付与“${deal.priceText}”一致。`,
    "检查收货地区库存和运费；不一致就不要付款。"
  ];
}

Page({
  data: { deal: null, steps: [] },
  onLoad(options) {
    const deals = app.globalData.deals.length ? app.globalData.deals : (wx.getStorageSync("jiutan-deals") || []);
    const deal = deals.find((item) => String(item.id) === decodeURIComponent(options.id || ""));
    if (!deal) return wx.showToast({ title: "活动已更新", icon: "none" });
    this.setData({ deal, steps: stepsFor(deal) });
  },
  copyLink() {
    const deal = this.data.deal;
    wx.setClipboardData({ data: deal.checkoutUrl || deal.sourceUrl, success: () => wx.showToast({ title: "平台链接已复制" }) });
  },
  copySteps() {
    const text = this.data.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: "步骤已复制" }) });
  }
});
