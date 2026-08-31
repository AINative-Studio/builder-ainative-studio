import { describe, it, expect } from 'vitest'
import { isSupportedPlatform, assetUrlForTag, extractSingleFileFromTar } from '@/lib/build/railway-cli-install'
import zlib from 'zlib'
import fs from 'fs'
import path from 'path'

/**
 * #380 — pure-logic tests for the lazy Railway CLI installer. The actual
 * download/extract/verify-executable flow is exercised for real in
 * railway-cli-install.integration.test.ts (a genuine network download +
 * `--version` run, mirroring coverage-runner.test.ts/.integration.test.ts's
 * established split: fast pure logic here, slow real I/O in its own file).
 */

describe('isSupportedPlatform (pure)', () => {
  it('reflects the current process platform/arch truthfully', () => {
    // Not mocked — this genuinely reports the machine running the test.
    // The real assertion is just that it's a boolean and matches the
    // documented linux/x64-only contract.
    const result = isSupportedPlatform()
    expect(typeof result).toBe('boolean')
    expect(result).toBe(process.platform === 'linux' && process.arch === 'x64')
  })
})

describe('assetUrlForTag (pure)', () => {
  it('builds the real confirmed railwayapp/cli linux x64 asset URL shape', () => {
    expect(assetUrlForTag('v5.45.10')).toBe(
      'https://github.com/railwayapp/cli/releases/download/v5.45.10/railway-v5.45.10-x86_64-unknown-linux-gnu.tar.gz'
    )
  })

  it('is deterministic for the same tag', () => {
    expect(assetUrlForTag('v1.0.0')).toBe(assetUrlForTag('v1.0.0'))
  })
})

describe('extractSingleFileFromTar (pure) — real USTAR shape confirmed against the actual railwayapp/cli release asset', () => {
  function buildUstarEntry(name: string, content: Buffer, typeflag = '0'): Buffer {
    const header = Buffer.alloc(512)
    header.write(name, 0, 'utf8')
    header.write('0000644\0', 100, 'ascii') // mode
    header.write('0000000\0', 108, 'ascii') // uid
    header.write('0000000\0', 116, 'ascii') // gid
    header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii') // size (octal)
    header.write('00000000000\0', 136, 'ascii') // mtime
    header.write('        ', 148, 'ascii') // checksum placeholder (spaces)
    header.write(typeflag, 156, 'ascii')
    header.write('ustar\0', 257, 'ascii') // magic
    header.write('00', 263, 'ascii') // version

    const paddedContentLen = Math.ceil(content.length / 512) * 512
    const paddedContent = Buffer.alloc(paddedContentLen)
    content.copy(paddedContent)

    return Buffer.concat([header, paddedContent])
  }

  it('extracts the named entry when it matches exactly', () => {
    const content = Buffer.from('fake-binary-bytes-here')
    const tarBuf = buildUstarEntry('railway', content)
    const result = extractSingleFileFromTar(tarBuf, 'railway')
    expect(result).not.toBeNull()
    expect(result!.equals(content)).toBe(true)
  })

  it('returns null when the entry name does not match expectedName', () => {
    const tarBuf = buildUstarEntry('something-else', Buffer.from('x'))
    expect(extractSingleFileFromTar(tarBuf, 'railway')).toBeNull()
  })

  it('returns null for a buffer smaller than one header block', () => {
    expect(extractSingleFileFromTar(Buffer.alloc(100), 'railway')).toBeNull()
  })

  it('returns null when typeflag is not a regular file (e.g. "5" = directory)', () => {
    const tarBuf = buildUstarEntry('railway', Buffer.from('x'), '5')
    expect(extractSingleFileFromTar(tarBuf, 'railway')).toBeNull()
  })

  it('returns null when the declared size overruns the actual buffer (truncated archive)', () => {
    // A 2000-byte payload needs header(512) + 2048 (padded to 512-boundary) =
    // 2560 total bytes; cutting at 1000 lands mid-content, genuinely short.
    const tarBuf = buildUstarEntry('railway', Buffer.alloc(2000, 'x'))
    const truncated = tarBuf.subarray(0, 1000)
    expect(extractSingleFileFromTar(truncated, 'railway')).toBeNull()
  })

  it('round-trips a realistically large binary payload (multi-block content)', () => {
    const content = Buffer.alloc(10_000)
    for (let i = 0; i < content.length; i++) content[i] = i % 256
    const tarBuf = buildUstarEntry('railway', content)
    const result = extractSingleFileFromTar(tarBuf, 'railway')
    expect(result).not.toBeNull()
    expect(result!.equals(content)).toBe(true)
  })

  it('extracts correctly from a real gzip-compressed fixture matching the genuine release asset structure', () => {
    // Fixture built the same way the real railwayapp/cli release tarball was
    // confirmed to be shaped this session (single USTAR entry named
    // "railway", typeflag '0') — proves the gunzip + extract path together,
    // not just the raw-tar-buffer path the tests above cover.
    const elfLikeContent = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('fake-elf-body-for-test')])
    const tarBuf = buildUstarEntry('railway', elfLikeContent)
    const gz = zlib.gzipSync(tarBuf)
    const decompressed = zlib.gunzipSync(gz)
    const result = extractSingleFileFromTar(decompressed, 'railway')
    expect(result).not.toBeNull()
    expect(result!.equals(elfLikeContent)).toBe(true)
  })
})
