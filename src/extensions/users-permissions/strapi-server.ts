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

    const player = await strapi
      .documents("api::player-profile.player-profile")
      .findFirst({
        filters: {
          user: { id: userWithRole.id },
        },
      });

    const club = await strapi.documents("api::club.club").findFirst({
      filters: {
        user: { id: userWithRole.id },
      },
    });

    return { ...userWithRole, player, club };
  };

  return plugin;
};
