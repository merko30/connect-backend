/**
 * subscription controller
 */

import { factories } from "@strapi/strapi";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

const PRICE_ID = "price_1StqkqGcAeBpaFvW6s3THUgY";

export default factories.createCoreController(
  "api::subscription.subscription",
  ({ strapi }) => ({
    /**
     * Subscribe user - creates Stripe customer if needed and subscription
     */
    async subscribe(ctx) {
      try {
        const { priceId, trialPeriodDays } = ctx.request.body;
        const userId = ctx.state.user?.id;

        if (!userId) {
          return ctx.badRequest("User not authenticated");
        }

        // Get user from database
        const user = await strapi
          .query("plugin::users-permissions.user")
          .findOne({
            where: { id: userId },
          });

        if (!user) {
          return ctx.notFound("User not found");
        }

        let customerId = user.stripeCustomerId;

        // Create Stripe customer if doesn't exist
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            metadata: {
              userId: userId.toString(),
            },
          });
          customerId = customer.id;

          // Update user with Stripe customer ID
          await strapi.query("plugin::users-permissions.user").update({
            where: { id: userId },
            data: {
              stripeCustomerId: customerId,
            },
          });
        }

        // Create subscription in Stripe
        const subscriptionParams: Stripe.SubscriptionCreateParams = {
          customer: customerId,
          items: [
            {
              price: PRICE_ID,
            },
          ],
          payment_behavior: "default_incomplete",
          expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
          payment_settings: {
            save_default_payment_method: "on_subscription",
          },
          metadata: {
            userId: userId.toString(),
          },
        };

        // Add trial period if provided
        if (trialPeriodDays) {
          subscriptionParams.trial_period_days = trialPeriodDays;
        }

        const subscription = (await stripe.subscriptions.create(
          subscriptionParams,
        )) as any;

        console.log(subscription.trial_end, subscription.status);

        // Create subscription record in database
        const subscriptionRecord = await strapi
          .query("api::subscription.subscription")
          .create({
            data: {
              customerId,
              subscriptionId: subscription.id,
              priceId: PRICE_ID,
              subscriptionStatus: subscription.status,
              currentPeriodEnd: new Date(
                (subscription.current_period_end as number) * 1000,
              ).toISOString(),
              period_start: new Date(
                (subscription.current_period_start as number) * 1000,
              ),
              period_end: new Date(
                (subscription.current_period_end as number) * 1000,
              ),
              user: userId,
            },
          });

        // Update user subscription info
        await strapi.query("plugin::users-permissions.user").update({
          where: { id: userId },
          data: {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.trial_end
              ? "trialing"
              : subscription.status,
            priceId: PRICE_ID,
            currentPeriodEnd: new Date(
              (subscription.current_period_end as number) * 1000,
            ).toISOString(),
          },
        });

        ctx.send({
          subscription: subscriptionRecord,
          clientSecret:
            (subscription as Stripe.Subscription)?.[
              trialPeriodDays ? "pending_setup_intent" : "payment_intent"
            ]?.client_secret || null,
        });
      } catch (err: any) {
        strapi.log.error("Subscription error:", err);
        ctx.throw(500, err.message);
      }
    },

    /**
     * Webhook handler for Stripe events
     */
    async webhook(ctx) {
      try {
        const sig = ctx.request.headers["stripe-signature"];

        if (!sig) {
          return ctx.badRequest("Missing stripe-signature header");
        }

        // Get raw body - Stripe needs this for signature verification
        const rawBody = ctx.request.body[Symbol.for("unparsedBody")];

        const event = stripe.webhooks.constructEvent(
          rawBody,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET || "",
        );

        // Handle different event types
        switch (event.type) {
          case "customer.subscription.updated":
            await handleSubscriptionUpdated(event.data.object as any, strapi);
            break;

          case "customer.subscription.created":
            await handleSubscriptionCreated(event.data.object as any, strapi);
            break;

          case "invoice.payment_succeeded":
            await handlePaymentSucceeded(event.data.object as any, strapi);
            break;

          case "invoice.payment_failed":
            await handlePaymentFailed(event.data.object as any, strapi);
            break;

          case "customer.subscription.deleted":
            await handleSubscriptionDeleted(event.data.object as any, strapi);
            break;

          default:
            strapi.log.debug(`Unhandled event type: ${event.type}`);
        }

        ctx.send({ received: true });
      } catch (err: any) {
        strapi.log.error("Webhook error:", err);
        ctx.throw(400, `Webhook Error: ${err.message}`);
      }
    },
  }),
);

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(subscription: any, strapi: any) {
  const subscriptionRecord = await strapi
    .query("api::subscription.subscription")
    .findOne({
      where: { subscriptionId: subscription.id },
    });

  console.log({ creating: subscription.status, end: subscription.trial_end });

  if (subscriptionRecord) {
    await strapi.query("api::subscription.subscription").update({
      where: { id: subscriptionRecord.id },
      data: {
        subscriptionStatus: subscription.status,
        currentPeriodEnd: new Date(
          (subscription.current_period_end as number) * 1000,
        ).toISOString(),
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

  strapi.log.info(`Subscription created: ${subscription.id}`);
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
          status: invoice.amount_paid > 0 ? "active" : "trialing",
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
          status: "past_due",
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
        status: "canceled",
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
