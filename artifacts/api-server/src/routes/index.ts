import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import historyRouter from "./history";
import bookmarksRouter from "./bookmarks";
import cookiesRouter from "./cookies";

const router: IRouter = Router();

// Health, history, bookmarks, and cookies must come BEFORE proxyRouter —
// proxyRouter has a catch-all GET /.*/ that would swallow these routes.
router.use(healthRouter);
router.use(historyRouter);
router.use(bookmarksRouter);
router.use(cookiesRouter);
router.use(proxyRouter);

export default router;
