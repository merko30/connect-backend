/**
 * subscription controller
 */

import { factories } from "@strapi/strapi";
import crypto from "crypto";

export default factories.createCoreController(
  "api::subscription.subscription",
  ({ strapi }) => ({
    /**
     * RevenueCat webhook handler
     */
    async revenuecatWebhook(ctx) {
      try {
        const signature =
          (ctx.request.headers["x-revenuecat-signature"] as string) ||
          (ctx.request.headers["X-RevenueCat-Signature"] as string);

        const rawBody =
          ctx.request.body &&
          (ctx.request.body as any)[Symbol.for("unparsedBody")]
            ? (ctx.request.body as any)[Symbol.for("unparsedBody")]
            : JSON.stringify(ctx.request.body || {});

        if (!verifyRevenueCatSignature(rawBody, signature)) {
          strapi.log.warn("Invalid RevenueCat webhook signature");
          return ctx.unauthorized("Invalid signature");
        }

        const payload = JSON.parse(rawBody) as any;
        await handleRevenueCatEvent(payload, strapi);

        return ctx.send({ acknowledged: true });
      } catch (err: any) {
        strapi.log.error("RevenueCat webhook error:", err);
        // return 200 so RevenueCat doesn't keep retrying if we couldn't process
        return ctx.send({ acknowledged: true, error: true });
      }
    },

    /**
     * GET /subscriptions/revenuecat/status
     * Queries RevenueCat for the authenticated user's subscription status
     */
    async revenuecatStatus(ctx) {
      try {
        const userId = ctx.state.user?.id;

        if (!userId) {
          return ctx.badRequest("User not authenticated");
        }

        const user = await strapi
          .query("plugin::users-permissions.user")
          .findOne({ where: { id: userId } });

        if (!user) {
          return ctx.notFound("User not found");
        }

        // Use user id as app_user_id mapping by default; adjust if you use email or custom id
        const appUserId = String(user.id);

        const status = await getSubscriptionStatusFromRevenueCat(appUserId);

        return ctx.send(status);
      } catch (err: any) {
        strapi.log.error("RevenueCat status error:", err);
        ctx.throw(500, err.message);
      }
    },
  }),
);

/**
 * Verify RevenueCat webhook signature using HMAC SHA256
 */
