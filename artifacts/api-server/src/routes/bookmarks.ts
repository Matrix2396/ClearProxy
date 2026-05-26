import { Router } from "express";
import { db, bookmarksTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { insertBookmarkSchema } from "@workspace/db";

const router = Router();

router.get("/bookmarks", async (_req, res) => {
  try {
    const bookmarks = await db
      .select()
      .from(bookmarksTable)
      .orderBy(desc(bookmarksTable.createdAt));
    res.json(bookmarks);
  } catch {
    res.json([]);
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
  } catch {
    res.status(503).json({ error: "Database not configured — add DATABASE_URL to enable bookmarks" });
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
  } catch {
    res.json({ success: true });
  }
});

export default router;
