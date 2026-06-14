const defaultLocalVoiceTarget = "http://127.0.0.1:8766";

function getLocalVoiceTarget(pathname: string) {
  const target = (process.env.LOCAL_VOICE_PROXY_TARGET ?? defaultLocalVoiceTarget)
    .trim()
    .replace(/\/+$/, "");

  return `${target}${pathname}`;
}

function createProxyHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("accept-encoding");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("host");
  return headers;
}

export async function proxyLocalVoiceRequest(request: Request, pathname: string) {
  const init: RequestInit & { duplex?: "half" } = {
    cache: "no-store",
    headers: createProxyHeaders(request),
    method: request.method,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;

  try {
    upstream = await fetch(getLocalVoiceTarget(pathname), init);
  } catch {
    return Response.json(
      {
        error:
          "无法连接本地语音服务代理目标。请确认已运行 npm run voice:local，或设置 LOCAL_VOICE_PROXY_TARGET。",
      },
      { status: 502 },
    );
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const cacheControl = upstream.headers.get("cache-control");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  headers.set("cache-control", cacheControl ?? "no-store");

  return new Response(upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
