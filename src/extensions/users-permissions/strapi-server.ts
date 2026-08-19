import crypto from "crypto";

export default (plugin) => {
  plugin.controllers.user.me = async (ctx) => {
    const user = ctx.state.user;

    console.log(user);

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
        populate: ["profilePhoto"],
      });

    const club = await strapi.documents("api::club.club").findFirst({
      filters: {
        user: { id: userWithRole.id },
      },
      populate: ["logo"],
    });

    const coach = await strapi
      .documents("api::coach-profile.coach-profile")
      .findFirst({
        filters: {
          user: { id: userWithRole.id },
        },
        populate: ["profilePhoto"],
      });

    return { ...userWithRole, player, club, coach };
  };

  // POST /auth/forgot-password
  plugin.controllers.user.forgotPassword = async (ctx) => {
    const { email } = ctx.request.body || {};

    if (!email) return ctx.badRequest("Missing email");

    const user = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({
        filters: { email },
      });

    if (!user) {
      // Do not reveal whether the email exists
      return ctx.send({ ok: true });
    }

    const resetToken = crypto.randomBytes(20).toString("hex");

    await strapi.documents("plugin::users-permissions.user").update({
      documentId: user.documentId,
      data: { resetPasswordToken: resetToken },
    });

    // Detect if request is from mobile app
    // const userAgent = ctx.request.headers["user-agent"] || "";
    // const isMobileApp =
    //   userAgent.includes("Expo") || userAgent.includes("react-native");

    // let resetUrl;
    // if (isMobileApp && process.env.MOBILE_APP_URL) {
    let resetUrl = `${process.env.MOBILE_APP_URL}?token=${resetToken}&documentId=${user.documentId}`;
    // } else {
    //   const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    //   resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&documentId=${user.documentId}`;
    // }

    console.log(resetUrl);

    try {
      await strapi
        .plugin("email")
        .service("email")
        .send({
          to: user.email,
          from: process.env.SMTP_FROM || process.env.SMTP_REPLY_TO,
          subject: "Reset your password",
          text: `To reset your password, click here: ${resetUrl}`,
          html: `<p>To reset your password, click <a href="${resetUrl}">here</a>.</p>`,
        });
    } catch (err) {
      strapi.log.error("Failed to send reset password email", err);
    }

    return ctx.send({ ok: true });
  };

  // POST /auth/reset-password
  plugin.controllers.user.resetPassword = async (ctx) => {
    const { documentId, code: token, password } = ctx.request.body || {};

    if (!documentId || !token || !password)
      return ctx.badRequest("Missing parameters");

    if (password.length < 6) return ctx.badRequest("Password too short");

    const user = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({
        filters: { documentId, resetPasswordToken: token },
      });

    if (!user) return ctx.badRequest("Invalid token");

    // Update password and clear token
    await strapi.documents("plugin::users-permissions.user").update({
      documentId: user.documentId,
      data: { password, resetPasswordToken: null },
    });

    return ctx.send({ ok: true });
  };
  return plugin;
};
