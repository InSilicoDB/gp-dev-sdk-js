
const DeveloperAPIEndpoints = require('./endpoints');
const request = require('request-promise');
const Promise = require("bluebird");
const fs = Promise.promisifyAll(require("fs"));

module.exports = function (baseURL, clientName, clientSecret) {

    var endpoints = new DeveloperAPIEndpoints(baseURL);

    return {

      getToken: function (authorisationCode, attributes) {
        if (typeof attributes==="undefined" || !attributes) {
          attributes = {
            grant_type: "authorization_code",
            code: authorisationCode,
            scope: "analysis"
          };
        }
        var requestOptions = {
          uri: endpoints.token,
          auth: {
            username: clientName,
            password: clientSecret
          },
          json: {
            data: {
              type: 'token',
              attributes: attributes
            }
          }
        };
        return request.post( requestOptions );
      },

      getAdminToken: function() {
        return this.getToken(null, {
          grant_type: "client_credentials",
          scope: "admin"
        });
      },

      querySNPGenotypes: function (token, datasetId, snpNames, quality=0.80) {
          console.log('querySNPGenotypes()');
          var endpointLocation = endpoints.datasetSNPs(datasetId);
          var requestOptions = {
              uri: endpointLocation,
              json: true,
              auth: {
                  bearer: token
              },
              qs: {
                  names: snpNames.join(' '),
                  quality: quality
              }
          };
          return request.get( requestOptions );
      },

      addReportPage: function (accessToken, analysisId, title, content) {

          var requestOptions = {
              uri: endpoints.createReportPage(analysisId),
              auth: {
                  bearer: accessToken
              },
              json: {
                  data: {
                      type: 'page',
                      attributes: {
                          title: title,
                          content: content
                      }
                  }
              }
          };
          return request.post(requestOptions );
      },

      createAnalysis: function (accessToken, applicationId, datasetId) {
        var requestOptions = {
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
        };
        return request.post( requestOptions );
      },

      markAnalysis: function (accessToken, analysisId, state, notes) {

          var requestOptions = {
              uri: endpoints.updateAnalysisState(analysisId),
              auth: {
                  bearer: accessToken
              },
              json: {
                  data: {
                      type: 'analysis',
                      id: analysisId,
                      attributes: {
                          status: state
                      }
                  }
              }
          };
          if (notes) {
            requestOptions.json.data.attributes.notes = notes;
          }
          return request.patch( requestOptions );
      },

      markAnalysisAsFinished: function (accessToken, analysisId) {
        return this.markAnalysis(accessToken, analysisId, "ready");
      },

      markAnalysisAsError: function (accessToken, analysisId, notes) {
        return this.markAnalysis(accessToken, analysisId, "error", notes);
      },

      createDataset: function(accessToken, owner) {
        var requestOptions = {
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
        };
        return request.post( requestOptions );
      },

      createLocalArchiveDatasetImport: function(accessToken, datasetId, archiveLocation, addToLoadingQueue) {
        var requestOptions = {
          uri: endpoints.createDatasetImport(datasetId),
          auth: {
            bearer: accessToken
          },
          json: {
            data:{
              type: "dataset",
              attributes:{
                addToLoadingQueue,
                datasourceType: "local-archive",
                datasourceAttributes:{
                  location: archiveLocation
                }
              }
            }
          }
        };
        return request.post( requestOptions );
      },

      markDatasetImportAsWaitForImputedData: function(accessToken, datasetImportId) {
        var requestOptions = {
          uri: endpoints.updateDatasetImport(datasetImportId),
          auth: {
            bearer: accessToken
          },
          json: {
            data: {
              type: 'datasetImport',
              id: datasetImportId,
              attributes: {
                status: "wait-for-imputed-data"
              }
            }
          }
        };
        return request.patch( requestOptions );
      },

      analysisWrapper(authorisationCode, analysisId, contentFile, reportTitle, success) {
        var self = this;
        var contextObj = {};

          if (success) {
            return fs.readFileAsync(contentFile, "utf8")
              .bind(contextObj)
              .then( data         =>  {
                this.data = data;
                return data;
              })
              .then( data         => this.getToken(authorisationCode) )
              .then( bodyDevToken => {
                this.token = bodyDevToken.data.attributes.accessToken;
                return this.token;
              })
              .then( token        => {
                return self.addReportPage(this.token, analysisId, reportTitle, this.data )
              })
              .then( body         => self.markAnalysisAsFinished(this.token, analysisId) )
              .catch(function(err){
                throw err;
              });
          } else {
            return fs.readFileAsync(contentFile, "utf8")
              .catch( err         => "" )
              .bind( contextObj )
              .then( data         =>  {
                this.data = data;
                return data;
              })
              .then( data         => this.getToken(authorisationCode) )
              .then( bodyDevToken => {
                this.token = bodyDevToken.data.attributes.accessToken;
                return this.token;
              })
              .then( token         => self.markAnalysisAsError(token, analysisId, this.data) )
              .catch(function(err){
                throw err;
              });
          }
      }

    };
};
