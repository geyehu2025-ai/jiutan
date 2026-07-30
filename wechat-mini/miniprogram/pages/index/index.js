const { fetchDeals } = require("../../utils/api");
const app = getApp();

Page({
  data: {
    loading: true,
    error: "",
    checkedAt: "—",
    platforms: ["全部", "天猫超市", "天猫", "淘宝", "京东", "拼多多", "唯品会"],
    platform: "全部",
    onlyZero: false,
    deals: [],
    visibleDeals: [],
    sources: []
  },
  onLoad() { this.load(); },
  onPullDownRefresh() { this.load(true); },
  async load(pulled) {
    this.setData({ loading: true, error: "" });
    try {
      const payload = await fetchDeals();
      const deals = payload.deals || [];
      app.globalData.deals = deals;
      wx.setStorageSync("jiutan-deals", deals);
      this.setData({
        deals,
        sources: payload.sources || [],
        checkedAt: new Date(payload.checkedAt).toLocaleString(),
        loading: false
      });
      this.filter();
    } catch (error) {
      const cached = wx.getStorageSync("jiutan-deals") || [];
      this.setData({ deals: cached, loading: false, error: `实时数据读取失败${cached.length ? "，正在显示上次结果" : ""}` });
      this.filter();
    } finally {
      if (pulled) wx.stopPullDownRefresh();
    }
  },
  choosePlatform(event) {
    this.setData({ platform: event.currentTarget.dataset.value });
    this.filter();
  },
  toggleZero(event) {
    this.setData({ onlyZero: event.detail.value });
    this.filter();
  },
  filter() {
    const { deals, platform, onlyZero } = this.data;
    const visibleDeals = deals.filter((deal) =>
      (platform === "全部" || deal.platform === platform) &&
      (!onlyZero || deal.isZero || deal.isRebateZero || deal.isTrial || (deal.payablePrice !== null && deal.payablePrice <= 5))
    );
    this.setData({ visibleDeals });
  },
  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  }
});
