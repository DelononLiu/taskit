const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'
const REQUEST_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  constructor(public code: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`
  const { headers: optHeaders, signal: extSignal, ...rest } = options || {}

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  // 如果调用方也传了 signal，任一 abort 都触发
  if (extSignal) {
    extSignal.addEventListener('abort', () => controller.abort())
  }

  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(optHeaders as Record<string, string>) },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body.message || `Request failed: ${res.status}`)
    }

    return res.json()
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new ApiError(0, '请求超时，请检查网络连接')
    }
    throw e
  } finally {
    clearTimeout(timeout)
  }
}

export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, { method: 'GET', ...options }),
  post: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...options }),
  upload: <T>(path: string, file: File, onProgress?: (pct: number) => void) => {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE_URL}${path}`)
      xhr.timeout = 60_000 // 上传超时 60s（文件可能较大）

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          reject(new ApiError(xhr.status, 'Upload failed'))
        }
      }

      xhr.onerror = () => reject(new ApiError(0, '网络错误'))
      xhr.ontimeout = () => reject(new ApiError(0, '上传超时，请检查网络连接'))
      const formData = new FormData()
      formData.append('file', file)
      xhr.send(formData)
    })
  },
}
