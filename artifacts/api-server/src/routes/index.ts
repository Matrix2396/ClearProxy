import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import historyRouter from "./history";
import bookmarksRouter from "./bookmarks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(proxyRouter);
router.use(historyRouter);
router.use(bookmarksRouter);

export default router;
