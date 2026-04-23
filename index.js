const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const zlib = require('zlib')

const unzip = require('unzipper')
const DeveloperAPIEndpoints = require('./endpoints')

const PATCH = 'PATCH'
const POST = 'POST'
const GET = 'GET'

module.exports = function DeveloperAPI (baseURL, clientName, clientSecret) {
  const endpoints = new DeveloperAPIEndpoints(baseURL)

  let cleanupCallbacks = []

  const api = {
    async request (method, uri, { auth, json, qs, simple = true } = {}) {
      const requestUrl = new URL(uri)
      const headers = {}
      const options = {
        method,
        headers
      }

      if (qs) {
        Object.entries(qs).forEach(([key, value]) => requestUrl.searchParams.append(key, value))
      }
      if (auth && auth.bearer) {
        headers.Authorization = `Bearer ${auth.bearer}`
      }
      if (auth && auth.username) {
        headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
      }
      if (json && json !== true) {
        headers['Content-Type'] = 'application/json'
        options.body = JSON.stringify(json)
      }
      if (json) {
        headers.Accept = 'application/json'
      }

      const response = await fetch(requestUrl, options)
      const responseBody = await response.text()
      const body = responseBody ? JSON.parse(responseBody) : null

      if (!response.ok && simple) {
        const error = new Error(`Request failed with status ${response.status}`)
        error.statusCode = response.status
        error.response = body
        throw error
      }

      return body
    },

    getToken (authorisationCode, attributes) {
      if (typeof attributes === 'undefined' || !attributes) {
        attributes = { // eslint-disable-line no-param-reassign
          grant_type: 'authorization_code',
          code: authorisationCode,
          scope: 'analysis'
        }
      }
      const requestOptions = {
        uri: endpoints.token,
        auth: {
          username: clientName,
          password: clientSecret
        },
        json: {
          data: {
            type: 'token',
            attributes
          }
        }
      }
      return this.request(POST, requestOptions.uri, requestOptions)
    },

    getAdminToken () {
      return this.getToken(null, {
        grant_type: 'client_credentials',
        scope: 'admin'
      })
    },

    /**
     * This method will split the snpNames in a length that is allow for an url.
     * Because the method is an GET we need to have a url less than 2000 chars
    */
    splitIntoQueryable (snpNames) {
      const self = this
      const queryLengthLimit = 1900
      let snpQuery = snpNames.join(' ')
      let snpsToQuery = []
      while (snpQuery.length > queryLengthLimit) {
        const toRemoveLength = (Math.floor(snpNames.length / 10) || 1)
        const removed = snpNames.splice(-toRemoveLength, toRemoveLength)
        snpsToQuery = snpsToQuery.concat(removed)
        snpQuery = snpNames.join(' ')
      }
      if (snpsToQuery.length > 0) {
        const splitted = self.splitIntoQueryable(snpsToQuery)
        return splitted.reduce((a, b) => {
          a.push(b)
          return a
        }, [snpNames])
      }
      return [snpNames]
    },

    querySNPGenotypes (token, datasetId, snpNames, quality = 0.80) {
      const endpointLocation = endpoints.datasetSNPs(datasetId)
      const queries = this.splitIntoQueryable(snpNames)
      let promiseChain = Promise.resolve()
      const response = { data: [] }
      queries.forEach(q => {
        const requestOptions = {
          uri: endpointLocation,
          json: true,
          auth: {
            bearer: token
          },
          qs: {
            names: q.join(' '),
            quality
          }
        }
        promiseChain = promiseChain
          .then(() => this.request(GET, requestOptions.uri, requestOptions))
          .then(body => { response.data = response.data.concat(body.data) })
      })
      return promiseChain.then(() => response)
    },

    getAnalysis (accessToken, analysisId) {
      const requestOptions = {
        uri: endpoints.getAnalysis(analysisId),
        auth: {
          bearer: accessToken
        },
        json: true
      }
      return this.request(GET, requestOptions.uri, requestOptions)
    },

    getEthnicity (accessToken, datasetId) {
      const requestOptions = {
        uri: endpoints.datasetEthnicity(datasetId),
        json: true,
        auth: {
          bearer: accessToken
        }
      }
      return this.request('get', requestOptions.uri, requestOptions)
    },

    addReportPage (accessToken, analysisId, title, content) {
      const requestOptions = {
        uri: endpoints.createReportPage(analysisId),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: 'page',
            attributes: {
              title,
              content
            }
          }
        }
      }
      return this.request('post', requestOptions.uri, requestOptions)
    },

    createAnalysis (accessToken, applicationId, datasetId) {
      const requestOptions = {
        uri: endpoints.createAnalysis(),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: 'analysis',
            attributes: {
              applicationId,
              datasetId
            }
          }
        }
      }
      return this.request(POST, requestOptions.uri, requestOptions)
    },

    async querySNPGenotypesFromFile (token, datasetId, snpNames) {
      const { data: fileUrls } = await api.getDatasetFilesUrl(datasetId, token)
      const snpSet = new Set(snpNames)
      const genFileUrl = fileUrls.find(fu => api.getFilenameFromUrl(fu.id).endsWith('.gen.zip'))
      if (genFileUrl) {
        const filePath = await api.downloadFile(datasetId, genFileUrl.id)
        const fileFolder = await api.unzip(datasetId, filePath)
        return api.getGenotypesFromFiles(snpSet, fileFolder)
      }

      const vcfFileUrl = fileUrls.find(fu => api.getFilenameFromUrl(fu.id).endsWith('.vcf.zip'))
      if (vcfFileUrl) {
        const filePath = await api.downloadFile(datasetId, vcfFileUrl.id)
        const fileFolder = await api.unzip(datasetId, filePath)
        return api.getGenotypesFromVCFFiles(snpSet, fileFolder)
      }

      throw new Error(`No .gen.zip or .vcf.zip file found for dataset ${datasetId}`)
    },

    getDatasetFilesUrl (datasetId, accessToken) {
      const requestOptions = {
        uri: endpoints.datasetFileUrls(datasetId),
        json: true,
        auth: {
          bearer: accessToken
        }
      }
      return this.request(GET, requestOptions.uri, requestOptions)
    },

    async getTempDir () {
      const tmpdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gp-dev-sdk-'))
      const cleanupCallback = () => fs.rmSync(tmpdir, { recursive: true, force: true })
      cleanupCallbacks.push(cleanupCallback)
      return tmpdir
    },

    cleanupFiles () {
      const localCleanupCallbacks = cleanupCallbacks
      cleanupCallbacks = []
      localCleanupCallbacks.forEach(cb => cb())
    },

    getFilenameFromUrl (fileUrl) {
      return fileUrl.split('/').pop().replace(/(\?|#).*$/, '')
    },

    async downloadFile (datasetId, datasetFileUrl) {
      const src = datasetFileUrl
      const filename = api.getFilenameFromUrl(src)
      const tmpdir = await api.getTempDir()
      const output = `${tmpdir}/${datasetId}_${Date.now()}_${path.extname(filename)}`
      const response = await fetch(src)
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download file from ${src}: ${response.status}`)
      }
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(output))
      return output
    },

    async unzip (datasetId, file) {
      const tmpdir = await api.getTempDir()
      const output = `${tmpdir}/${datasetId}_${Date.now()}`
      return new Promise((resolve, reject) => {
        const unzipExtractor = unzip.Extract({ path: output })
        unzipExtractor.on('error', reject)
        unzipExtractor.on('close', () => resolve(output))
        fs.createReadStream(file).pipe(unzipExtractor)
      })
    },

    async getGenotypesFromFiles (snpSet, snpFilesfolder) {
      const resultMap = new Map()
      const files = await new Promise((resolve, reject) => fs.readdir(snpFilesfolder, (err, f) => (err ? reject(err) : resolve(f))))
      const promises = files.map(async file => {
        const fullPath = `${snpFilesfolder}/${file}`
        let promise = Promise.resolve()
        const stat = await new Promise((resolve, reject) => fs.stat(fullPath, (error, rstat) => (error ? reject(error) : resolve(rstat))))
        if (stat.isFile()) {
          promise = new Promise(resolve => {
            const lineReader = readline.createInterface({
              input: fs.createReadStream(fullPath)
            })
            lineReader.on('line', line => {
              if (resultMap.size === snpSet.size) {
                lineReader.close()
              }
              const levels = line.split(/\s/)
              const [, snp, , alle1, alle2, p1, p2, p3] = levels
              const [, alleleIdx] = [p1, p2, p3].reduce(([val, ridx], p, idx) => (val > p ? [val, ridx] : [p, idx]), [-1, -1])
              let genotype = null
              if (alleleIdx === 0) {
                genotype = alle1 + alle1
              } else if (alleleIdx === 1) {
                genotype = alle1 + alle2
              } else if (alleleIdx === 2) {
                genotype = alle2 + alle2
              }
              if (snpSet.has(snp)) {
                resultMap.set(snp, genotype)
              }
            })
            lineReader.on('close', resolve)
          })
        }
        return promise
      })
      await Promise.all(promises)
      return resultMap
    },

    getGenotypeFromVCFRecord (ref, alt, format, sample) {
      const genotypeIndex = format.split(':').indexOf('GT')
      if (genotypeIndex === -1) {
        return null
      }

      const genotype = sample.split(':')[genotypeIndex]
      if (!genotype || genotype.includes('.')) {
        return null
      }

      const alleles = [ref].concat(alt.split(','))
      const alleleIndexes = genotype.split(/[|/]/)
      const genotypeAlleles = alleleIndexes.map(alleleIndex => alleles[parseInt(alleleIndex, 10)] || null)
      if (genotypeAlleles.some(allele => allele === null)) {
        return null
      }

      return genotypeAlleles.join('')
    },

    async getGenotypesFromVCFFiles (snpSet, snpFilesfolder) {
      const resultMap = new Map()
      const files = await new Promise((resolve, reject) => fs.readdir(snpFilesfolder, (err, f) => (err ? reject(err) : resolve(f))))
      const promises = files.map(async file => {
        const fullPath = `${snpFilesfolder}/${file}`
        let promise = Promise.resolve()
        const stat = await new Promise((resolve, reject) => fs.stat(fullPath, (error, rstat) => (error ? reject(error) : resolve(rstat))))
        if (stat.isFile() && fullPath.endsWith('.vcf.gz')) {
          promise = new Promise((resolve, reject) => {
            const input = fs.createReadStream(fullPath).pipe(zlib.createGunzip())
            const lineReader = readline.createInterface({ input })
            lineReader.on('line', line => {
              if (resultMap.size === snpSet.size) {
                lineReader.close()
                return
              }
              if (line.startsWith('#')) {
                return
              }
              const levels = line.split('\t')
              if (levels.length < 10) {
                return
              }
              const [, , snp, ref, alt, , , , format, sample] = levels
              if (!snpSet.has(snp)) {
                return
              }
              resultMap.set(snp, api.getGenotypeFromVCFRecord(ref, alt, format, sample))
            })
            input.on('error', reject)
            lineReader.on('error', reject)
            lineReader.on('close', resolve)
          })
        }
        return promise
      })
      await Promise.all(promises)
      return resultMap
    },

    markAnalysis (accessToken, analysisId, state, notes) {
      const requestOptions = {
        uri: endpoints.updateAnalysisState(analysisId),
        auth: {
          bearer: accessToken
        },
        followRedirect: true,
        simple: false,
        json: {
          data: {
            type: 'analysis',
            id: analysisId,
            attributes: {
              status: state
            }
          }
        }
      }
      if (notes) {
        requestOptions.json.data.attributes.notes = notes
      }
      return this.request(PATCH, requestOptions.uri, requestOptions)
    },

    markAnalysisAsFinished (accessToken, analysisId) {
      return this.markAnalysis(accessToken, analysisId, 'ready')
    },

    markAnalysisAsError (accessToken, analysisId, notes) {
      return this.markAnalysis(accessToken, analysisId, 'error', notes)
    },

    createDataset (accessToken, owner) {
      const requestOptions = {
        uri: endpoints.createDataset(),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: 'dataset',
            attributes: {
              owner
            }
          }
        }
      }
      return this.request(POST, requestOptions.uri, requestOptions)
    },

    createLocalArchiveDatasetImport (accessToken, datasetId, archiveLocation, addToLoadingQueue) {
      const requestOptions = {
        uri: endpoints.createDatasetImport(datasetId),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: 'dataset',
            attributes: {
              addToLoadingQueue,
              datasourceType: 'local-archive',
              datasourceAttributes: {
                location: archiveLocation
              }
            }
          }
        }
      }
      return this.request(POST, requestOptions.uri, requestOptions)
    },

    markDatasetImportAsWaitForImputedData (accessToken, datasetImportId) {
      const requestOptions = {
        uri: endpoints.updateDatasetImport(datasetImportId),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: 'datasetImport',
            id: datasetImportId,
            attributes: {
              status: 'wait-for-imputed-data'
            }
          }
        }
      }
      return this.request(PATCH, requestOptions.uri, requestOptions)
    },

    async analysisWrapper (authorisationCode, analysisId, contentFile, reportTitle, success) {
      const data = await new Promise((resolve, reject) => fs.readFile(contentFile, 'utf8', (err, data) => err ? reject(err) : resolve(data)))
      const bodyDevToken = await this.getToken(authorisationCode)
      const token = bodyDevToken.data.attributes.accessToken
      if (success) {
        await this.addReportPage(token, analysisId, reportTitle, data)
        await this.markAnalysisAsFinished(this.token, analysisId)
      } else {
        await this.markAnalysisAsError(token, analysisId, data)
      }
    }
  }
  return api
}
