import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { apiLimiter } from "./middlewares/rateLimit";
import router from "./routes";
import geoRouter from "./routes/geo";
import webhookRouter from "./routes/webhook";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust proxy so rate limiter sees real client IPs through Replit's reverse proxy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));

// Stripe webhook MUST receive the raw body for signature verification — mount
// it BEFORE express.json() so the body parser doesn't consume the stream.
app.use("/api", webhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Map tile + geocoding proxy. Mounted BEFORE the global API limiter because a
// single map view fetches many tiles; it carries its own generous limiter.
app.use("/api", geoRouter);

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Light global rate limit on the API surface (excludes webhook above).
app.use("/api", apiLimiter);
app.use("/api", router);

export default app;
