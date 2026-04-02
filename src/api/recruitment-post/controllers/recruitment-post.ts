/**
 * recruitment-post controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::recruitment-post.recruitment-post",
  ({ strapi }) => ({
    async addInterest(ctx) {
      try {
        const userId = ctx.state.user?.id;
        const postId = parseInt(ctx.params.id, 10);

        if (!userId) {
          return ctx.unauthorized("User not authenticated");
        }

        if (!postId || Number.isNaN(postId)) {
          return ctx.badRequest("Invalid recruitment post id");
        }

        const playerProfile = await strapi
          .query("api::player-profile.player-profile")
          .findOne({
            where: { user: userId },
            select: ["id"],
          });

        if (!playerProfile) {
          return ctx.notFound("Player profile not found");
        }

        const post = await strapi
          .query("api::recruitment-post.recruitment-post")
          .findOne({
            where: { id: postId },
            select: ["id", "postStatus"],
            populate: {
              interestedPlayers: {
                select: ["id"],
              },
            },
          });

        if (!post) {
          return ctx.notFound("Recruitment post not found");
        }

        if (post.postStatus && post.postStatus !== "open") {
          return ctx.badRequest("Recruitment post is not open");
        }

        const interestedPlayerIds = (post.interestedPlayers || []).map(
          (player: any) => player.id,
        );

        const alreadyInterested = interestedPlayerIds.includes(
          playerProfile.id,
        );

        if (!alreadyInterested) {
          await strapi.query("api::recruitment-post.recruitment-post").update({
            where: { id: postId },
            data: {
              interestedPlayers: [...interestedPlayerIds, playerProfile.id],
            },
          });
        }

        return ctx.send({
          ok: true,
          interested: true,
          alreadyInterested,
          postId,
          playerProfileId: playerProfile.id,
        });
      } catch (err: any) {
        strapi.log.error("Add interest error:", err);
        ctx.throw(500, err.message);
      }
    },

    async removeInterest(ctx) {
      try {
        const userId = ctx.state.user?.id;
        const postId = parseInt(ctx.params.id, 10);

        if (!userId) {
          return ctx.unauthorized("User not authenticated");
        }

        if (!postId || Number.isNaN(postId)) {
          return ctx.badRequest("Invalid recruitment post id");
        }

        const playerProfile = await strapi
          .query("api::player-profile.player-profile")
          .findOne({
            where: { user: userId },
            select: ["id"],
          });

        if (!playerProfile) {
          return ctx.notFound("Player profile not found");
        }

        const post = await strapi
          .query("api::recruitment-post.recruitment-post")
          .findOne({
            where: { id: postId },
            select: ["id"],
            populate: {
              interestedPlayers: {
                select: ["id"],
              },
            },
          });

        if (!post) {
          return ctx.notFound("Recruitment post not found");
        }

        const interestedPlayerIds = (post.interestedPlayers || []).map(
          (player: any) => player.id,
        );

        const wasInterested = interestedPlayerIds.includes(playerProfile.id);

        if (wasInterested) {
          await strapi.query("api::recruitment-post.recruitment-post").update({
            where: { id: postId },
            data: {
              interestedPlayers: interestedPlayerIds.filter(
                (id: number) => id !== playerProfile.id,
              ),
            },
          });
        }

        return ctx.send({
          ok: true,
          interested: false,
          wasInterested,
          postId,
          playerProfileId: playerProfile.id,
        });
      } catch (err: any) {
        strapi.log.error("Remove interest error:", err);
        ctx.throw(500, err.message);
      }
    },
  }),
);
