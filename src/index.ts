import { Core } from "@strapi/strapi";

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    const authController = strapi.plugins["users-permissions"].controllers.auth;
    const originalRegister = authController.register;

    authController.register = async (ctx, next) => {
      // Call the original register function
      await originalRegister(ctx, next);
      // If registration was successful
      if (ctx.response.status === 200) {
        const { user } = ctx.response.body as {
          user: { id: number; documentId: string };
        };

        await strapi.documents("plugin::users-permissions.user").update({
          documentId: user.documentId,
          data: {
            role: ctx.request.body.role,
          },
        });

        const { firstName, lastName } = ctx.request.body;
        await strapi.documents("api::player-profile.player-profile").create({
          data: {
            user: user.id,
            firstName,
            lastName,
          },
        });
      }
    };
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
