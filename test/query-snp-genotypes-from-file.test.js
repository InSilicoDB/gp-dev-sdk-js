const assert = require('node:assert/strict')
const fsSync = require('fs')
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const test = require('node:test')
const zlib = require('zlib')

const DeveloperAPI = require('../index')

const fixturesDir = path.join(__dirname, 'fixtures')

function jsonResponse (body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

async function readFixture (filename) {
  return fs.readFile(path.join(fixturesDir, filename))
}

function installFetchMock (t, api, handler) {
  const originalFetch = global.fetch
  global.fetch = handler
  t.after(() => {
    global.fetch = originalFetch
    api.cleanupFiles()
  })
}

async function mockArchiveFetch (t, api, { datasetId, token, fileUrls, downloads }) {
  const fetchCalls = []

  installFetchMock(t, api, async (input, init = {}) => {
    const url = input instanceof URL ? input.toString() : String(input)
    fetchCalls.push({ url, init })

    if (url === `https://api.example.test/datasets/${datasetId}/files`) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`)
      return jsonResponse({ data: fileUrls })
    }

    if (Object.hasOwn(downloads, url)) {
      const download = downloads[url]
      return download instanceof Response
        ? download
        : new Response(download, { status: 200 })
    }

    throw new Error(`Unexpected fetch to ${url}`)
  })

  return fetchCalls
}

test('querySNPGenotypesFromFile reads SNP genotypes from a gen.zip archive', async t => {
  const datasetId = 'dataset-gen'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')
  const archiveBuffer = await readFixture('sample.gen.zip')
  const fetchCalls = await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/sample.gen.zip' }
    ],
    downloads: {
      'https://files.example.test/sample.gen.zip': archiveBuffer
    }
  })

  const genotypes = await api.querySNPGenotypesFromFile(token, datasetId, ['rs1', 'rs2'])

  assert.deepEqual(Object.fromEntries(genotypes), {
    rs1: 'AG',
    rs2: 'TT'
  })
  assert.equal(fetchCalls.length, 2)
})

test('querySNPGenotypesFromFile falls back to a vcf.zip archive', async t => {
  const datasetId = 'dataset-vcf'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')
  const archiveBuffer = await readFixture('sample.vcf.zip')
  const fetchCalls = await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/sample.vcf.zip' }
    ],
    downloads: {
      'https://files.example.test/sample.vcf.zip': archiveBuffer
    }
  })

  const genotypes = await api.querySNPGenotypesFromFile(token, datasetId, ['rsVcf1', 'rsVcf2'])

  assert.deepEqual(Object.fromEntries(genotypes), {
    rsVcf1: 'AG',
    rsVcf2: 'TT'
  })
  assert.equal(fetchCalls.length, 2)
})

test('querySNPGenotypesFromFile throws when no supported archive is available', async t => {
  const datasetId = 'dataset-missing-archive'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')

  await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/readme.txt' }
    ],
    downloads: {}
  })

  await assert.rejects(
    api.querySNPGenotypesFromFile(token, datasetId, ['rs1']),
    /No \.gen\.zip or \.vcf\.zip file found/
  )
})

test('querySNPGenotypesFromFile prefers gen.zip when both archives are present', async t => {
  const datasetId = 'dataset-both'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')
  const genArchiveBuffer = await readFixture('sample.gen.zip')
  let vcfDownloaded = false

  const fetchCalls = await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/sample.vcf.zip' },
      { id: 'https://files.example.test/sample.gen.zip' }
    ],
    downloads: {
      'https://files.example.test/sample.gen.zip': genArchiveBuffer,
      'https://files.example.test/sample.vcf.zip': new Response(null, {
        status: 500
      })
    }
  })

  const originalFetch = global.fetch
  global.fetch = async (input, init = {}) => {
    const url = input instanceof URL ? input.toString() : String(input)
    if (url === 'https://files.example.test/sample.vcf.zip') {
      vcfDownloaded = true
    }
    return originalFetch(input, init)
  }

  const genotypes = await api.querySNPGenotypesFromFile(token, datasetId, ['rs1'])

  assert.deepEqual(Object.fromEntries(genotypes), { rs1: 'AG' })
  assert.equal(vcfDownloaded, false)
  assert.equal(fetchCalls.length, 2)
})

test('querySNPGenotypesFromFile returns only requested SNPs that are present', async t => {
  const datasetId = 'dataset-partial'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')
  const archiveBuffer = await readFixture('sample.gen.zip')

  await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/sample.gen.zip' }
    ],
    downloads: {
      'https://files.example.test/sample.gen.zip': archiveBuffer
    }
  })

  const genotypes = await api.querySNPGenotypesFromFile(token, datasetId, ['rs1', 'rs-missing'])

  assert.deepEqual(Object.fromEntries(genotypes), {
    rs1: 'AG'
  })
})

test('querySNPGenotypesFromFile propagates dataset file API failures', async t => {
  const datasetId = 'dataset-api-error'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')

  installFetchMock(t, api, async (input, init = {}) => {
    const url = input instanceof URL ? input.toString() : String(input)
    if (url === `https://api.example.test/datasets/${datasetId}/files`) {
      assert.equal(init.headers.Authorization, `Bearer ${token}`)
      return jsonResponse({ errors: ['nope'] }, 500)
    }
    throw new Error(`Unexpected fetch to ${url}`)
  })

  await assert.rejects(
    api.querySNPGenotypesFromFile(token, datasetId, ['rs1']),
    /Request failed with status 500/
  )
})

