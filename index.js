const request = require("request-promise")
const wget    = require("wget-improved")
const path    = require("path")
const unzip   = require("unzip")
const tmp     = require("tmp")
const Promise = require("bluebird")
const readline = require("readline")
const fs      = Promise.promisifyAll(require("fs"))
const DeveloperAPIEndpoints = require("./endpoints")

module.exports = function DeveloperAPI(baseURL, clientName, clientSecret) {
  const endpoints = new DeveloperAPIEndpoints(baseURL)

  let cleanupCallbacks = []

  const api = {
    getToken(authorisationCode, attributes) {
      if (typeof attributes === "undefined" || !attributes) {
        attributes = { // eslint-disable-line no-param-reassign
          grant_type: "authorization_code",
          code: authorisationCode,
          scope: "analysis"
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
            type: "token",
            attributes
          }
        }
      }
      return request.post(requestOptions)
    },

    getAdminToken() {
      return this.getToken(null, {
        grant_type: "client_credentials",
        scope: "admin"
      })
    },

    /**
     * This method will split the snpNames in a length that is allow for an url.
     * Because the method is an GET we need to have a url less than 2000 chars
    */
    splitIntoQueryable(snpNames) {
      const self             = this
      const queryLengthLimit = 1900
      let snpQuery           = snpNames.join(" ")
      let snpsToQuery        = []
      while (snpQuery.length > queryLengthLimit) {
        const toRemoveLength = (Math.floor(snpNames.length / 10) || 1)
        const removed        = snpNames.splice(-toRemoveLength, toRemoveLength)
        snpsToQuery        = snpsToQuery.concat(removed)
        snpQuery           = snpNames.join(" ")
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

    querySNPGenotypes(token, datasetId, snpNames, quality = 0.80) {
      const endpointLocation = endpoints.datasetSNPs(datasetId)
      const queries          = this.splitIntoQueryable(snpNames)
      let promiseChain       = Promise.resolve()
      const response         = { data: [] }
      queries.forEach(q => {
        const requestOptions = {
          uri: endpointLocation,
          json: true,
          auth: {
            bearer: token
          },
          qs: {
            names: q.join(" "),
            quality
          }
        }
        promiseChain = promiseChain
          .then(() => request.get(requestOptions))
          .then(body => { response.data = response.data.concat(body.data) })
      })
      return promiseChain.then(() => response)
    },

    getAnalysis(accessToken, analysisId) {
      const requestOptions = {
        uri: endpoints.getAnalysis(analysisId),
        auth: {
          bearer: accessToken
        },
        json: true
      }
      return request.get(requestOptions)
    },

    getEthnicity(accessToken, datasetId) {
      const requestOptions = {
        uri: endpoints.datasetEthnicity(datasetId),
        json: true,
        auth: {
          bearer: accessToken
        }
      }
      return request.get(requestOptions)
    },

    addReportPage(accessToken, analysisId, title, content) {
      const requestOptions = {
        uri: endpoints.createReportPage(analysisId),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: "page",
            attributes: {
              title,
              content
            }
          }
        }
      }
      return request.post(requestOptions)
    },

    createAnalysis(accessToken, applicationId, datasetId) {
      const requestOptions = {
        uri: endpoints.createAnalysis(),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: "analysis",
            attributes: {
              applicationId,
              datasetId
            }
          }
        }
      }
      return request.post(requestOptions)
    },

    async querySNPGenotypesFromFile(token, datasetId, snpNames) {
      const { data: fileUrls } = await api.getDatasetFilesUrl(datasetId, token)
      const { id: fileUrl } = fileUrls.find(fu => fu.id.split("/").pop().replace(/(\?|#).*$/, "").endsWith(".gen.zip"))
      const filePath        = await api.downloadFile(datasetId, fileUrl)
      const fileFolder      = await api.unzip(datasetId, filePath)
      const genotypesMap    = await api.getGenotypesFromFiles(new Set(snpNames), fileFolder)
      const genoytpesObj    = [...genotypesMap.entries()].reduce((obj, [key, value]) => {
        obj[key] = value // eslint-disable-line no-param-reassign
        return obj
      }, {})
      return genoytpesObj
    },

    getDatasetFilesUrl(datasetId, accessToken) {
      const requestOptions = {
        uri: endpoints.datasetFileUrls(datasetId),
        json: true,
        auth: {
          bearer: accessToken
        }
      }
      return request.get(requestOptions)
    },

    async getTempDir() {
      const [tmpdir, cleanupCallback] = await new Promise((resolve, reject) => tmp.dir({ unsafeCleanup: true }, (err, folderPath, cleanupCb) => {
        if (err) reject(err)
        resolve([folderPath, cleanupCb])
      }))
      cleanupCallbacks.push(cleanupCallback)
      return tmpdir
    },

    cleanupFiles() {
      const localCleanupCallbacks = cleanupCallbacks
      cleanupCallbacks = []
      localCleanupCallbacks.forEach(cb => cb())
    },

    async downloadFile(datasetId, datasetFileUrl) {
      const src      = datasetFileUrl
      const filename = src.split("/").pop().replace(/(\?|#).*$/, "")
      const tmpdir   = await api.getTempDir()
      const output   = `${tmpdir}/${datasetId}_${Date.now()}_${path.extname(filename)}`
      return new Promise((resolve, reject) => {
        const download = wget.download(src, output)
        download.on("error", err => reject(err))
        download.on("end", () => resolve(output))
      })
    },

    async unzip(datasetId, file) {
      const tmpdir   = await api.getTempDir()
      const output = `${tmpdir}/${datasetId}_${Date.now()}`
      return new Promise(resolve => {
        fs.createReadStream(file).pipe(
          unzip.Extract({ path: output }).on("close", () => resolve(output))
        )
      })
    },

    async getGenotypesFromFiles(snpSet, snpFilesfolder) {
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
            lineReader.on("line", line => {
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
            lineReader.on("close", resolve)
          })
        }
        return promise
      })
      await Promise.all(promises)
      return resultMap
    },

    markAnalysis(accessToken, analysisId, state, notes) {
      const requestOptions = {
        uri: endpoints.updateAnalysisState(analysisId),
        auth: {
          bearer: accessToken
        },
        followRedirect: true,
        simple: false,
        json: {
          data: {
            type: "analysis",
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
      return request.patch(requestOptions)
    },

    markAnalysisAsFinished(accessToken, analysisId) {
      return this.markAnalysis(accessToken, analysisId, "ready")
    },

    markAnalysisAsError(accessToken, analysisId, notes) {
      return this.markAnalysis(accessToken, analysisId, "error", notes)
    },

    createDataset(accessToken, owner) {
      const requestOptions = {
        uri: endpoints.createDataset(),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: "dataset",
            attributes: {
              owner
            }
          }
        }
      }
      return request.post(requestOptions)
    },

    createLocalArchiveDatasetImport(accessToken, datasetId, archiveLocation, addToLoadingQueue) {
      const requestOptions = {
        uri: endpoints.createDatasetImport(datasetId),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: "dataset",
            attributes: {
              addToLoadingQueue,
              datasourceType: "local-archive",
              datasourceAttributes: {
                location: archiveLocation
              }
            }
          }
        }
      }
      return request.post(requestOptions)
    },

    markDatasetImportAsWaitForImputedData(accessToken, datasetImportId) {
      const requestOptions = {
        uri: endpoints.updateDatasetImport(datasetImportId),
        auth: {
          bearer: accessToken
        },
        json: {
          data: {
            type: "datasetImport",
            id: datasetImportId,
            attributes: {
              status: "wait-for-imputed-data"
            }
          }
        }
      }
      return request.patch(requestOptions)
    },

    analysisWrapper(authorisationCode, analysisId, contentFile, reportTitle, success) {
      const self = this
      const contextObj = {}

      let promise = fs.readFileAsync(contentFile, "utf8")
        .catch(err => {
          if (!success) {
            throw err
          }
        })
        .bind(contextObj)
        .then(data =>  {
          this.data = data
          return data
        })
        .then(() => this.getToken(authorisationCode))
        .then(bodyDevToken => {
          this.token = bodyDevToken.data.attributes.accessToken
          return this.token
        })

      if (success) {
        promise = promise
          .then(token => self.addReportPage(token, analysisId, reportTitle, this.data))
          .then(() => self.markAnalysisAsFinished(this.token, analysisId))
          .catch(err => {
            throw err
          })
      } else {
        promise = promise
          .then(token => self.markAnalysisAsError(token, analysisId, this.data))
          .catch(err => {
            throw err
          })
      }
      return promise
    }
  }
  return api
}
