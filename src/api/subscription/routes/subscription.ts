module.exports = {
  routes: [
    {
      method: "POST",
      path: "/subscriptions/checkout-session",
      handler: "api::subscription.subscription.createCheckoutSession",
      config: {},
    },
    {
      method: "POST",
      path: "/subscriptions/subscribe",
      handler: "api::subscription.subscription.subscribe",
      config: {},
    },
    {
      method: "POST",
      path: "/subscriptions/cancel",
      handler: "api::subscription.subscription.cancel",
      config: {},
    },
    {
      method: "GET",
      path: "/subscriptions/status",
      handler: "api::subscription.subscription.status",
      config: {},
    },
    {
      method: "POST",
      path: "/subscriptions/webhook",
      handler: "api::subscription.subscription.webhook",
      config: {
        policies: [],
        auth: false,
      },
    },
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
