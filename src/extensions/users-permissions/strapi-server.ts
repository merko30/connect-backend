export default (plugin) => {
  plugin.controllers.user.me = async (ctx) => {
    const user = ctx.state.user;

    if (!user) return ctx.unauthorized();

    // Populate role
    const userWithRole = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({
        filters: { id: user.id },
        populate: ["role"],
      });

    return userWithRole;
  };

  return plugin;
};
