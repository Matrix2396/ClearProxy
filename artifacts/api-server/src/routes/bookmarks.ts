import { Router } from "express";
import { db, bookmarksTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { insertBookmarkSchema } from "@workspace/db";
import { z } from "zod/v4";

const router = Router();

router.get("/bookmarks", async (req, res) => {
  try {
    const bookmarks = await db
      .select()
      .from(bookmarksTable)
      .orderBy(desc(bookmarksTable.createdAt));
    res.json(bookmarks);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch bookmarks");
    res.status(500).json({ error: "Failed to fetch bookmarks" });
  }
});

router.post("/bookmarks", async (req, res) => {
  try {
    const parsed = insertBookmarkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    const [bookmark] = await db.insert(bookmarksTable).values(parsed.data).returning();
    res.status(201).json(bookmark);
  } catch (err) {
    req.log.error({ err }, "Failed to create bookmark");
    res.status(500).json({ error: "Failed to create bookmark" });
  }
});

router.delete("/bookmarks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid bookmark ID" });
      return;
    }
    await db.delete(bookmarksTable).where(eq(bookmarksTable.id, id));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete bookmark");
    res.status(500).json({ error: "Failed to delete bookmark" });
  }
});

export default router;
