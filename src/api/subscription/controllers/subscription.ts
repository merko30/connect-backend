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
     * Create Stripe Checkout Session and return hosted Stripe payment URL
     */
    async createCheckoutSession(ctx) {
      try {
        const userId = ctx.state.user?.id;

        if (!userId) {
          return ctx.badRequest("User not authenticated");
        }

        const { priceId, successUrl, cancelUrl } = ctx.request.body || {};

        const user = await strapi
          .query("plugin::users-permissions.user")
          .findOne({
            where: { id: userId },
          });

        if (!user) {
          return ctx.notFound("User not found");
        }

        const configs = await strapi.query("api::config.config").findMany({
          limit: 1,
        });

        const appConfig = configs?.[0];
        const stripeSecretKey =
          process.env.STRIPE_SECRET_KEY || appConfig?.stripe_sk;
        const defaultPriceId = PRICE_ID;

        if (!stripeSecretKey) {
          return ctx.badRequest("Stripe secret key is not configured");
        }

        const stripeClient = new Stripe(stripeSecretKey, {
          apiVersion: "2023-10-16" as any,
        });

        let customerId = user.stripeCustomerId;

        if (!customerId) {
          const customer = await stripeClient.customers.create({
            email: user.email,
            metadata: {
              userId: userId.toString(),
            },
          });

          customerId = customer.id;

          await strapi.query("plugin::users-permissions.user").update({
            where: { id: userId },
            data: {
              stripeCustomerId: customerId,
            },
          });
        }

        const frontendUrl =
          process.env.FRONTEND_URL ||
          process.env.CLIENT_URL ||
          "http://localhost:3000";
        const resolvedSuccessUrl =
          successUrl ||
          `${frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
        const resolvedCancelUrl = cancelUrl || `${frontendUrl}/payment/cancel`;

        const session = await stripeClient.checkout.sessions.create({
          mode: "subscription",
          customer: customerId,
          line_items: [
            {
              price: priceId || defaultPriceId,
              quantity: 1,
            },
          ],
          success_url: resolvedSuccessUrl,
          cancel_url: resolvedCancelUrl,
          metadata: {
            userId: userId.toString(),
          },
        });

        return ctx.send({
          checkoutUrl: session.url,
          sessionId: session.id,
        });
      } catch (err: any) {
        strapi.log.error("Create checkout session error:", err);
        ctx.throw(500, err.message);
      }
    },

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

        // Check if user already used trial
        if (trialPeriodDays && user.hasUsedTrial) {
          return ctx.badRequest("Free trial already used");
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
        const userUpdateData: any = {
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.trial_end
            ? "trialing"
            : subscription.status,
          priceId: PRICE_ID,
          currentPeriodEnd: new Date(
            (subscription.current_period_end as number) * 1000,
          ).toISOString(),
        };

        // Mark trial as used if trial period was applied
        if (trialPeriodDays) {
          userUpdateData.hasUsedTrial = true;
        }

        await strapi.query("plugin::users-permissions.user").update({
          where: { id: userId },
          data: userUpdateData,
        });

        ctx.send({
          subscription: subscriptionRecord,
          clientSecret: trialPeriodDays
            ? (
                (subscription as Stripe.Subscription)?.[
                  "pending_setup_intent"
                ] as Stripe.SetupIntent
              )?.client_secret
            : (
                (subscription as Stripe.Subscription)?.["latest_invoice"]?.[
                  "payment_intent"
                ] as Stripe.PaymentIntent
              )?.client_secret,
        });
      } catch (err: any) {
        strapi.log.error("Subscription error:", err);
        ctx.throw(500, err.message);
      }
    },

    /**
     * Get subscription status for current user
     */
    async status(ctx) {
      try {
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

        // Get subscription record from database
        const subscriptionRecord = await strapi
          .query("api::subscription.subscription")
          .findOne({
            where: { user: userId },
          });

        // If no subscription exists
        if (!subscriptionRecord || !user.subscriptionId) {
          return ctx.send({
            hasSubscription: false,
            hasUsedTrial: user.hasUsedTrial || false,
            isEligibleForTrial: !user.hasUsedTrial,
          });
        }

        // Fetch latest subscription data from Stripe
        let stripeSubscription = null;
        let cancelAtPeriodEnd = false;
        let cancelAt = null;

        try {
          stripeSubscription = await stripe.subscriptions.retrieve(
            user.subscriptionId,
          );
          cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
          cancelAt = stripeSubscription.cancel_at
            ? new Date(stripeSubscription.cancel_at * 1000).toISOString()
            : null;
        } catch (err) {
          strapi.log.warn(
            `Could not fetch Stripe subscription: ${err.message}`,
          );
          // Continue with database data if Stripe fetch fails
        }

        // Determine if subscription is active (including trial)
        const isActive = ["active", "trialing"].includes(
          subscriptionRecord.subscriptionStatus,
        );
        const isTrialing = subscriptionRecord.subscriptionStatus === "trialing";
        const isCanceled = subscriptionRecord.subscriptionStatus === "canceled";
        const isPastDue = subscriptionRecord.subscriptionStatus === "past_due";

        // Calculate days remaining
        const periodEnd = new Date(subscriptionRecord.currentPeriodEnd);
        const now = new Date();
        const daysRemaining = Math.ceil(
          (periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        ctx.send({
          hasSubscription: true,
          isActive,
          isTrialing,
          isCanceled,
          isPastDue,
          status: subscriptionRecord.subscriptionStatus,
          subscriptionId: subscriptionRecord.subscriptionId,
          customerId: subscriptionRecord.customerId,
          priceId: subscriptionRecord.priceId,
          currentPeriodEnd: subscriptionRecord.currentPeriodEnd,
          periodStart: subscriptionRecord.period_start,
          periodEnd: subscriptionRecord.period_end,
          daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
          cancelAtPeriodEnd,
          cancelAt,
          hasUsedTrial: user.hasUsedTrial || false,
          willCancelAt: cancelAtPeriodEnd
            ? subscriptionRecord.currentPeriodEnd
            : null,
        });
      } catch (err: any) {
        strapi.log.error("Get subscription status error:", err);
        ctx.throw(500, err.message);
      }
    },

    /**
     * Cancel user subscription at period end
     */
    async cancel(ctx) {
      try {
        const userId = ctx.state.user?.id;

        if (!userId) {
          return ctx.badRequest("User not authenticated");
        }

        const user = await strapi
          .query("plugin::users-permissions.user")
          .findOne({
            where: { id: userId },
          });

        if (!user?.subscriptionId) {
          return ctx.notFound("No active subscription found for user");
        }

        const updatedSubscription = (await stripe.subscriptions.update(
          user.subscriptionId,
          {
            cancel_at_period_end: true,
          },
        )) as any;

        const subscriptionRecord = await strapi
          .query("api::subscription.subscription")
          .findOne({
            where: { subscriptionId: user.subscriptionId },
          });

        if (subscriptionRecord) {
          await strapi.query("api::subscription.subscription").update({
            where: { id: subscriptionRecord.id },
            data: {
              currentPeriodEnd: new Date(
                (updatedSubscription.current_period_end as number) * 1000,
              ).toISOString(),
              period_end: new Date(
                (updatedSubscription.current_period_end as number) * 1000,
              ),
            },
          });
        }

        await strapi.query("plugin::users-permissions.user").update({
          where: { id: userId },
          data: {
            currentPeriodEnd: new Date(
              (updatedSubscription.current_period_end as number) * 1000,
            ).toISOString(),
          },
        });

        ctx.send({
          message: "Subscription will cancel at period end",
          subscriptionId: updatedSubscription.id,
          status: user.subscriptionStatus || updatedSubscription.status,
          cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
          currentPeriodEnd: new Date(
            (updatedSubscription.current_period_end as number) * 1000,
          ).toISOString(),
        });
      } catch (err: any) {
        strapi.log.error("Cancel subscription error:", err);
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
