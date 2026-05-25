import { Router } from "express";
import { db, historyTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { z } from "zod/v4";
import { insertHistorySchema } from "@workspace/db";

const router = Router();

router.get("/history", async (req, res) => {
  try {
    const entries = await db
      .select()
      .from(historyTable)
      .orderBy(desc(historyTable.visitedAt))
      .limit(100);
    res.json(entries);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch history");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.post("/history", async (req, res) => {
  try {
    const parsed = insertHistorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [entry] = await db.insert(historyTable).values(parsed.data).returning();
    res.status(201).json(entry);
  } catch (err) {
    req.log.error({ err }, "Failed to record history");
    res.status(500).json({ error: "Failed to record history" });
  }
});

router.delete("/history", async (req, res) => {
  try {
    await db.delete(historyTable);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to clear history");
    res.status(500).json({ error: "Failed to clear history" });
  }
});

export default router;
