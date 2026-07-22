export async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "请求失败，请稍后重试");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ({ target }) => resolve(target.result);
    reader.onerror = () => reject(new Error("无法读取图片，请重新选择"));
    reader.readAsDataURL(file);
  });
}
