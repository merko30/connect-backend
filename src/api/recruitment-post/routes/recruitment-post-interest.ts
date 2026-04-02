export default {
  routes: [
    {
      method: "POST",
      path: "/recruitment-posts/:id/interest",
      handler: "api::recruitment-post.recruitment-post.addInterest",
      config: {},
    },
    {
      method: "DELETE",
      path: "/recruitment-posts/:id/interest",
      handler: "api::recruitment-post.recruitment-post.removeInterest",
      config: {},
    },
  ],
};
