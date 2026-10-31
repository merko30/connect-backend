module.exports = {
  routes: [
    {
      method: "POST",
      path: "/webhooks/revenuecat",
      handler: "api::subscription.subscription.revenuecatWebhook",
      config: {
        policies: [],
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/subscriptions/revenuecat/status",
      handler: "api::subscription.subscription.revenuecatStatus",
      config: {},
    },
  ],
};
