export default {
  async updateProfilePhoto(ctx) {
    const user = ctx.state.user;
    const { fileId } = ctx.request.body;

    if (!fileId) {
      return ctx.badRequest("fileId is required");
    }

    const updatedUser = await strapi
      .documents("plugin::users-permissions.user")
      .update({
        documentId: user.documentId,
        data: {
          profilePhoto: fileId,
        },
        populate: ["profilePhoto"],
      });

    return updatedUser;
  },
};
