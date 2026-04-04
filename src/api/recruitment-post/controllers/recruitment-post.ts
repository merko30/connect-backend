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

        const post = await strapi
          .query("api::recruitment-post.recruitment-post")
          .findOne({
            where: { id: postId },
            select: ["id", "postStatus"],
            populate: {
              interested: {
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

        const interestedUserIds = (post.interested || []).map(
          (user: any) => user.id,
        );

        const alreadyInterested = interestedUserIds.includes(userId);

        if (!alreadyInterested) {
          await strapi.query("api::recruitment-post.recruitment-post").update({
            where: { id: postId },
            data: {
              interested: [...interestedUserIds, userId],
            },
          });
        }

        return ctx.send({
          ok: true,
          interested: true,
          alreadyInterested,
          postId,
          userId,
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

        const post = await strapi
          .query("api::recruitment-post.recruitment-post")
          .findOne({
            where: { id: postId },
            select: ["id"],
            populate: {
              interested: {
                select: ["id"],
              },
            },
          });

        if (!post) {
          return ctx.notFound("Recruitment post not found");
        }

        const interestedUserIds = (post.interested || []).map(
          (user: any) => user.id,
        );

        const wasInterested = interestedUserIds.includes(userId);

        if (wasInterested) {
          await strapi.query("api::recruitment-post.recruitment-post").update({
            where: { id: postId },
            data: {
              interested: interestedUserIds.filter(
                (id: number) => id !== userId,
              ),
            },
          });
        }

        return ctx.send({
          ok: true,
          interested: false,
          wasInterested,
          postId,
          userId,
        });
      } catch (err: any) {
        strapi.log.error("Remove interest error:", err);
        ctx.throw(500, err.message);
      }
    },
  }),
);
