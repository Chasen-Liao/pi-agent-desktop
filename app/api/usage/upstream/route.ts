import { getRequestId, jsonError, logApiError, errorMessage } from "../../../../lib/api-error.ts";
import { getUpstreamProviderUsage, getAllUpstreamUsage } from "../../../../lib/upstream-usage/service.ts";

export const dynamic = "force-dynamic";

interface UsageRouteDependencies {
  getProviderUsage: typeof getUpstreamProviderUsage;
  getAllUsage: typeof getAllUpstreamUsage;
}

export function createUsageGetHandler(
  dependencies: UsageRouteDependencies = {
    getProviderUsage: getUpstreamProviderUsage,
    getAllUsage: getAllUpstreamUsage,
  }
) {
  return async function GET(req: Request) {
    const requestId = getRequestId(req);
    try {
      const url = new URL(req.url);
      const providerId = url.searchParams.get("provider");
      const forceRefresh =
        url.searchParams.get("refresh") === "1" ||
        url.searchParams.get("refresh") === "true";

      if (providerId) {
        const usage = await dependencies.getProviderUsage(providerId, { forceRefresh });
        return Response.json(
          { data: usage ? [usage] : [] },
          { headers: { "x-request-id": requestId } }
        );
      }

      const allUsages = await dependencies.getAllUsage({ forceRefresh });
      return Response.json(
        { data: allUsages },
        { headers: { "x-request-id": requestId } }
      );
    } catch (error) {
      logApiError({ route: "/api/usage/upstream", method: "GET", requestId, error });
      return jsonError(req, 500, errorMessage(error));
    }
  };
}

export const GET = createUsageGetHandler();
