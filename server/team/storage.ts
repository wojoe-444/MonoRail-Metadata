import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * The shared bucket, as the app sees it (docs/team-backend.md). The app only
 * reads, and creates request files in inbox/; the worker writes everything else.
 *
 * `TEAM_BUCKET` is either `gs://bucket/prefix` (Google Cloud Storage) or a local
 * folder (one machine, for development). Both behave the same.
 */
export interface Bucket {
  readonly label: string
  /** The object's bytes, or undefined if it doesn't exist. */
  read(key: string): Promise<Buffer | undefined>
  /** Create the object only if nothing is there yet. Returns false if it already existed. */
  createIfAbsent(key: string, data: Buffer | string, contentType?: string): Promise<boolean>
}

export async function readJson<T>(bucket: Bucket, key: string): Promise<T | undefined> {
  const buf = await bucket.read(key)
  if (!buf) return undefined
  const raw = key.endsWith('.gz') ? gunzipSync(buf) : buf
  return JSON.parse(raw.toString('utf8')) as T
}

export function openBucket(spec: string, accessToken?: () => Promise<string>): Bucket {
  if (spec.startsWith('gs://')) {
    if (!accessToken) throw new Error('A gs:// bucket needs Google credentials')
    return new GcsBucket(spec, accessToken)
  }
  return new LocalBucket(spec.replace(/^file:\/\//, ''))
}

class LocalBucket implements Bucket {
  readonly label: string
  constructor(private readonly root: string) {
    this.label = path.resolve(root)
  }

  private file(key: string) {
    const f = path.resolve(this.root, key)
    const rel = path.relative(this.root, f)
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Key escapes the bucket: ${key}`)
    return f
  }

  async read(key: string) {
    try {
      return await fs.readFile(this.file(key))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }

  async createIfAbsent(key: string, data: Buffer | string) {
    const f = this.file(key)
    await fs.mkdir(path.dirname(f), { recursive: true })
    // Write to a temp file, then link it into place: the link fails if the name exists,
    // so creation is atomic and a reader never sees a half-written request.
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, data)
    try {
      await fs.link(tmp, f)
      return true
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EEXIST') return false
      // Filesystems without hard links: fall back to an exclusive create.
      if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EXDEV') {
        try {
          await fs.writeFile(f, data, { flag: 'wx' })
          return true
        } catch (e2) {
          if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false
          throw e2
        }
      }
      throw e
    } finally {
      await fs.rm(tmp, { force: true })
    }
  }
}

/** Google Cloud Storage through its JSON API, with the signed-in person's access token. */
class GcsBucket implements Bucket {
  readonly label: string
  private readonly bucket: string
  private readonly prefix: string

  constructor(
    spec: string,
    private readonly token: () => Promise<string>,
  ) {
    const [bucket, ...rest] = spec.replace(/^gs:\/\//, '').split('/')
    this.bucket = bucket!
    this.prefix = rest.filter(Boolean).join('/')
    this.label = spec
  }

  private name(key: string) {
    return this.prefix ? `${this.prefix}/${key}` : key
  }

  async read(key: string) {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.name(key))}?alt=media`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.token()}` }, cache: 'no-store' })
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error(`GCS read ${key}: ${res.status} ${await res.text()}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async createIfAbsent(key: string, data: Buffer | string, contentType = 'application/json') {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(this.name(key))}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': contentType },
      body: typeof data === 'string' ? data : new Uint8Array(data),
    })
    if (res.status === 412) return false
    if (!res.ok) throw new Error(`GCS create ${key}: ${res.status} ${await res.text()}`)
    return true
  }
}
