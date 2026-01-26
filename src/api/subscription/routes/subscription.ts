module.exports = {
  routes: [
    {
      method: "POST",
      path: "/subscriptions/subscribe",
      handler: "api::subscription.subscription.subscribe",
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
  ],
};
