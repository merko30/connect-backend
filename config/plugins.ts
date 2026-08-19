export default ({ env }) => ({
  email: {
    config: {
      provider: "@strapi/provider-email-nodemailer",
      providerOptions: {
        host: env("SMTP_HOST", "smtp.example.com"),
        port: env.int("SMTP_PORT", 587),
        auth: {
          user: env("SMTP_USERNAME"),
          pass: env("SMTP_PASSWORD"),
        },
      },
      settings: {
        defaultFrom: env("SMTP_FROM", "no-reply@example.com"),
        defaultReplyTo: env("SMTP_REPLY_TO", "no-reply@example.com"),
      },
    },
  },
  "users-permissions": {
    config: {
      register: {
        allowedFields: [
          "firstName",
          "lastName",
          "clubName",
          "contactPhone",
          "role",
          "coachType",
        ],
      },
    },
  },
});
