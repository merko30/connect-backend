export default {
  routes: [
    {
      method: "PUT",
      path: "/custom/profile-photo",
      handler: "custom-user.updateProfilePhoto",
      config: {
        policies: [],
      },
    },
  ],
};
