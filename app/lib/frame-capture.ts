export type CapturedFrame = {
  dataUrl: string;
  mimeType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  sizeBytes: number;
  quality: number;
  capturedAt: string;
};

export type FrameCaptureOptions = {
  maxWidth?: number;
  quality?: number;
  preferredMimeType?: "image/webp" | "image/jpeg";
};

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: CapturedFrame["mimeType"],
  quality: number,
) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("无法读取压缩后的图片数据。"));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

export async function captureCompressedFrame(
  video: HTMLVideoElement,
  options: FrameCaptureOptions = {},
): Promise<CapturedFrame> {
  const originalWidth = video.videoWidth;
  const originalHeight = video.videoHeight;

  if (!originalWidth || !originalHeight) {
    throw new Error("摄像头画面尚未准备好，请稍后再试。");
  }

  const maxWidth = options.maxWidth ?? 768;
  const quality = options.quality ?? 0.76;
  const preferredMimeType = options.preferredMimeType ?? "image/webp";
  const scale = Math.min(1, maxWidth / originalWidth);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("当前浏览器无法创建 canvas 上下文。");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);

  const firstBlob = await canvasToBlob(canvas, preferredMimeType, quality);
  const mimeType =
    firstBlob?.type === preferredMimeType ? preferredMimeType : "image/jpeg";
  const blob =
    firstBlob?.type === preferredMimeType
      ? firstBlob
      : await canvasToBlob(canvas, "image/jpeg", quality);

  if (!blob) {
    throw new Error("图片压缩失败，请检查浏览器 canvas 支持。");
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    mimeType,
    width,
    height,
    originalWidth,
    originalHeight,
    sizeBytes: blob.size,
    quality,
    capturedAt: new Date().toISOString(),
  };
}
