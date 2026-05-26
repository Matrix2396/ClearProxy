import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  useEffect(() => {
    // If we landed here from inside a proxied SPA (e.g. chess.com pushed
    // /play/online via pushState and something triggered a full navigation),
    // recover by redirecting back through the proxy using the stored origin.
    try {
      const origin = sessionStorage.getItem("__px_origin__");
      if (origin) {
        const reconstructed =
          origin +
          window.location.pathname +
          window.location.search +
          window.location.hash;
        window.location.replace(
          "/api/proxy?url=" + encodeURIComponent(reconstructed)
        );
        return;
      }
    } catch {}
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