function verifyRevenueCatSignature(body: string, signature?: string): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  try {
    const hash = crypto.createHmac("sha256", secret).update(body).digest("hex");
    // Some RevenueCat setups may send just the hex signature; compare directly
    if (hash === signature) return true;

    // Support signatures prefixed like "v1=<hex>" or other formats
    if (signature.includes("=")) {
      const parts = signature.split("=");
      return parts.includes(hash);
    }

    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Process RevenueCat webhook payload and upsert subscription/user state
 */
async function handleRevenueCatEvent(payload: any, strapi: any) {
  const event = payload.event || payload;
  const eventType = event.type;
  const appUserId = event.app_user_id || event.app_user_id?.toString();
  const subscriber = event.subscriber || {};
  const entitlements = subscriber.entitlements || {};

  // Determine active entitlement
  const hasActiveEntitlement = Object.entries(entitlements).some(
    ([, data]: any) => {
      const expiresDate = data.expires_date;
      return expiresDate && new Date(expiresDate) > new Date();
    },
  );

  const activeEntry = Object.entries(entitlements).find(([, data]: any) => {
    const expiresDate = (data as any).expires_date;
    return expiresDate && new Date(expiresDate) > new Date();
  }) as [string, any] | undefined;

  const activeEntitlementKey = activeEntry ? activeEntry[0] : null;
  const currentPeriodEnd = activeEntry
    ? (activeEntry[1] as any).expires_date
    : null;
  const isTrialing =
    activeEntitlementKey?.toLowerCase().includes("trial") || false;

  // Try to resolve a Strapi user by id or email
  let resolvedUserId: number | null = null;
  if (appUserId) {
    // try find by numeric id
    const maybeId = parseInt(appUserId, 10);
    if (!Number.isNaN(maybeId)) {
      const u = await strapi
        .query("plugin::users-permissions.user")
        .findOne({ where: { id: maybeId }, select: ["id"] });
      if (u) resolvedUserId = u.id;
    }

    if (!resolvedUserId) {
      // try find by email
      const u2 = await strapi
        .query("plugin::users-permissions.user")
        .findOne({ where: { email: appUserId }, select: ["id"] });
      if (u2) resolvedUserId = u2.id;
    }
  }

  // Find existing subscription record by customerId or subscriptionId
  const subscriptionRecord = await strapi
    .query("api::subscription.subscription")
    .findOne({
      where: { customerId: appUserId },
    });

  const status = hasActiveEntitlement
    ? isTrialing
      ? "trialing"
      : "active"
    : "inactive";

  const subscriptionData: any = {
    customerId: appUserId || null,
    subscriptionId:
      activeEntitlementKey || event.id || `${appUserId}-${eventType}`,
    priceId: activeEntitlementKey || null,
    subscriptionStatus: status,
    currentPeriodEnd: currentPeriodEnd || null,
    period_start: null,
    period_end: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
  };

  if (subscriptionRecord) {
    await strapi
      .query("api::subscription.subscription")
      .update({ where: { id: subscriptionRecord.id }, data: subscriptionData });
  } else {
    await strapi.query("api::subscription.subscription").create({
      data: {
        ...subscriptionData,
        ...(resolvedUserId ? { user: resolvedUserId } : {}),
      },
    });
  }

  // Update user record if resolved
  if (resolvedUserId) {
    await strapi.query("plugin::users-permissions.user").update({
      where: { id: resolvedUserId },
      data: {
        subscriptionStatus: status,
        currentPeriodEnd: currentPeriodEnd || null,
      },
    });
  }

  strapi.log.info(
    `Processed RevenueCat event ${eventType} for app_user_id=${appUserId}, status=${status}`,
  );
}

/**
 * Query RevenueCat API for a given app_user_id and return normalized status
 */
async function getSubscriptionStatusFromRevenueCat(appUserId: string) {
  try {
    const apiKey = process.env.REVENUECAT_API_KEY;
    if (!apiKey) {
      return {
        isActive: false,
        isTrialing: false,
        status: "inactive",
        hasSubscription: false,
      };
    }

    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (!res.ok) {
      return {
        isActive: false,
        isTrialing: false,
        status: "inactive",
        hasSubscription: false,
      };
    }

    const data: any = await res.json();
    const subscriber = data.subscriber || {};
    const entitlements = subscriber.entitlements || {};

    const hasActiveEntitlement = Object.entries(entitlements).some(
      ([, v]: any) => {
        const expires = v.expires_date;
        return expires && new Date(expires) > new Date();
      },
    );

    if (!hasActiveEntitlement) {
      return {
        isActive: false,
        isTrialing: false,
        status: "inactive",
        hasSubscription: false,
      };
    }

    const activeEntry = Object.entries(entitlements).find(([, v]: any) => {
      const expires = v.expires_date;
      return expires && new Date(expires) > new Date();
    });

    const activeKey = activeEntry ? (activeEntry as any)[0] : null;
    const currentEntitlement = activeEntry ? (activeEntry as any)[1] : null;
    const expiresDate = currentEntitlement?.expires_date
      ? new Date(currentEntitlement.expires_date)
      : null;
    const now = new Date();
    const daysRemaining = expiresDate
      ? Math.ceil(
          (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    return {
      isActive: true,
      isTrialing: activeKey?.toLowerCase().includes("trial") || false,
      status: "active",
      hasSubscription: true,
      daysRemaining,
      currentPeriodEnd: currentEntitlement?.expires_date || null,
      cancelAtPeriodEnd: false,
      willCancelAt: null,
    };
  } catch (err) {
    console.error("Error fetching subscription from RevenueCat:", err);
    return {
      isActive: false,
      isTrialing: false,
      status: "inactive",
      hasSubscription: false,
    };
  }
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(subscription: any, strapi: any) {
  const subscriptionRecord = await strapi
    .query("api::subscription.subscription")
    .findOne({
      where: { subscriptionId: subscription.id },
    });

  console.log({ updating: subscription.status, end: subscription.trial_end });

  if (subscriptionRecord) {
    await strapi.query("api::subscription.subscription").update({
      where: { id: subscriptionRecord.id },
      data: {
        subscriptionStatus: subscription.status,
        currentPeriodEnd: new Date(
          (subscription.current_period_end as number) * 1000,
        ).toISOString(),
        period_end: new Date(
          (subscription.current_period_end as number) * 1000,
        ),
      },
    });
  }

  // Update user status
  if (subscription.metadata?.userId) {
    await strapi.query("plugin::users-permissions.user").update({
      where: { id: parseInt(subscription.metadata.userId) },
      data: {
        subscriptionStatus: subscription.trial_end
          ? "trialing"
          : subscription.status,
        currentPeriodEnd: new Date(
          (subscription.current_period_end as number) * 1000,
        ).toISOString(),
      },
    });
  }

  strapi.log.info(
    `Subscription updated: ${subscription.id} - Status: ${subscription.status}`,
  );
}

/**
 * Handle payment succeeded event
 */
async function handlePaymentSucceeded(invoice: any, strapi: any) {
  if (invoice.subscription) {
    const subscriptionRecord = await strapi
      .query("api::subscription.subscription")
      .findOne({
        where: { subscriptionId: invoice.subscription },
      });

    if (subscriptionRecord) {
      await strapi.query("api::subscription.subscription").update({
        where: { id: subscriptionRecord.id },
        data: {
          subscriptionStatus: invoice.amount_paid > 0 ? "active" : "trialing",
        },
      });
    }

    // Update user status
    if (invoice.customer_email) {
      const user = await strapi
        .query("plugin::users-permissions.user")
        .findOne({
          where: { email: invoice.customer_email },
        });

      if (user) {
        await strapi.query("plugin::users-permissions.user").update({
          where: { id: user.id },
          data: {
            subscriptionStatus: invoice.amount_paid > 0 ? "active" : "trialing",
          },
        });
      }
    }

    strapi.log.info(`Payment succeeded for invoice: ${invoice.id}`);
  }
}

/**
 * Handle payment failed event
 */
async function handlePaymentFailed(invoice: any, strapi: any) {
  if (invoice.subscription) {
    const subscriptionRecord = await strapi
      .query("api::subscription.subscription")
      .findOne({
        where: { subscriptionId: invoice.subscription },
      });

    if (subscriptionRecord) {
      await strapi.query("api::subscription.subscription").update({
        where: { id: subscriptionRecord.id },
        data: {
          subscriptionStatus: "past_due",
        },
      });
    }

    // Update user status
    if (invoice.customer_email) {
      const user = await strapi
        .query("plugin::users-permissions.user")
        .findOne({
          where: { email: invoice.customer_email },
        });

      if (user) {
        await strapi.query("plugin::users-permissions.user").update({
          where: { id: user.id },
          data: {
            subscriptionStatus: "past_due",
          },
        });
      }
    }

    strapi.log.error(`Payment failed for invoice: ${invoice.id}`);
  }
}

/**
 * Handle subscription deleted event
 */
async function handleSubscriptionDeleted(subscription: any, strapi: any) {
  const subscriptionRecord = await strapi
    .query("api::subscription.subscription")
    .findOne({
      where: { subscriptionId: subscription.id },
    });

  if (subscriptionRecord) {
    await strapi.query("api::subscription.subscription").update({
      where: { id: subscriptionRecord.id },
      data: {
        subscriptionStatus: "canceled",
      },
    });
  }

  // Update user status
  if (subscription.metadata?.userId) {
    await strapi.query("plugin::users-permissions.user").update({
      where: { id: parseInt(subscription.metadata.userId) },
      data: {
        subscriptionStatus: "canceled",
      },
    });
  }

  strapi.log.info(`Subscription deleted: ${subscription.id}`);
}
