import { Router, type IRouter } from "express";
import { isResendConfigured } from "../lib/resendClient";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const resendReachable = await isResendConfigured();
  res.json({
    status: "ok",
    // Keep the established response key stable for existing dashboard and
    // monitoring consumers while delivery now uses the direct connector.
    resendService: { reachable: resendReachable },
  });
});

export default router;
