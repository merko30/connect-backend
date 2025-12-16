export default {
  routes: [
    {
      method: "POST",
      path: "/otps",
      handler: "otp.createOtp",
      config: {
        auth: false,
      },
    },
    {
      method: "POST",
      path: "/otps/verify",
      handler: "otp.verifyOtp",
      config: {
        auth: false,
      },
    },
  ],
};
