/**
 * subscription controller
 */

import { factories } from "@strapi/strapi";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

export default factories.createCoreController(
  "api::subscription.subscription",
  ({ strapi }) => ({
    /**
     * Subscribe user - creates Stripe customer if needed and subscription
     */
    async subscribe(ctx) {
      try {
        const { priceId } = ctx.request.body;
        const userId = ctx.state.user?.id;

        if (!userId) {
          return ctx.badRequest("User not authenticated");
        }

        if (!priceId) {
          return ctx.badRequest("priceId is required");
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
        const subscription = (await stripe.subscriptions.create({
          customer: customerId,
          items: [
            {
              price: priceId,
            },
          ],
          payment_behavior: "default_incomplete",
          expand: ["latest_invoice.payment_intent"],
        })) as any;

        // Create subscription record in database
        const subscriptionRecord = await strapi
          .query("api::subscription.subscription")
          .create({
            data: {
              customerId,
              subscriptionId: subscription.id,
              priceId,
              status: subscription.status,
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
            subscriptionStatus: subscription.status,
            priceId,
            currentPeriodEnd: new Date(
              (subscription.current_period_end as number) * 1000,
            ).toISOString(),
          },
        });

        ctx.send({
          subscription: subscriptionRecord,
          clientSecret:
            (subscription.latest_invoice as any)?.payment_intent
              ?.client_secret || null,
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
        const rawBody =
          (ctx.request as any).rawBody ||
          (typeof ctx.request.body === "string"
            ? ctx.request.body
            : JSON.stringify(ctx.request.body));

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

  if (subscriptionRecord) {
    await strapi.query("api::subscription.subscription").update({
      where: { id: subscriptionRecord.id },
      data: {
        status: subscription.status,
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
        subscriptionStatus: subscription.status,
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

  if (subscriptionRecord) {
    await strapi.query("api::subscription.subscription").update({
      where: { id: subscriptionRecord.id },
      data: {
        status: subscription.status,
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
        subscriptionStatus: subscription.status,
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
          status: "active",
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
            subscriptionStatus: "active",
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
