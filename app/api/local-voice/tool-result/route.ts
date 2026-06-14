import { proxyLocalVoiceRequest } from "../../../lib/local-voice-proxy";

export async function POST(request: Request) {
  return proxyLocalVoiceRequest(request, "/voice/tool-result");
}