test('querySNPGenotypesFromFile propagates archive download failures', async t => {
  const datasetId = 'dataset-download-error'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')

  await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/sample.gen.zip' }
    ],
    downloads: {
      'https://files.example.test/sample.gen.zip': new Response(null, {
        status: 404
      })
    }
  })

  await assert.rejects(
    api.querySNPGenotypesFromFile(token, datasetId, ['rs1']),
    /Failed to download file/
  )
})

test('cleanupFiles removes temp directories created during parsing', async t => {
  const datasetId = 'dataset-cleanup'
  const token = 'access-token'
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')
  const archiveBuffer = await readFixture('sample.gen.zip')
  const tempDirs = []
  const originalGetTempDir = api.getTempDir

  api.getTempDir = async function () {
    const tempDir = await originalGetTempDir.call(this)
    tempDirs.push(tempDir)
    return tempDir
  }

  t.after(() => {
    api.getTempDir = originalGetTempDir
  })

  await mockArchiveFetch(t, api, {
    datasetId,
    token,
    fileUrls: [
      { id: 'https://files.example.test/sample.gen.zip' }
    ],
    downloads: {
      'https://files.example.test/sample.gen.zip': archiveBuffer
    }
  })

  await api.querySNPGenotypesFromFile(token, datasetId, ['rs1'])
  await Promise.all(tempDirs.map(tempDir => fs.stat(tempDir)))

  api.cleanupFiles()

  await Promise.all(tempDirs.map(async tempDir => {
    await assert.rejects(fs.stat(tempDir))
  }))
})

test('getGenotypeFromVCFRecord returns null when GT is missing from FORMAT', () => {
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')

  assert.equal(api.getGenotypeFromVCFRecord('A', 'G', 'GP:DS', '0.1,0.8,0.1:0.9'), null)
})

test('getGenotypeFromVCFRecord returns null for missing allele calls', () => {
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')

  assert.equal(api.getGenotypeFromVCFRecord('A', 'G', 'GT:GP:DS', './.:0,0,0:0'), null)
  assert.equal(api.getGenotypeFromVCFRecord('A', 'G', 'GT:GP:DS', '0|.:0,0,0:0'), null)
})

test('getGenotypeFromVCFRecord handles multi-allelic variants', () => {
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')

  assert.equal(api.getGenotypeFromVCFRecord('G', 'A,C', 'GT:GP:DS', '0|2:0,0,0,0,0,0:1'), 'GC')
  assert.equal(api.getGenotypeFromVCFRecord('G', 'A,C', 'GT:GP:DS', '2|2:0,0,0,0,0,0:2'), 'CC')
})

test('getGenotypesFromVCFFiles reads requested SNPs across chromosome files', async () => {
  const api = DeveloperAPI('https://api.example.test', 'client', 'secret')
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gp-dev-sdk-vcf-'))
  const chr10Path = path.join(tempDir, 'chr10.vcf.gz')
  const chr11Path = path.join(tempDir, 'chr11.vcf.gz')
  const chr10 = [
    '##fileformat=VCFv4.2',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001',
    '10\t100\trsChr10\tA\tG\t.\t.\tIMPUTED\tGT:GP:DS\t0|1:0.1,0.8,0.1:0.9'
  ].join('\n')
  const chr11 = [
    '##fileformat=VCFv4.2',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001',
    '11\t200\trsChr11\tC\tT\t.\t.\tIMPUTED\tGT:GP:DS\t1|1:0.05,0.15,0.8:1.95'
  ].join('\n')

  fsSync.writeFileSync(chr10Path, zlib.gzipSync(chr10))
  fsSync.writeFileSync(chr11Path, zlib.gzipSync(chr11))

  try {
    const genotypes = await api.getGenotypesFromVCFFiles(new Set(['rsChr10', 'rsChr11']), tempDir)

    assert.deepEqual(Object.fromEntries(genotypes), {
      rsChr10: 'AG',
      rsChr11: 'TT'
    })
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
})
