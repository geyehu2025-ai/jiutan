const API_URL = "https://geyehu2025-ai.github.io/jiutan/data.json";

function fetchDeals() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_URL}?t=${Date.now()}`,
      method: "GET",
      timeout: 15000,
      success(result) {
        if (result.statusCode >= 200 && result.statusCode < 300 && result.data && Array.isArray(result.data.deals)) {
          resolve(result.data);
        } else {
          reject(new Error(`数据源返回 ${result.statusCode}`));
        }
      },
      fail: reject
    });
  });
}

module.exports = { API_URL, fetchDeals };
