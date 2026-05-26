import { Router } from "express";
import {
  getAllStoredCookies,
  setStoredCookies,
  deleteStoredCookies,
} from "../lib/cookie-store";

const router = Router();

router.get("/cookies", (_req, res) => {
  res.json(getAllStoredCookies());
});

router.post("/cookies", (req, res) => {
  const { hostname, cookies } = req.body as { hostname?: string; cookies?: string };
  if (!hostname || typeof hostname !== "string" || !cookies || typeof cookies !== "string") {
    res.status(400).json({ error: "hostname and cookies are required" });
    return;
  }
  setStoredCookies(hostname.trim().toLowerCase(), cookies.trim());
  res.json({ success: true });
});

router.delete("/cookies/:hostname", (req, res) => {
  deleteStoredCookies(req.params.hostname.toLowerCase());
  res.json({ success: true });
});

export default router;
