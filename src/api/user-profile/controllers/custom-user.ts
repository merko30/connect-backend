const CONTENT_TYPE = {
  Player: { name: "api::player-profile.player-profile", field: "profilePhoto" },
  Coach: { name: "api::coach-profile.coach-profile", field: "profilePhoto" },
  "Club-staff": { name: "api::club.club", field: "logo" },
};

export default {
  async updateProfilePhoto(ctx) {
    const user = ctx.state.user;
    const { fileId, type } = ctx.request.body;

    if (!fileId) {
      return ctx.badRequest("fileId is required");
    }

    console.log(type);

    const contentType = CONTENT_TYPE[type];

    if (!contentType) {
      return ctx.badRequest("Invalid type");
    }

    const profile = await strapi.db.query(contentType.name).findOne({
      where: {
        user: user.id,
      },
    });

    if (!profile) {
      return ctx.notFound("Profile not found");
    }

    await strapi.documents(contentType.name).update({
      documentId: profile.documentId,
      data: {
        [contentType.field]: fileId,
      },
    });

    return { success: true };
  },
};
