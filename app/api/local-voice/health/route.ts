import { proxyLocalVoiceRequest } from "../../../lib/local-voice-proxy";

export async function GET(request: Request) {
  return proxyLocalVoiceRequest(request, "/health");
}
