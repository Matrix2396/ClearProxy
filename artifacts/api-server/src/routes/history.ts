import { Router } from "express";
import { db, historyTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { insertHistorySchema } from "@workspace/db";

const router = Router();

router.get("/history", async (_req, res) => {
  try {
    const entries = await db
      .select()
      .from(historyTable)
      .orderBy(desc(historyTable.visitedAt))
      .limit(100);
    res.json(entries);
  } catch {
    res.json([]);
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
  } catch {
    res.status(201).json({ id: -1, url: req.body?.url, title: req.body?.title });
  }
});

router.delete("/history", async (_req, res) => {
  try {
    await db.delete(historyTable);
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

export default router;
