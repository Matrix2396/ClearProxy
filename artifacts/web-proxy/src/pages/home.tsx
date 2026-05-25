import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Star,
  History,
  Bookmark as BookmarkIcon,
  X,
  Search,
  PanelRight,
  ShieldAlert,
  Shield,
} from "lucide-react";
import {
  useListHistory,
  useClearHistory,
  useListBookmarks,
  useCreateBookmark,
  useDeleteBookmark,
  getListHistoryQueryKey,
  getListBookmarksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

function ensureProtocol(url: string): string {
  if (!url.trim()) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function extractOriginalFromProxyUrl(href: string): string {
  try {
    const u = new URL(href, window.location.href);
    const param = u.searchParams.get("url");
    return param || href;
  } catch {
    return href;
  }
}

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Back/forward nav stack: list of visited original URLs, current index
  const [navStack, setNavStack] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: history = [] } = useListHistory();
  const { data: bookmarks = [] } = useListBookmarks();

  const clearHistory = useClearHistory();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();

  // Listen for postMessage from the proxied iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== "proxy-navigate") return;
      const { url, title } = e.data as { type: string; url: string; title?: string };
      if (!url) return;

      // Update address bar with the ORIGINAL url
      const original = url.startsWith("/api/proxy") ? extractOriginalFromProxyUrl(url) : url;
      setUrlInput(original);
      setCurrentUrl(original);
      setIsLoading(false);

      // Record history
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: original, title: title || null }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() }))
        .catch(() => {});
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [queryClient]);

  const loadUrl = useCallback(
    (url: string, pushToStack = true) => {
      const full = ensureProtocol(url);
      if (!full) return;
      setUrlInput(full);
      setCurrentUrl(full);
      setIsLoading(true);

      if (pushToStack) {
        setNavStack((prev) => {
          const trimmed = prev.slice(0, navIndex + 1);
          return [...trimmed, full];
        });
        setNavIndex((prev) => prev + 1);
      }
    },
    [navIndex]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadUrl(urlInput);
  };

  const handleBack = () => {
    if (navIndex <= 0) return;
    const newIndex = navIndex - 1;
    setNavIndex(newIndex);
    const url = navStack[newIndex];
    setUrlInput(url);
    setCurrentUrl(url);
    setIsLoading(true);
  };

  const handleForward = () => {
    if (navIndex >= navStack.length - 1) return;
    const newIndex = navIndex + 1;
    setNavIndex(newIndex);
    const url = navStack[newIndex];
    setUrlInput(url);
    setCurrentUrl(url);
    setIsLoading(true);
  };

  const handleRefresh = () => {
    if (!iframeRef.current || !currentUrl) return;
    setIsLoading(true);
    const src = iframeRef.current.src;
    iframeRef.current.src = "about:blank";
    requestAnimationFrame(() => {
      if (iframeRef.current) iframeRef.current.src = src;
    });
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const isBookmarked = bookmarks.some((b) => b.url === currentUrl);

  const toggleBookmark = () => {
    if (!currentUrl) return;
    if (isBookmarked) {
      const bookmark = bookmarks.find((b) => b.url === currentUrl);
      if (bookmark) {
        deleteBookmark.mutate(
          { id: bookmark.id },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }) }
        );
      }
    } else {
      createBookmark.mutate(
        { data: { url: currentUrl } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }) }
      );
    }
  };

  const handleClearHistory = () => {
    clearHistory.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
        toast({ title: "History cleared" });
      },
    });
  };

  const isHttps = currentUrl.startsWith("https://");
  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navStack.length - 1;

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden font-mono">
      {/* Browser Chrome */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-card shrink-0">
        {/* Nav controls */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleBack}
            disabled={!canGoBack}
            data-testid="button-back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleForward}
            disabled={!canGoForward}
            data-testid="button-forward"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground disabled:opacity-30"
            onClick={handleRefresh}
            disabled={!currentUrl}
            data-testid="button-refresh"
          >
            <RotateCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Address bar */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center relative">
          <span className="absolute left-3 text-muted-foreground pointer-events-none">
            {currentUrl ? (
              isHttps ? (
                <Shield className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-yellow-500" />
              )
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </span>
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter a URL or search"
            className="w-full pl-9 pr-9 h-9 bg-secondary border-transparent focus-visible:border-primary focus-visible:ring-0 text-sm"
            data-testid="input-url"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          {currentUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 h-7 w-7 text-muted-foreground hover:text-primary transition-colors"
              onClick={toggleBookmark}
              data-testid="button-bookmark"
              title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
            >
              <Star className={`h-3.5 w-3.5 ${isBookmarked ? "fill-primary text-primary" : ""}`} />
            </Button>
          )}
        </form>

        {/* Sidebar toggle */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              data-testid="button-sidebar"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </SheetTrigger>

          <SheetContent side="right" className="w-80 p-0 border-l border-border bg-card flex flex-col">
            <Tabs defaultValue="history" className="flex flex-col h-full">
              <TabsList className="w-full rounded-none border-b border-border bg-transparent p-0 h-11 shrink-0">
                <TabsTrigger
                  value="history"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full text-xs uppercase tracking-wider font-semibold"
                >
                  <History className="h-3.5 w-3.5 mr-2" />
                  History
                </TabsTrigger>
                <TabsTrigger
                  value="bookmarks"
                  className="flex-1 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none h-full text-xs uppercase tracking-wider font-semibold"
                >
                  <BookmarkIcon className="h-3.5 w-3.5 mr-2" />
                  Bookmarks
                </TabsTrigger>
              </TabsList>

              {/* History */}
              <TabsContent value="history" className="flex-1 overflow-hidden m-0 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                    Recent
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearHistory}
                    className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                    data-testid="button-clear-history"
                  >
                    Clear all
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                      <History className="h-8 w-8 opacity-15" />
                      <span className="text-xs">No history yet</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {history.map((entry) => (
                        <button
                          key={entry.id}
                          className="w-full text-left p-3 hover:bg-secondary/60 flex items-start gap-3 transition-colors group"
                          onClick={() => { loadUrl(entry.url); setSidebarOpen(false); }}
                          data-testid={`history-entry-${entry.id}`}
                        >
                          <div className="h-7 w-7 bg-secondary rounded flex items-center justify-center shrink-0 mt-0.5">
                            {entry.favicon ? (
                              <img src={entry.favicon} alt="" className="h-4 w-4" />
                            ) : (
                              <History className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate leading-tight">{entry.title || entry.url}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{entry.url}</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-1">
                              {format(new Date(entry.visitedAt), "MMM d, h:mm a")}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Bookmarks */}
              <TabsContent value="bookmarks" className="flex-1 overflow-hidden m-0 flex flex-col min-h-0">
                <div className="flex items-center px-4 py-2 border-b border-border shrink-0">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Saved</span>
                </div>
                <ScrollArea className="flex-1">
                  {bookmarks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                      <Star className="h-8 w-8 opacity-15" />
                      <span className="text-xs">No bookmarks yet</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {bookmarks.map((bookmark) => (
                        <div
                          key={bookmark.id}
                          className="flex items-center gap-3 p-3 hover:bg-secondary/60 group transition-colors"
                          data-testid={`bookmark-entry-${bookmark.id}`}
                        >
                          <button
                            className="h-7 w-7 bg-secondary rounded flex items-center justify-center shrink-0"
                            onClick={() => { loadUrl(bookmark.url); setSidebarOpen(false); }}
                          >
                            {bookmark.favicon ? (
                              <img src={bookmark.favicon} alt="" className="h-4 w-4" />
                            ) : (
                              <Star className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            className="flex-1 min-w-0 text-left"
                            onClick={() => { loadUrl(bookmark.url); setSidebarOpen(false); }}
                          >
                            <p className="text-sm font-medium truncate">{bookmark.title || bookmark.url}</p>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{bookmark.url}</p>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBookmark.mutate(
                                { id: bookmark.id },
                                {
                                  onSuccess: () =>
                                    queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() }),
                                }
                              );
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </SheetContent>
        </Sheet>
      </div>

      {/* Loading bar */}
      {isLoading && currentUrl && (
        <div className="h-[2px] bg-secondary shrink-0 overflow-hidden">
          <div className="h-full bg-primary" style={{ animation: "proxyProgress 1.2s ease-in-out infinite" }} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">
        {!currentUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-muted-foreground select-none">
            <ShieldAlert className="h-14 w-14 opacity-10" />
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight text-foreground/60 mb-1">ClearProxy</h1>
              <p className="text-sm text-muted-foreground/60">Enter a URL above to begin browsing</p>
            </div>
            {/* Quick links */}
            <div className="flex flex-wrap gap-2 justify-center mt-4 max-w-sm">
              {["wikipedia.org", "reddit.com", "github.com", "news.ycombinator.com"].map((site) => (
                <button
                  key={site}
                  onClick={() => loadUrl(`https://${site}`)}
                  className="px-3 py-1.5 text-xs bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground transition-colors border border-border"
                >
                  {site}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={currentUrl}
            src={`/api/proxy?url=${encodeURIComponent(currentUrl)}`}
            className="w-full h-full border-none block"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            onLoad={handleIframeLoad}
            title="Proxy View"
            data-testid="proxy-iframe"
          />
        )}
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes proxyProgress {
            0%   { width: 0%; margin-left: 0%; }
            50%  { width: 60%; margin-left: 20%; }
            100% { width: 0%; margin-left: 100%; }
          }
        `,
      }} />
    </div>
  );
}
