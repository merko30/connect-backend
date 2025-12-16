import { factories } from "@strapi/strapi";

function generateOtpCode(length = 6) {
  return Math.floor(
    Math.pow(10, length - 1) + Math.random() * Math.pow(10, length - 1)
  ).toString();
}

export default factories.createCoreController("api::otp.otp", ({ strapi }) => ({
  async createOtp(ctx) {
    const { email, phoneNumber } = ctx.request.body;
    console.log(ctx.request.body);

    const code = generateOtpCode(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    if (!email && !phoneNumber) {
      return ctx.badRequest("Please provide email or phone number");
    }

    const user = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({
        filters: {
          $or: [
            {
              email,
            },
            {
              phoneNumber,
            },
          ],
        },
      });

    if (!user) {
      return ctx.notFound("User not found");
    }

    await strapi.documents("api::otp.otp").create({
      data: {
        email,
        phoneNumber,
        code,
        expiresAt,
      },
    });

    strapi.log.info(`Code generated: ===== ${code} =====`);

    return {
      code, // usually sent via SMS/email instead
      expiresAt,
    };
  },

  async verifyOtp(ctx) {
    const { code } = ctx.request.body;

    if (!code) {
      return ctx.badRequest("Code is required");
    }

    const now = new Date();

    const [otp] = await strapi.documents("api::otp.otp").findMany({
      filters: {
        code,
        expiresAt: { $gt: now },
      },
      limit: 1,
    });

    if (!otp) {
      return ctx.unauthorized("Invalid or expired OTP");
    }

    const { email, phoneNumber } = otp;

    if (!email && !phoneNumber) {
      return ctx.badRequest("Please provide email or phone number");
    }

    const user = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({
        populate: ["role"],
        filters: {
          $or: [
            {
              email,
            },
            {
              phoneNumber,
            },
          ],
        },
      });

    if (!user) {
      return ctx.notFound("User not found");
    }

    // 3️⃣ Issue JWT
    const jwt = strapi
      .plugin("users-permissions")
      .service("jwt")
      .issue({ id: user.id });

    await strapi
      .documents("api::otp.otp")
      .delete({ documentId: otp.documentId });

    return {
      jwt,
      user,
    };
  },
}));
