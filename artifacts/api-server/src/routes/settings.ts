import { Router } from "express";
import { UA_PRESETS, getSelectedUaKey, setSelectedUaKey } from "../lib/ua-store";

const router = Router();

router.get("/settings", (_req, res) => {
  res.json({
    uaKey: getSelectedUaKey(),
    uaPresets: Object.entries(UA_PRESETS).map(([key, val]) => ({
      key,
      label: val.label,
    })),
  });
});

router.put("/settings/ua", (req, res) => {
  const { key } = req.body as { key?: string };
  if (!key || typeof key !== "string") {
    res.status(400).json({ error: "Missing key" });
    return;
  }
  const ok = setSelectedUaKey(key);
  if (!ok) {
    res.status(400).json({ error: "Invalid UA key" });
    return;
  }
  res.json({ uaKey: key });
});

export default router;
