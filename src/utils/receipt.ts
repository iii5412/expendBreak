const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface PreparedReceiptImage {
  blob: Blob;
  mimeType: string;
  previewUrl: string;
}

export function normalizeTags(value: string | string[]) {
  const source = Array.isArray(value) ? value : value.split(/[,#]/);
  return [...new Set(source.map(tag => tag.trim()).filter(Boolean).map(tag => tag.slice(0, 30)))].slice(0, 10);
}

export function receiptImageAcceptText() {
  return 'JPG, PNG 또는 WEBP 형식의 10MB 이하 이미지를 선택해 주세요.';
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다. 다른 사진을 선택해 주세요.'));
    };
    image.src = url;
  });
}

export async function prepareReceiptImage(file: File): Promise<PreparedReceiptImage> {
  if (!ACCEPTED_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error(receiptImageAcceptText());
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지 처리 기능을 사용할 수 없습니다.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('이미지 압축에 실패했습니다.')), 'image/jpeg', 0.86);
  });
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('압축 후 이미지가 8MB를 초과합니다. 더 작은 사진을 선택해 주세요.');
  return { blob, mimeType: 'image/jpeg', previewUrl: URL.createObjectURL(blob) };
}

export async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
