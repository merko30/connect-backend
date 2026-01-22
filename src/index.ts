import { Core } from "@strapi/strapi";

const PLAYER_ROLE_ID = 3;
const COACH_ROLE_ID = 4;

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

        const isPlayer = ctx.request.body.role === PLAYER_ROLE_ID;
        const isCoach = ctx.request.body.role === COACH_ROLE_ID;

        await strapi.documents("plugin::users-permissions.user").update({
          documentId: user.documentId,
          data: {
            role: ctx.request.body.role,
          },
        });

        const { firstName, lastName } = ctx.request.body;
        if (isPlayer) {
          await strapi.documents("api::player-profile.player-profile").create({
            data: {
              user: user.id,
              firstName,
              lastName,
            },
          });
        } else if (isCoach) {
          const { clubName, contactPhone, email } = ctx.request.body;
          await strapi.documents("api::club.club").create({
            data: {
              user: user.id,
              clubName,
              contactPhone,
              contactEmail: email,
            },
          });
        }

        const jwt = strapi
          .plugin("users-permissions")
          .service("jwt")
          .issue({ id: user.id });

        ctx.response.body = {
          jwt,
          user,
        };
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
